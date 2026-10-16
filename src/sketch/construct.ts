import type { Vec2 } from '@/core';
import { curve2 } from './geometry';
import { pointsById } from './points';
import type { Curve2 } from './geometry';
import type { SketchCurve, SketchData, SketchEntityId } from './model';
import { cross, dist, dot, length, sub } from './vec2';

// Initial positions of new circles and arcs (spec 12 "Oblouky a kružnice (M27)"). Only an
// estimate: the constraints of the tool settle the final position in the solver. Pure.

export interface CircleFit {
  readonly center: Vec2;
  readonly radius: number;
}

/** ccw = counter-clockwise from the start to the end. */
export interface ArcFit {
  readonly center: Vec2;
  readonly radius: number;
  readonly ccw: boolean;
}

/** Coincident points and a zero radius. */
const EPS = 1e-9;

/** The circle with diameter a–b; |a − b| ≤ 1e-9 → null. */
export function circleFrom2(a: Vec2, b: Vec2): CircleFit | null {
  const d = dist(a, b);
  if (d <= EPS) return null;
  return { center: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], radius: d / 2 };
}

/** The circumscribed circle; points on a line (|cross| ≤ 1e-9 · max(1, size²)) or coincident → null. */
export function circleFrom3(a: Vec2, b: Vec2, c: Vec2): CircleFit | null {
  const ab = sub(b, a);
  const ac = sub(c, a);
  const cr = cross(ab, ac);
  const size = Math.max(length(ab), length(ac), dist(b, c));
  if (Math.abs(cr) <= EPS * Math.max(1, size * size)) return null;
  // Centre relative to a: solves 2·ab·x = |ab|², 2·ac·x = |ac|² (Cramer).
  const ab2 = dot(ab, ab);
  const ac2 = dot(ac, ac);
  const x = (ac[1] * ab2 - ab[1] * ac2) / (2 * cr);
  const y = (ab[0] * ac2 - ac[0] * ab2) / (2 * cr);
  return { center: [a[0] + x, a[1] + y], radius: Math.hypot(x, y) };
}

/** The arc start → end through `through`; ccw by the side of start–end `through` lies on; on a line → null. */
export function arcFrom3(start: Vec2, through: Vec2, end: Vec2): ArcFit | null {
  const fit = circleFrom3(start, through, end);
  if (fit === null) return null;
  // Through on the right of start → end: the counter-clockwise way from start to end passes it.
  return { ...fit, ccw: cross(sub(end, start), sub(through, start)) < 0 };
}

/**
 * The arc from `start` tangent to the unit `direction` to `end`; ccw when end is on the left of
 * the direction; end on the direction line (angle ≤ 1e-9) or at start → null.
 */
export function tangentArcFrom(start: Vec2, direction: Vec2, end: Vec2): ArcFit | null {
  const v = sub(end, start);
  const len = length(v);
  if (len <= EPS) return null;
  // Signed distance of end from the direction line = len · sin(angle).
  const side = cross(direction, v);
  if (Math.abs(side) <= EPS * len) return null;
  // The centre is start + t·n (n = left normal); |start + t·n − end| = |t| gives t = |v|² / 2 n·v.
  const t = (len * len) / (2 * side);
  return {
    center: [start[0] - direction[1] * t, start[1] + direction[0] * t],
    radius: Math.abs(t),
    ccw: side > 0,
  };
}

/** The weak pull of the centre towards the hint with two curves. */
const HINT_WEIGHT = 1e-3;
const MAX_ITERATIONS = 50;

/**
 * A circle tangent to 2 or 3 curves (a line = its whole carrier line, an arc = its whole circle),
 * the estimate nearest to `hint`: numerically (Gauss–Newton / Levenberg–Marquardt over the centre
 * and the radius, at most 50 iterations) minimises Σ (d_i(centre) − r)², with two curves plus the
 * weak term λ · |centre − hint|² (λ = 1e-3), so the centre is on the set of centres nearest to the
 * cursor. d_i is the distance from the line, for a circle | |p − c| − R |. Starts at `hint` with
 * r = mean d_i. No convergence, r ≤ 1e-9 or a tangency residual > 1e-6 · max(1, r) → null.
 *
 * Splines (`bspline`, M29) are not supported → null.
 */
