import { assert, assertNever } from '@/core';
import type { Vec2 } from '@/core';
import type { SketchCurve, SketchData, SketchEntity, SketchEntityId, SketchPoint } from './model';
import { lerp, normalize, sub } from './vec2';
import { patternCopies } from './patterns';
import { pointsById } from './points';

// 2D geometry of sketch curves for regions and the kernel (spec 12 "Geometrie a pomůcky editace").

/**
 * Spline tessellation tolerance relative to the sketch scale (spec 12 "Spliny (M29)"): the
 * sketcher draws and snaps to splines with it.
 */
export const SPLINE_TOLERANCE = 1e-4;

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

/**
 * Half the length (mm) of the line an xline is drawn, picked and snapped as (M31): far beyond any
 * part, small enough for float precision in mm.
 */
export const XLINE_EXTENT = 1e5;

/**
 * A closed region of a sketch (spec 12 "Oblasti (profily)"), computed by the kernel since M30
 * (SketchOps.profileRegions); structurally ProfileRegion of kernel (ADR 0017).
 */
export interface SketchRegion {
  /** Ids of all boundary curves (outer and holes), without duplicates, sorted (string comparison), joined by ','. */
  readonly name: string;
  /** A closed counter-clockwise loop. */
  readonly outer: readonly Curve2[];
  /** Closed clockwise loops. */
  readonly holes: readonly (readonly Curve2[])[];
  /** > 0: outer minus holes. */
  readonly area: number;
}

/**
 * The curve with its point coordinates and the entity id (M14); an arc becomes counter-clockwise.
 * An xline becomes a line XLINE_EXTENT long each way from the middle of p1p2 (M31).
 * A spline becomes a `bspline`: its poles are the coordinates of the pole points (`bspline`) or
 * the stored solved poles (`fitSpline`). A missing point is a programming error.
 */
export function curve2(
  curve: SketchCurve,
  points: ReadonlyMap<SketchEntityId, SketchPoint>,
): Curve2 {
  const at = (id: SketchEntityId): Vec2 => {
    const p = points.get(id);
    assert(p !== undefined, `curve2: curve '${curve.id}' refers to a missing point '${id}'`);
    return [p.x, p.y];
  };
  switch (curve.kind) {
    case 'line':
      return { kind: 'line', from: at(curve.p1), to: at(curve.p2), id: curve.id };
    case 'circle':
      return { kind: 'circle', center: at(curve.center), radius: curve.radius, id: curve.id };
    case 'arc':
      return {
        kind: 'arc',
        center: at(curve.center),
        from: at(curve.start),
        to: at(curve.end),
        ccw: true,
        id: curve.id,
      };
    case 'bspline':
      return {
        kind: 'bspline',
        degree: curve.degree,
        poles: curve.poles.map(at),
        knots: curve.knots,
        id: curve.id,
      };
    case 'fitSpline':
      return {
        kind: 'bspline',
        degree: curve.degree,
        poles: curve.poles,
        knots: curve.knots,
        id: curve.id,
      };
    case 'xline': {
      const p1 = at(curve.p1);
      const p1p2 = sub(at(curve.p2), p1);
      const m = lerp(p1, p1p2, 0.5);
      // p1 ≠ p2 (parseSketchData), so the direction is defined.
      const d = normalize(p1p2);
      return {
        kind: 'line',
        from: lerp(m, d, -XLINE_EXTENT),
        to: lerp(m, d, XLINE_EXTENT),
        id: curve.id,
      };
    }
    default:
      return assertNever(curve);
  }
}

/**
 * The curves that bound regions (spec 12 "Křivky pro oblasti a odvozená id"): the non-construction
 * curves of the sketch as Curve2 with the entity id, in the order of the entities, then the
 * non-construction curve copies of mirrors and patterns (M36) with their derived ids, in the
 * order of patternCopies. The one place that decides what bounds regions; the kernel skips
 * degenerate curves itself. Region names are sorted ids, so the order does not change them.
 */
export function regionCurves(data: SketchData): readonly Curve2[] {
  const copies = patternCopies(data);
  const points = new Map(pointsById(data));
  for (const copy of copies) if (copy.kind === 'point') points.set(copy.id, copy);
  const curves = [...data.entities, ...copies].filter(isRegionCurve);
  return Object.freeze(curves.map((curve) => curve2(curve, points)));
}

// Exhaustive on purpose: a new kind of entity (M31, M36, M37) must decide here whether it
// bounds regions, the type checker does not check a type predicate.
function isRegionCurve(e: SketchEntity): e is SketchCurve {
  switch (e.kind) {
    // An xline is always construction (M31): it never bounds a region.
    case 'point':
    case 'xline':
    case 'mirror':
    case 'linearPattern':
    case 'circularPattern':
      // A pattern is a recipe, not a curve; its copies are added by regionCurves (M36).
      return false;
    case 'line':
    case 'circle':
    case 'arc':
    case 'bspline':
    case 'fitSpline':
      return e.construction !== true;
    default:
      return assertNever(e);
  }
}
