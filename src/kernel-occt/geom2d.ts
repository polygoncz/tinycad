import type { Geom2d_BSplineCurve, Geom2d_Curve } from 'replicad-opencascadejs';
import type { Vec2 } from '@/core';
import type { IdentifiedCurve, ProfileCurve } from '@/kernel';
import { compressKnots } from './face';
import type { Occt } from './occt';

// 2D curves of a sketch as OCCT Geom2d curves and the bounding box prefilter of their pairs:
// shared by the regions (regions.ts, M30) and the intersections and pieces of curves
// (curves.ts, M33). Internal to kernel-occt.

export type Bounded = Extract<ProfileCurve, { kind: 'line' | 'arc' | 'bspline' }>;
export type Circle = Extract<ProfileCurve, { kind: 'circle' }>;
type Spline = Extract<ProfileCurve, { kind: 'bspline' }>;

/** Axis-aligned box [minX, minY, maxX, maxY]. */
export type Box = readonly [number, number, number, number];

/** Every coordinate of a curve: its points, and the center of an arc or a circle. */
export function coordinatesOf(c: ProfileCurve): readonly number[] {
  switch (c.kind) {
    case 'line':
      return [...c.from, ...c.to];
    case 'arc':
      return [...c.center, ...c.from, ...c.to];
    case 'circle':
      return [...c.center];
    case 'bspline':
      return c.poles.flat();
  }
}

/** An arc running counter-clockwise from `from` to `to` (the same arc); other curves unchanged. */
export function counterClockwise(c: IdentifiedCurve): IdentifiedCurve {
  if (c.kind !== 'arc' || c.ccw) return c;
  return { kind: 'arc', center: c.center, from: c.to, to: c.from, ccw: true, id: c.id };
}

export function startOf(c: Bounded): Vec2 {
  return c.kind === 'bspline' ? (c.poles[0] ?? [Number.NaN, Number.NaN]) : c.from;
}

export function endOf(c: Bounded): Vec2 {
  return c.kind === 'bspline' ? (c.poles[c.poles.length - 1] ?? [Number.NaN, Number.NaN]) : c.to;
}

/**
 * New Geom2d curve of a line, an arc or a spline, parametrised from its start to its end (an arc
 * counter-clockwise: give it counter-clockwise, see counterClockwise); the caller owns it.
 */
export function boundedCurve(oc: Occt, c: Bounded): Geom2d_Curve {
  switch (c.kind) {
    case 'line': {
      using from = new oc.gp_Pnt2d(c.from[0], c.from[1]);
      using to = new oc.gp_Pnt2d(c.to[0], c.to[1]);
      using maker = new oc.GC_MakeSegment2d(from, to);
      return maker.Value();
    }
    case 'arc': {
      const radius = dist(c.center, c.from);
      using circle = circleOf(oc, c.center, radius);
      using from = new oc.gp_Pnt2d(c.from[0], c.from[1]);
      using to = new oc.gp_Pnt2d(c.to[0], c.to[1]);
      using maker = new oc.GC_MakeArcOfCircle2d(circle, from, to, true);
      return maker.Value();
    }
    case 'bspline':
      return splineCurve(oc, c);
  }
}

/** New non-rational Geom2d_BSplineCurve of a clamped spline; the caller owns it. */
export function splineCurve(oc: Occt, c: Spline): Geom2d_BSplineCurve {
  const { knots, multiplicities } = compressKnots(c.knots);
  using poles = new oc.NCollection_Array1_gp_Pnt2d(c.poles.length);
  c.poles.forEach((q, i) => {
    using pole = new oc.gp_Pnt2d(q[0], q[1]);
    poles.SetValue(i, pole);
  });
  using knotArray = new oc.NCollection_Array1_double(knots.length);
  using multArray = new oc.NCollection_Array1_int(knots.length);
  knots.forEach((k, i) => {
    knotArray.SetValue(i, k);
    multArray.SetValue(i, multiplicities[i] ?? 0);
  });
  return new oc.Geom2d_BSplineCurve(poles, knotArray, multArray, c.degree, false);
}

/** New counter-clockwise Geom2d_Circle, parametrised by the angle from +x; the caller owns it. */
export function circleCurve(oc: Occt, c: Circle): Geom2d_Curve {
  using center = new oc.gp_Pnt2d(c.center[0], c.center[1]);
  using xDir = new oc.gp_Dir2d(1, 0);
  using axis = new oc.gp_Ax2d(center, xDir);
  return new oc.Geom2d_Circle(axis, c.radius, true);
}

/** New counter-clockwise gp_Circ2d. */
function circleOf(oc: Occt, center: Vec2, radius: number) {
  using c = new oc.gp_Pnt2d(center[0], center[1]);
  using xDir = new oc.gp_Dir2d(1, 0);
  using axis = new oc.gp_Ax2d(c, xDir);
  return new oc.gp_Circ2d(axis, radius, true);
}

/**
 * A box around the curve grown by `tol`: an arc by its whole circle, a spline by its poles (the
 * curve lies in their convex hull).
 */
export function boxOf(c: ProfileCurve, tol: number): Box {
  let points: readonly Vec2[];
  switch (c.kind) {
    case 'line':
      points = [c.from, c.to];
      break;
    case 'arc': {
      const r = dist(c.center, c.from);
      points = [
        [c.center[0] - r, c.center[1] - r],
        [c.center[0] + r, c.center[1] + r],
      ];
      break;
    }
    case 'circle':
      points = [
        [c.center[0] - c.radius, c.center[1] - c.radius],
        [c.center[0] + c.radius, c.center[1] + c.radius],
      ];
      break;
    case 'bspline':
      points = c.poles;
  }
  const xs = points.map((q) => q[0]);
  const ys = points.map((q) => q[1]);
  return [
    Math.min(...xs) - tol,
    Math.min(...ys) - tol,
    Math.max(...xs) + tol,
    Math.max(...ys) + tol,
  ];
}

export function unionOf(boxes: readonly Box[]): Box {
  return [
    Math.min(...boxes.map((b) => b[0])),
    Math.min(...boxes.map((b) => b[1])),
    Math.max(...boxes.map((b) => b[2])),
    Math.max(...boxes.map((b) => b[3])),
  ];
}

export function boxesOverlap(a: Box, b: Box): boolean {
  return a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
}

export function inBox(b: Box, q: Vec2): boolean {
  return q[0] >= b[0] && q[0] <= b[2] && q[1] >= b[1] && q[1] <= b[3];
}

/**
 * The pairs [i, j] (i < j) of boxes that overlap, found by sweeping the boxes along x: only
 * these pairs of curves can meet, so only they reach Geom2dAPI_InterCurveCurve. In no
 * particular order.
 */
export function overlappingPairs(boxes: readonly Box[]): readonly (readonly [number, number])[] {
  const order = boxes.map((_, i) => i).sort((i, j) => (boxes[i]?.[0] ?? 0) - (boxes[j]?.[0] ?? 0));
  const pairs: (readonly [number, number])[] = [];
  for (let k = 0; k < order.length; k++) {
    const i = order[k] ?? -1;
    const a = boxes[i];
    if (a === undefined) continue;
    for (let m = k + 1; m < order.length; m++) {
      const j = order[m] ?? -1;
      const b = boxes[j];
      if (b === undefined) continue;
      if (b[0] > a[2]) break;
      if (boxesOverlap(a, b)) pairs.push(i < j ? [i, j] : [j, i]);
    }
  }
  return pairs;
}

export function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}