export function tangentCircle(curves: readonly Curve2[], hint: Vec2): CircleFit | null {
  if (curves.length !== 2 && curves.length !== 3) return null;
  const distances: DistanceFn[] = [];
  for (const c of curves) {
    const fn = distanceFn(c);
    if (fn === null) return null;
    distances.push(fn);
  }
  const anchor = curves.length === 2 ? Math.sqrt(HINT_WEIGHT) : 0;
  const tangency = (s: State): number[] => residuals(distances, 0, hint, s);
  const cost = (s: State): number => sumSquares(residuals(distances, anchor, hint, s));
  const start = distances.map((d) => d(hint).value);
  let x: State = [hint[0], hint[1], start.reduce((s, v) => s + v, 0) / start.length];
  let budget = MAX_ITERATIONS;

  // Phase 1: Levenberg–Marquardt on the tangency residuals and the weak hint term.
  let mu = 1e-3;
  let current = cost(x);
  while (budget > 0) {
    budget--;
    const jac = jacobian(distances, anchor, x);
    const gradient = transposeTimes(jac, residuals(distances, anchor, hint, x));
    const normal = gram(transpose(jac)).map((row, i) =>
      row.map((v, j) => (i === j ? v + mu * Math.max(v, 1) : v)),
    );
    const step = solve(
      normal,
      gradient.map((v) => -v),
    );
    if (step === null) return null;
    const next = add(x, step);
    const nextCost = cost(next);
    if (nextCost <= current) {
      x = next;
      current = nextCost;
      mu = Math.max(mu / 10, 1e-12);
      if (Math.hypot(...step) <= 1e-12 * Math.max(1, Math.hypot(...x))) break;
    } else {
      mu *= 10;
      if (mu > 1e12) break;
    }
  }

  // Phase 2: the weak term keeps that minimum O(λ) off the set of tangent circles (by up to
  // λ · |centre − hint|); minimum-norm Gauss–Newton steps on the tangency residuals alone project
  // it onto the set. With three curves this is plain Newton.
  while (budget > 0 && maxAbs(tangency(x)) > 1e-12 * Math.max(1, x[2])) {
    budget--;
    const jac = jacobian(distances, 0, x);
    const y = solve(
      gram(jac),
      tangency(x).map((v) => -v),
    );
    if (y === null) return null;
    x = add(x, transposeTimes(jac, y));
  }

  const radius = x[2];
  if (!x.every(Number.isFinite) || radius <= EPS) return null;
  if (maxAbs(tangency(x)) > 1e-6 * Math.max(1, radius)) return null;
  return { center: [x[0], x[1]], radius };
}

/**
 * The direction the curve continues in past its end `point` (a line: away from the other end; an
 * arc: the tangent in the sense of motion towards that end and on); point not an end → null.
 */
export function endTangent(
  curve: SketchCurve,
  point: SketchEntityId,
  data: SketchData,
): Vec2 | null {
  switch (curve.kind) {
    case 'line': {
      if (point !== curve.p1 && point !== curve.p2) return null;
      const c = curve2(curve, pointsById(data));
      if (c.kind !== 'line') return null;
      return unit(point === curve.p2 ? sub(c.to, c.from) : sub(c.from, c.to));
    }
    case 'arc': {
      if (point !== curve.start && point !== curve.end) return null;
      const c = curve2(curve, pointsById(data));
      if (c.kind !== 'arc') return null;
      // The arc runs counter-clockwise from start to end: at the end it goes on counter-clockwise,
      // past the start it goes on clockwise.
      if (point === curve.end) {
        const r = sub(c.to, c.center);
        return unit([-r[1], r[0]]);
      }
      const r = sub(c.from, c.center);
      return unit([r[1], -r[0]]);
    }
    // A circle has no ends; splines (M29) are not supported.
    case 'circle':
    case 'bspline':
    case 'fitSpline':
      return null;
  }
}

/** A zero vector (a degenerate curve) → null. */
function unit(v: Vec2): Vec2 | null {
  const l = length(v);
  return l <= EPS ? null : [v[0] / l, v[1] / l];
}

type State = readonly [number, number, number];

/** Distance of a point from a curve and its gradient with respect to the point. */
type DistanceFn = (p: Vec2) => { readonly value: number; readonly gradient: Vec2 };

