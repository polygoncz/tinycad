import type { Vec2 } from '@/core';
import { createKernelError } from './errors';
import type { FilletArc, FilletArcInput, FilletCurve } from './profile';
import { angleOf, cross, dist, dot, length, lerp, mod2pi, normalize, sub, TWO_PI } from './vec2';

// filletArc of the FakeKernel (spec 06 "Stav po M34"), analytically: the possible centers are
// the intersections of the curves parallel to both carriers at the distance `radius` (lines
// shifted to both sides, circles grown and shrunk), the one nearest `near` wins; the touching
// points are the projections of the center on the carriers. Internal to kernel.

/** Tolerance of the formulas, times the scale (as the regions and the intersections). */
const FORMULA_TOLERANCE = 1e-9;
/** Unit directions whose cross product is below this are parallel. */
const PARALLEL = 1e-12;

/**
 * A carrier of a curve shifted by the radius: a line (point, unit direction) or a circle. Also
 * the carriers of offsetCurves (fake-offset.ts).
 */
export type Offset =
  | { readonly kind: 'line'; readonly p: Vec2; readonly d: Vec2 }
  | { readonly kind: 'circle'; readonly c: Vec2; readonly r: number };

/**
 * The fillet center of the checked input nearest `near`, with the touching points and their t
 * (spec 12); rejects with 'operation-failed' when there is none.
 */
export function computeFilletArc({ a, b, radius, near }: FilletArcInput): FilletArc {
  const scale = Math.max(1, radius, ...[a, b].flatMap(coordinatesOf).map(Math.abs));
  const tol = FORMULA_TOLERANCE * scale;
  const centers = offsetsOf(a, radius, tol).flatMap((oa) =>
    offsetsOf(b, radius, tol).flatMap((ob) => meet(oa, ob, near, tol)),
  );
  let center: Vec2 | undefined;
  for (const c of centers)
    if (center === undefined || dist(c, near) < dist(center, near)) center = c;
  if (center === undefined) {
    throw createKernelError('operation-failed', 'filletArc: no center at that radius');
  }
  const [pointA, ta] = projection(a, center);
  const [pointB, tb] = projection(b, center);
  return { center, pointA, pointB, ta, tb };
}

/** The carrier shifted by ±radius; a circle shrunk to (nearly) its center is left out. */
function offsetsOf(c: FilletCurve, radius: number, tol: number): readonly Offset[] {
  if (c.kind === 'line') {
    const d = normalize(sub(c.to, c.from));
    const n: Vec2 = [d[1], -d[0]];
    return [1, -1].map((s) => ({ kind: 'line', p: lerp(c.from, n, s * radius), d }));
  }
  const rho = dist(c.center, c.from);
  const radii = [rho + radius, Math.abs(rho - radius)].filter((r) => r > tol);
  return radii.map((r) => ({ kind: 'circle', c: c.center, r }));
}

/**
 * The common points of two offsets; where they coincide, the point of them nearest `near`. Also
 * the corners of offsetCurves (fake-offset.ts).
 */
export function meet(a: Offset, b: Offset, near: Vec2, tol: number): readonly Vec2[] {
  if (a.kind === 'line' && b.kind === 'line') return lineLine(a, b, near, tol);
  if (a.kind === 'line' && b.kind === 'circle') return lineCircle(a, b, tol);
  if (a.kind === 'circle' && b.kind === 'line') return lineCircle(b, a, tol);
  if (a.kind === 'circle' && b.kind === 'circle') return circleCircle(a, b, near, tol);
  return [];
}

type LineOffset = Extract<Offset, { kind: 'line' }>;
type CircleOffset = Extract<Offset, { kind: 'circle' }>;

function lineLine(a: LineOffset, b: LineOffset, near: Vec2, tol: number): readonly Vec2[] {
  const denominator = cross(a.d, b.d);
  const w = sub(b.p, a.p);
  if (Math.abs(denominator) <= PARALLEL) {
    // Parallel: one line when b passes through a, otherwise no common point.
    return Math.abs(cross(a.d, w)) <= tol ? [lerp(a.p, a.d, dot(sub(near, a.p), a.d))] : [];
  }
  return [lerp(a.p, a.d, cross(w, b.d) / denominator)];
}

function lineCircle(l: LineOffset, c: CircleOffset, tol: number): readonly Vec2[] {
  const along = dot(sub(c.c, l.p), l.d);
  const foot = lerp(l.p, l.d, along);
  const h = dist(c.c, foot);
  if (h > c.r + tol) return [];
  if (Math.abs(h - c.r) <= tol) return [foot];
  const half = Math.sqrt(c.r * c.r - h * h);
  return [lerp(foot, l.d, -half), lerp(foot, l.d, half)];
}

function circleCircle(a: CircleOffset, b: CircleOffset, near: Vec2, tol: number): readonly Vec2[] {
  const between = sub(b.c, a.c);
  const d = length(between);
  if (d <= tol) {
    // Concentric: one circle when the radii agree, otherwise no common point.
    if (Math.abs(a.r - b.r) > tol) return [];
    const toward = sub(near, a.c);
    return [lerp(a.c, length(toward) > tol ? normalize(toward) : [1, 0], a.r)];
  }
  if (d > a.r + b.r + tol || d < Math.abs(a.r - b.r) - tol) return [];
  const u = normalize(between);
  const along = (d * d + a.r * a.r - b.r * b.r) / (2 * d);
  const foot = lerp(a.c, u, along);
  // Touching circles: one point.
  if (Math.abs(d - a.r - b.r) <= tol || Math.abs(d - Math.abs(a.r - b.r)) <= tol) return [foot];
  const h = Math.sqrt(Math.max(0, a.r * a.r - along * along));
  const n: Vec2 = [-u[1], u[0]];
  return [lerp(foot, n, h), lerp(foot, n, -h)];
}

/**
 * The projection of `p` on the carrier of `c` and its t (spec 12): a line [0, 1] from `from` to
 * `to`, also outside; an arc the angle from `from` in its direction, in [0, 2π) also beyond its
 * end.
 */
function projection(c: FilletCurve, p: Vec2): readonly [Vec2, number] {
  if (c.kind === 'line') {
    const d = sub(c.to, c.from);
    const t = dot(sub(p, c.from), d) / dot(d, d);
    return [lerp(c.from, d, t), t];
  }
  const rho = dist(c.center, c.from);
  const angle = angleOf(sub(p, c.center));
  const a0 = angleOf(sub(c.from, c.center));
  const t = mod2pi(c.ccw ? angle - a0 : a0 - angle);
  const point: Vec2 = [c.center[0] + rho * Math.cos(angle), c.center[1] + rho * Math.sin(angle)];
  return [point, t >= TWO_PI ? 0 : t];
}

function coordinatesOf(c: FilletCurve): readonly number[] {
  return c.kind === 'line' ? [...c.from, ...c.to] : [...c.center, ...c.from, ...c.to];
}
