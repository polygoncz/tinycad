import { assert, assertNever } from '@/core';
import type { Vec2 } from '@/core';
import type { SketchCurve, SketchData, SketchEntity, SketchEntityId, SketchPoint } from './model';
import { patternCopies } from './patterns';
import { pointsById } from './points';
import { textCurves } from './text';
import type { Curve2 } from './curve2';

export type { Curve2 } from './curve2';

// 2D geometry of sketch curves for regions and the kernel (spec 12 "Geometrie a pomůcky editace").

/**
 * Spline tessellation tolerance relative to the sketch scale (spec 12 "Spliny (M29)"): the
 * sketcher draws and snaps to splines with it.
 */
export const SPLINE_TOLERANCE = 1e-4;

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
    default:
      return assertNever(curve);
  }
}

/**
 * The curves that bound regions (spec 12 "Křivky pro oblasti a odvozená id"): the non-construction
 * curves of the sketch as Curve2 with the entity id, in the order of the entities, then the
 * non-construction curve copies of mirrors and patterns (M36) with their derived ids, in the
 * order of patternCopies, then the letter curves of the non-construction texts (M37, textCurves;
 * the holes of letters are found by the kernel). The one place that decides what bounds regions; the kernel skips
 * degenerate curves itself. Region names are sorted ids, so the order does not change them.
 */
export function regionCurves(data: SketchData): readonly Curve2[] {
  const copies = patternCopies(data);
  const points = new Map(pointsById(data));
  for (const copy of copies) if (copy.kind === 'point') points.set(copy.id, copy);
  const curves = [...data.entities, ...copies].filter(isRegionCurve);
  // A construction text bounds nothing; its baseline (usually construction) stays for the others.
  const texts = textCurves({
    entities: data.entities.filter((e) => e.kind !== 'text' || e.construction !== true),
    constraints: data.constraints,
  });
  return Object.freeze([...curves.map((curve) => curve2(curve, points)), ...texts]);
}

// Exhaustive on purpose: a new kind of entity (M31, M36, M37) must decide here whether it
// bounds regions, the type checker does not check a type predicate.
function isRegionCurve(e: SketchEntity): e is SketchCurve {
  switch (e.kind) {
    case 'point':
    case 'mirror':
    case 'linearPattern':
    case 'circularPattern':
    case 'text':
      // A pattern or a text is a recipe, not a curve; regionCurves adds its derived curves.
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
