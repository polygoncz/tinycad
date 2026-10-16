import type { Vec2 } from '@/core';
import type { Curve2 } from './geometry';

// The geometry port of the sketcher (spec 12 "Geometrie skici v jádře (M30)" and "Trim, extend,
// split (M33)", ADR 0028, Q092): geometry of the sketch the kernel computes for the sketcher
// tools. app implements it over the kernel client and hands it to the sketcher next to the
// ConstraintSolver.

/**
 * An intersection of the curves a and b (entity ids; a === b is a self-intersection of a spline)
 * in `point`, with the parameters ta, tb on them (the parameter t of spec 12, see curve-param.ts).
 */
export interface CurveHit {
  readonly a: string;
  readonly b: string;
  readonly point: Vec2;
  readonly ta: number;
  readonly tb: number;
  /** An end of the common stretch of two overlapping curves. */
  readonly overlap?: true;
}

/**
 * The centre and the points of contact of a fillet arc of radius r between two curves (M34): the
 * centre lies r away from the carriers of both (a line as the infinite line, an arc as the whole
 * circle); pointA, pointB are its projections on the carriers, ta, tb their parameters t (on a
 * line also outside [0, 1]). The shape of FilletArc in kernel (structural typing, ADR 0017).
 */
export interface FilletArc {
  readonly center: Vec2;
  readonly pointA: Vec2;
  readonly pointB: Vec2;
  readonly ta: number;
  readonly tb: number;
}

export interface SketchGeometry {
  /**
   * All intersections of the curves (construction ones too, also in shared end points), ordered
   * by a, b (the order of the input), ta. Every curve needs a unique id.
   */
  intersections(curves: readonly Curve2[]): Promise<readonly CurveHit[]>;
  /**
   * The piece of the curve between the parameters from < to, of the same kind (a circle gives an
   * arc), with the id of the input; exact (a spline through Geom2d_BSplineCurve.Segment).
   */
  segment(curve: Curve2, from: number, to: number): Promise<Curve2>;
  /**
   * The fillet arc of `radius` between a and b (each a line or an arc), of the possible centres
   * the one nearest to `near`; rejects without a solution (a radius too large, parallel lines
   * further than 2·radius apart).
   */
  fillet(a: Curve2, b: Curve2, radius: number, near: Vec2): Promise<FilletArc>;
}
