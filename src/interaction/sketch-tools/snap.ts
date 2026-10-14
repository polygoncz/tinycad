// The point under the cursor (spec 10, "Bod pod kurzorem"): a point of the session, the origin
// of the plane, or a free point where the ray of the cursor meets the plane. Locating does not
// mint ids, so the preview can call it on every move; placePoint mints them for a click.

import type { Vec2 } from '@/core';
import type { SketchConstraint, SketchEntity, SketchEntityId } from '@/sketch';
import { ORIGIN_POINT_ID } from '../sketch-drawing';
import type { SketchSession } from '../sketch-session';
import { EDIT_SKETCH_DRAWING_ID } from '../sketch-session';
import type { ToolContext } from '../tools';
import { cursorAt, newConstraintId, newEntityId } from './common';

export type SnapTarget =
  /** An existing point of the session: its id is reused. */
  | { readonly kind: 'point'; readonly id: SketchEntityId; readonly at: Vec2 }
  /** The origin of the plane: a new point [0, 0] with fix. */
  | { readonly kind: 'origin'; readonly at: Vec2 }
  /** A new point on the plane under the cursor. */
  | { readonly kind: 'free'; readonly at: Vec2 };

/** A snapped point ready for addGeometry: its id and what to add for it (nothing if it exists). */
export interface PlacedPoint {
  readonly id: SketchEntityId;
  readonly at: Vec2;
  readonly entities: readonly SketchEntity[];
  readonly constraints: readonly SketchConstraint[];
}

const ORIGIN: Vec2 = Object.freeze([0, 0] as const);

/**
 * pick(x, y, ['sketchEntity']) over the drawing of the edited sketch: a point of the session → it;
 * ORIGIN_POINT_ID → the origin; otherwise (a curve, another drawing, nothing) the free point on
 * the plane. null when the ray is parallel to the plane (the click is ignored).
 */
export function snapAt(
  ctx: ToolContext,
  session: SketchSession,
  x: number,
  y: number,
): SnapTarget | null {
  const hit = editedEntityAt(ctx, x, y);
  if (hit === ORIGIN_POINT_ID) return { kind: 'origin', at: ORIGIN };
  const point = hit === null ? undefined : entityOf(session, hit);
  if (point?.kind === 'point') return { kind: 'point', id: point.id, at: [point.x, point.y] };
  const at = cursorAt(ctx, session, x, y);
  return at === null ? null : { kind: 'free', at };
}

/** The point for the target; new ids from ctx.ids. */
export function placePoint(ctx: ToolContext, target: SnapTarget): PlacedPoint {
  if (target.kind === 'point') {
    return { id: target.id, at: target.at, entities: [], constraints: [] };
  }
  const id = newEntityId(ctx);
  const point: SketchEntity = { kind: 'point', id, x: target.at[0], y: target.at[1] };
  const constraints: readonly SketchConstraint[] =
    target.kind === 'origin' ? [{ kind: 'fix', id: newConstraintId(ctx), point: id }] : [];
  return { id, at: target.at, entities: [point], constraints };
}

/** Same existing point (two new points are never the same). */
export function samePoint(a: SnapTarget | PlacedPoint, b: SnapTarget | PlacedPoint): boolean {
  const idOf = (t: SnapTarget | PlacedPoint): SketchEntityId | null => ('id' in t ? t.id : null);
  const ia = idOf(a);
  return ia !== null && ia === idOf(b);
}

/** The entity of the session under the cursor; the origin and other drawings are nothing. */
export function entityAt(
  ctx: ToolContext,
  session: SketchSession,
  x: number,
  y: number,
): SketchEntity | null {
  const hit = editedEntityAt(ctx, x, y);
  return hit === null ? null : (entityOf(session, hit) ?? null);
}

/** The id hit in the drawing of the edited sketch (ORIGIN_POINT_ID included), or null. */
function editedEntityAt(ctx: ToolContext, x: number, y: number): string | null {
  const hit = ctx.viewport.pick(x, y, ['sketchEntity']);
  return hit?.kind === 'sketchEntity' && hit.sketch === EDIT_SKETCH_DRAWING_ID ? hit.entity : null;
}

function entityOf(session: SketchSession, id: string): SketchEntity | undefined {
  return session.state.get().entities.find((e) => e.id === id);
}
