import { assertNever, bspline, mod2pi, TWO_PI, vec2 } from '@/core';
import type { Vec2 } from '@/core';
import { SPLINE_TOLERANCE } from './geometry';
import type { Curve2 } from './geometry';

const { angleOf, dist, dot, sub } = vec2;

// The parameter t of a sketch curve (spec 12 "Port a parametr křivky", M33), the same in the
// kernel and here: a line [0, 1] from `from` to `to`; an arc the angle from `from` in the
// direction of the arc, [0, sweep]; a circle the angle atan2(p − center) in [0, 2π) (a piece may
// run past 2π); a spline the parameter of its knot vector. Pure functions for the preview and
// the picking of the trim tools.

/** Segments of a full turn in the polyline of an arc or circle piece (like the tool previews). */
const TURN_SEGMENTS = 64;
/** Samples per knot span before Newton in nearestParam of a spline. */
const SPLINE_SAMPLES = 16;
const NEWTON_STEPS = 32;
/** Halving of a spline piece: always at least MIN_DEPTH, never more than MAX_DEPTH (like core). */
const MIN_DEPTH = 2;
const MAX_DEPTH = 16;

type Arc = Extract<Curve2, { kind: 'arc' }>;
type Spline = Extract<Curve2, { kind: 'bspline' }>;

/** The point of the curve at t (t outside the range of a line or arc extrapolates the carrier). */
export function pointAt(c: Curve2, t: number): Vec2 {
  switch (c.kind) {
    case 'line':
      return [c.from[0] + (c.to[0] - c.from[0]) * t, c.from[1] + (c.to[1] - c.from[1]) * t];
    case 'arc': {
      const r = dist(c.from, c.center);
      const a = angleOf(sub(c.from, c.center)) + (c.ccw ? t : -t);
      return [c.center[0] + r * Math.cos(a), c.center[1] + r * Math.sin(a)];
    }
    case 'circle':
      return [c.center[0] + c.radius * Math.cos(t), c.center[1] + c.radius * Math.sin(t)];
    case 'bspline':
      return bspline.evaluate(c, t);
    default:
      return assertNever(c);
  }
}

/**
 * The parameter of the point of the curve nearest to p, within the range of the curve: a line,
 * an arc and a circle exactly (outside an arc the nearer end), a spline by sampling and Newton.
 */
export function nearestParam(c: Curve2, p: Vec2): number {
  switch (c.kind) {
    case 'line': {
      const d = sub(c.to, c.from);
      const len2 = dot(d, d);
      if (len2 === 0) return 0;
      return Math.min(1, Math.max(0, dot(sub(p, c.from), d) / len2));
    }
    case 'arc': {
      const sweep = arcSweep(c);
      const t = arcAngle(c, p);
      if (t <= sweep) return t;
      return dist(p, c.from) <= dist(p, pointAt(c, sweep)) ? 0 : sweep;
    }
    case 'circle':
      return mod2pi(angleOf(sub(p, c.center)));
    case 'bspline':
      return splineNearest(c, p);
    default:
      return assertNever(c);
  }
}

/**
 * The points of the piece of the curve between from < to, for the preview: a line its two ends,
 * an arc or circle 64 segments a turn, a spline halved to SPLINE_TOLERANCE of its size. Frozen.
 */
export function piecePolyline(c: Curve2, from: number, to: number): readonly Vec2[] {
  switch (c.kind) {
    case 'line':
      return Object.freeze([pointAt(c, from), pointAt(c, to)]);
    case 'arc':
    case 'circle': {
      const steps = Math.max(1, Math.ceil((TURN_SEGMENTS * (to - from)) / TWO_PI));
      const points: Vec2[] = [];
      for (let i = 0; i <= steps; i++) points.push(pointAt(c, from + ((to - from) * i) / steps));
      return Object.freeze(points);
    }
    case 'bspline':
      return Object.freeze(splinePiece(c, from, to));
    default:
      return assertNever(c);
  }
}

/** The range of the parameter of the curve: [0, 1], [0, sweep], [0, 2π] or the knot range. */
export function paramRange(c: Curve2): readonly [number, number] {
  switch (c.kind) {
    case 'line':
      return [0, 1];
    case 'arc':
      return [0, arcSweep(c)];
    case 'circle':
      return [0, TWO_PI];
    case 'bspline':
      return [knot(c, c.degree), knot(c, c.poles.length)];
    default:
      return assertNever(c);
  }
}