function distanceFn(c: Curve2): DistanceFn | null {
  switch (c.kind) {
    case 'line': {
      const d = sub(c.to, c.from);
      const l = length(d);
      if (l <= EPS) return null;
      const n: Vec2 = [-d[1] / l, d[0] / l];
      return (p) => {
        const s = dot(n, sub(p, c.from));
        const sign = s >= 0 ? 1 : -1;
        return { value: Math.abs(s), gradient: [sign * n[0], sign * n[1]] };
      };
    }
    case 'circle':
      return circleDistance(c.center, c.radius);
    case 'arc':
      return circleDistance(c.center, dist(c.from, c.center));
    // Splines (M29) have no closed-form distance here; not supported.
    case 'bspline':
      return null;
  }
}

function circleDistance(center: Vec2, radius: number): DistanceFn {
  return (p) => {
    const v = sub(p, center);
    const rho = length(v);
    const s = rho - radius;
    const sign = s >= 0 ? 1 : -1;
    const gradient: Vec2 = rho <= EPS ? [0, 0] : [(sign * v[0]) / rho, (sign * v[1]) / rho];
    return { value: Math.abs(s), gradient };
  };
}

/** Tangency residuals d_i − r, then the hint term (anchor > 0). */
function residuals(
  distances: readonly DistanceFn[],
  anchor: number,
  hint: Vec2,
  x: State,
): number[] {
  const out = distances.map((d) => d([x[0], x[1]]).value - x[2]);
  if (anchor > 0) out.push(anchor * (x[0] - hint[0]), anchor * (x[1] - hint[1]));
  return out;
}

function jacobian(distances: readonly DistanceFn[], anchor: number, x: State): number[][] {
  const out = distances.map((d) => {
    const g = d([x[0], x[1]]).gradient;
    return [g[0], g[1], -1];
  });
  if (anchor > 0) out.push([anchor, 0, 0], [0, anchor, 0]);
  return out;
}

function add(x: State, d: readonly number[]): State {
  return [x[0] + (d[0] ?? 0), x[1] + (d[1] ?? 0), x[2] + (d[2] ?? 0)];
}

function sumSquares(v: readonly number[]): number {
  return v.reduce((s, x) => s + x * x, 0);
}

function maxAbs(v: readonly number[]): number {
  return v.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
}

function transpose(m: readonly (readonly number[])[]): number[][] {
  const cols = m[0]?.length ?? 0;
  return Array.from({ length: cols }, (_, j) => m.map((row) => row[j] ?? 0));
}

/** M · Mᵀ (rows times rows). */
function gram(m: readonly (readonly number[])[]): number[][] {
  return m.map((a) => m.map((b) => a.reduce((s, v, k) => s + v * (b[k] ?? 0), 0)));
}

/** Mᵀ · v. */
function transposeTimes(m: readonly (readonly number[])[], v: readonly number[]): number[] {
  return transpose(m).map((col) => col.reduce((s, x, i) => s + x * (v[i] ?? 0), 0));
}

/** Solves A·x = b by Gaussian elimination with partial pivoting; a singular A → null. */
function solve(a: readonly (readonly number[])[], b: readonly number[]): number[] | null {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i] ?? 0]);
  const scale = Math.max(1, ...a.flat().map(Math.abs));
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++)
      if (Math.abs(m[r]?.[col] ?? 0) > Math.abs(m[pivot]?.[col] ?? 0)) pivot = r;
    const p = m[pivot];
    const pv = p?.[col] ?? 0;
    if (p === undefined || Math.abs(pv) <= 1e-14 * scale) return null;
    m[pivot] = m[col] ?? p;
    m[col] = p;
    for (let r = col + 1; r < n; r++) {
      const row = m[r];
      if (row === undefined) continue;
      const f = (row[col] ?? 0) / pv;
      for (let k = col; k <= n; k++) row[k] = (row[k] ?? 0) - f * (p[k] ?? 0);
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    const row = m[r] ?? [];
    let s = row[n] ?? 0;
    for (let k = r + 1; k < n; k++) s -= (row[k] ?? 0) * (x[k] ?? 0);
    x[r] = s / (row[r] ?? 1);
  }
  return x;
}
