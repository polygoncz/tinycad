import type { Vec2 } from '@/core';

// The planar profiles of a sketch as the read model of the server carries them (spec 06, N122):
// the regions of a sketch the client highlights and picks. The server computes them.

/**
 * 2D curve in a plane; the same shape as Curve2 from sketch (kernel does not depend on sketch).
 * `id` (M14) is the id of the sketch entity, an opaque string for the kernel; makeFace turns it
 * into the role edge:<id> of the edge made from the curve (spec 06, "Stav po M14").
 */
export type ProfileCurve =
  | { readonly kind: 'line'; readonly from: Vec2; readonly to: Vec2; readonly id?: string }
  | {
      readonly kind: 'arc';
      readonly center: Vec2;
      readonly from: Vec2;
      readonly to: Vec2;
      readonly ccw: boolean;
      readonly id?: string;
    }
  | {
      readonly kind: 'circle';
      readonly center: Vec2;
      readonly radius: number;
      readonly id?: string;
    }
  | {
      // M29: a clamped polynomial B-spline (BSplineShape of core); it runs from the first pole
      // to the last one.
      readonly kind: 'bspline';
      readonly degree: number;
      readonly poles: readonly Vec2[];
      readonly knots: readonly number[];
      readonly id?: string;
    };

export type ProfileLoop = readonly ProfileCurve[];

/** Region (M30): a closed outer loop and holes; structurally SketchRegion of sketch. */
export interface ProfileRegion {
  /** Ids of all boundary curves (outer and holes), without duplicates, sorted (string comparison), joined by ','. */
  readonly name: string;
  /** Counter-clockwise, the curves oriented along the loop. */
  readonly outer: ProfileLoop;
  /** Clockwise. */
  readonly holes: readonly ProfileLoop[];
  /** > 0: outer minus holes. */
  readonly area: number;
}
