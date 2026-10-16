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
}