/** The tolerance of equal points (spec 12): 1e-7 · max(1, |coordinate|) of the points. */
export function pointTolerance(...points: readonly Vec2[]): number {
  return 1e-7 * Math.max(1, ...points.flatMap(([x, y]) => [Math.abs(x), Math.abs(y)]));
}

/** Whether a and b are the same point within pointTolerance. */
export function samePoint(a: Vec2, b: Vec2): boolean {
  return dist(a, b) <= pointTolerance(a, b);
}

/** The swept angle of an arc in [0, 2π); 0 for an arc whose ends coincide (degenerate). */
function arcSweep(c: Arc): number {
  return arcAngle(c, c.to);
}

/** The angle of p around the centre measured from `from` in the direction of the arc, [0, 2π). */
export function arcAngle(c: Arc, p: Vec2): number {
  const a0 = angleOf(sub(c.from, c.center));
  const a = angleOf(sub(p, c.center));
  return mod2pi(c.ccw ? a - a0 : a0 - a);
}

function splineNearest(c: Spline, p: Vec2): number {
  const [lo, hi] = paramRange(c);
  const squared = (t: number): number => {
    const q = pointAt(c, t);
    return (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2;
  };
  // Coarse: samples in each knot span, so a short span is not skipped.
  let best = lo;
  let bestD = squared(lo);
  for (const [a, b] of knotSpans(c)) {
    for (let i = 1; i <= SPLINE_SAMPLES; i++) {
      const t = a + ((b - a) * i) / SPLINE_SAMPLES;
      const d = squared(t);
      if (d < bestD) {
        best = t;
        bestD = d;
      }
    }
  }
  // Fine: Newton on f(t) = (C(t) − p)·C'(t), kept only while it gets nearer.
  let t = best;
  for (let i = 0; i < NEWTON_STEPS; i++) {
    const r = sub(pointAt(c, t), p);
    const d1 = bspline.derivative(c, t, 1);
    const d2 = bspline.derivative(c, t, 2);
    const f = dot(r, d1);
    const df = dot(d1, d1) + dot(r, d2);
    if (df <= 0) break;
    const next = Math.min(hi, Math.max(lo, t - f / df));
    if (squared(next) > squared(t) || next === t) break;
    t = next;
  }
  return t;
}

/** The spans between distinct knots inside the range of the spline. */
function knotSpans(c: Spline): readonly (readonly [number, number])[] {
  const spans: [number, number][] = [];
  for (let i = c.degree; i < c.poles.length; i++) {
    const a = knot(c, i);
    const b = knot(c, i + 1);
    if (b > a) spans.push([a, b]);
  }
  return spans;
}

/** Points of the spline from `from` to `to`: each knot span in it halved to the tolerance. */
function splinePiece(c: Spline, from: number, to: number): Vec2[] {
  const size = Math.max(1, ...c.poles.flatMap(([x, y]) => [Math.abs(x), Math.abs(y)]));
  const tolerance = SPLINE_TOLERANCE * size;
  const minDepth = c.degree > 1 ? MIN_DEPTH : 0;
  const breaks = [
    from,
    ...knotSpans(c)
      .map(([a]) => a)
      .filter((k) => k > from && k < to),
    to,
  ];
  const first = pointAt(c, from);
  const out: Vec2[] = [first];
  const halve = (a: number, pa: Vec2, b: number, pb: Vec2, depth: number): void => {
    const m = (a + b) / 2;
    const pm = pointAt(c, m);
    if (depth < MAX_DEPTH && (depth < minDepth || vec2.distanceToSegment(pm, pa, pb) > tolerance)) {
      halve(a, pa, m, pm, depth + 1);
      halve(m, pm, b, pb, depth + 1);
    } else {
      out.push(pb);
    }
  };
  let a = from;
  let pa = first;
  for (const b of breaks.slice(1)) {
    const pb = pointAt(c, b);
    halve(a, pa, b, pb, 0);
    a = b;
    pa = pb;
  }
  return out;
}

function knot(c: Spline, i: number): number {
  const k = c.knots[i];
  // The shape was checked when the curve was made (parseSketchData, the kernel); a bad index is a bug.
  if (k === undefined) throw new Error(`curve-param: knot ${String(i)} out of range`);
  return k;
}
