// The tangent arc (spec 12, "Oblouky a kružnice (M27)"), shared by the tangent arc tool and the
// tangent arc of the polyline: from an end point of a line or arc, tangent to it, to an end
// (snapped, with its inferred constraints), around a new centre point; tangent(arc, curve) is
// required. An arc is always counter-clockwise in the data, so a clockwise fit swaps its start and
// end.

import type { Vec2 } from '@/core';
import { tangentArcFrom } from '@/sketch';
import type {
  ArcFit,
  SketchConstraint,
  SketchConstraintId,
  SketchEntity,
  SketchEntityId,
} from '@/sketch';
import type { ToolContext } from '@/interaction';
import type { GlyphKind } from '../sketch-glyphs';
import { newConstraintId, newEntityId } from './common';
import { freeTarget, placePoint } from './snap';
import type { PlacedPoint, SnapTarget } from './snap';

/** The end point the arc starts at, the curve it continues and the direction it goes on in. */
export interface TangentStart {
  readonly point: SketchEntityId;
  readonly at: Vec2;
  readonly curve: SketchEntityId;
  readonly direction: Vec2;
}

/** The arc `fit` from a start to the target `end`. */
export interface TangentArc {
  readonly fit: ArcFit;
  readonly end: SnapTarget;
}

/** The arc from `start` to `target`; null at the start itself or on the line of the direction. */
export function tangentArcTo(start: TangentStart, target: SnapTarget): TangentArc | null {
  if (target.point === start.point) return null;
  const fit = tangentArcFrom(start.at, start.direction, target.at);
  return fit === null ? null : { fit, end: target };
}

/** The inferences the arc adds: the end's and tangent. */
export function tangentArcInferences(arc: TangentArc): readonly { readonly kind: GlyphKind }[] {
  return [...arc.end.inferred, { kind: 'tangent' }];
}

/** The geometry of a tangent arc for addGeometry, with the id of the arc and its placed end. */
export interface TangentArcGeometry {
  readonly arc: SketchEntityId;
  readonly end: PlacedPoint;
  readonly entities: readonly SketchEntity[];
  readonly constraints: readonly SketchConstraint[];
  /** tangent(arc, curve). */
  readonly required: ReadonlySet<SketchConstraintId>;
}

/**
 * The arc around a new centre from the shared start to the end (swapped for a clockwise fit)
 * with tangent(arc, curve), which is required. Mints the ids.
 */
export function tangentArcGeometry(
  ctx: ToolContext,
  start: TangentStart,
  arc: TangentArc,
): TangentArcGeometry {
  const { fit } = arc;
  const c = placePoint(ctx, freeTarget(fit.center));
  const e = placePoint(ctx, arc.end);
  const id: SketchEntityId = newEntityId(ctx);
  const [from, to] = fit.ccw ? [start.point, e.id] : [e.id, start.point];
  const tangent: SketchConstraint = {
    kind: 'tangent',
    id: newConstraintId(ctx),
    a: id,
    b: start.curve,
  };
  return {
    arc: id,
    end: e,
    entities: [
      ...c.entities,
      ...e.entities,
      { kind: 'arc', id, center: c.id, start: from, end: to },
    ],
    constraints: [...e.constraints, tangent],
    required: new Set([tangent.id]),
  };
}
