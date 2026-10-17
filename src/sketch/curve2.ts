import type { Vec2 } from '@/core';

// The 2D curve type shared by geometry and text (its own file so that text.ts and geometry.ts do
// not import each other).

/**
 * A 2D curve for regions and the kernel. The same shape as ProfileCurve in kernel (structural
 * typing, ADR 0017). `id` (M14) is the id of the sketch entity the curve comes from.
 */
export type Curve2 =
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
  /** M29: a clamped polynomial B-spline (the shape of BSplineShape in core/math/bspline.ts). */
  | {
      readonly kind: 'bspline';
      readonly degree: number;
      readonly poles: readonly Vec2[];
      readonly knots: readonly number[];
      readonly id?: string;
    };
