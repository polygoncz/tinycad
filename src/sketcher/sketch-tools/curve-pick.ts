// Shared parts of the trim, extend and split tools (spec 12, "Trim, extend, split (M33)"): the
// curve under the cursor with its parameter, the ids of an edit and the check that the data did
// not change while the kernel answered.

import type { Vec2 } from '@/core';
import { curve2, isCurveEntity, nearestParam, pointsById } from '@/sketch';
import type { Curve2, IdSource, SketchCurve, SketchData, SketchEntity } from '@/sketch';
import type { ToolContext } from '@/interaction';
import type { SketchSession } from '../sketch-session';
import { cursorAt, newConstraintId, newEntityId } from './common';
import { entityAt } from './snap';

/** The curve under the cursor: the entity, its Curve2, the cursor in the plane and its parameter. */
export interface PickedCurve {
  readonly entity: SketchCurve;
  readonly curve: Curve2;
  readonly cursor: Vec2;
  readonly t: number;
  /** The data the curve was picked in. */
  readonly data: SketchData;
}

/** The curve of the session under the cursor, or null (nothing, a point, a ray parallel to the plane). */
export function curveAt(
  ctx: ToolContext,
  session: SketchSession,
  x: number,
  y: number,
): PickedCurve | null {
  const entity = entityAt(ctx, session, x, y);
  const cursor = cursorAt(ctx, session, x, y);
  if (entity === null || cursor === null || !isModifiable(entity)) return null;
  const { entities, constraints } = session.state.get();
  const data: SketchData = { entities, constraints };
  const curve = curve2(entity, pointsById(data));
  return { entity, curve, cursor, t: nearestParam(curve, cursor), data };
}

/** The ids of an edit, minted from the generator of the tool context like the drawing tools. */
export function idSource(ctx: ToolContext): IdSource {
  return { entity: () => newEntityId(ctx), constraint: () => newConstraintId(ctx) };
}

/**
 * A curve the modify tools work on: a curve entity (no point, no pattern copy, no text letter –
 * entityAt answers those with their owner) and not an infinite line (M31, it has no ends).
 */
function isModifiable(e: SketchEntity): e is SketchCurve {
  return isCurveEntity(e) && e.kind !== 'xline';
}

/** Whether the session is open and its entities are still the ones of `data` (after awaiting the kernel). */
export function unchanged(session: SketchSession, data: SketchData): boolean {
  const state = session.state.get();
  return state.open && state.entities === data.entities && state.constraints === data.constraints;
}

/** Whether the curve is a spline (its pieces come from SketchGeometry.segment). */
export function isSpline(entity: SketchCurve): boolean {
  return entity.kind === 'bspline' || entity.kind === 'fitSpline';
}
