// The point under the cursor (spec 12, "Snapper a auto-vazby (M26)"): the snapper of sketch over
// the data of the session, with the 6 px tolerance converted to mm at the cursor. Locating does
// not mint ids, so the preview can call it on every move; placePoint mints them for a click.

import type { Vec2 } from '@/core';
import { snap } from '@/sketch';
import type {
  PointInference,
  SketchConstraint,
  SketchData,
  SketchEntity,
  SketchEntityId,
  SnapResult,
} from '@/sketch';
import type { ToolContext } from '@/interaction';
import type { SketchSession } from '../sketch-session';
import { EDIT_SKETCH_DRAWING_ID } from '../sketch-session';
import { cursorAt, distance, newConstraintId, newEntityId } from './common';

/** Where a click lands: the result of the snapper (an existing point, the origin, a new point…). */
export type SnapTarget = SnapResult;

/** A snapped point ready for addGeometry: its id and what to add for it (nothing if it exists). */
export interface PlacedPoint {
  readonly id: SketchEntityId;
  readonly at: Vec2;
  readonly entities: readonly SketchEntity[];
  readonly constraints: readonly SketchConstraint[];
}

/** How a tool snaps: the grid step (null = none) and the inference (false = Ctrl/Cmd). */
export interface SnapMode {
  readonly grid: number | null;
  readonly infer: boolean;
  /** Entities not snapped to (spec 12, SnapOptions.exclude). */
  readonly exclude?: ReadonlySet<SketchEntityId>;
  /**
   * Entities of the tool that may not be in the data yet (a chain of lines in progress): snapped
   * to like the data until they are written.
   */
  readonly pending?: readonly SketchEntity[];
}

/** The snap tolerance in px of the view (spec 12). */
const SNAP_TOLERANCE_PX = 6;

/**
 * The snapper at the cursor: snap(cursorAt(x, y), data, { tolerance, grid, infer, exclude }) with
 * the tolerance = the distance in the plane between cursorAt(x, y) and cursorAt(x + 6, y). null
 * when the ray is parallel to the plane (the click is ignored).
 */
export function snapAt(
  ctx: ToolContext,
  session: SketchSession,
  x: number,
  y: number,
  mode: SnapMode,
): SnapTarget | null {
  const cursor = cursorAt(ctx, session, x, y);
  const tolerance = snapToleranceAt(ctx, session, x, y);
  if (cursor === null || tolerance === null) return null;
  return snapPoint(sessionData(session, mode.pending ?? []), cursor, tolerance, mode);
}

/** 6 px in mm of the plane at the cursor; null for a ray parallel to the plane. */
export function snapToleranceAt(
  ctx: ToolContext,
  session: SketchSession,
  x: number,
  y: number,
): number | null {
  const at = cursorAt(ctx, session, x, y);
  const aside = cursorAt(ctx, session, x + SNAP_TOLERANCE_PX, y);
  return at === null || aside === null ? null : distance(at, aside);
}

/**
 * The snapper at a point of the plane (a corner the rectangle computes) over `data`, which
 * already holds the pending entities of the mode.
 */
export function snapPoint(
  data: SketchData,
  at: Vec2,
  tolerance: number,
  mode: SnapMode,
): SnapTarget {
  return snap(at, data, {
    tolerance,
    grid: mode.grid,
    infer: mode.infer,
    ...(mode.exclude === undefined ? {} : { exclude: mode.exclude }),
  });
}

/** The data of the session with the pending entities that are not in it yet appended. */
export function sessionData(
  session: Pick<SketchSession, 'state'>,
  pending: readonly SketchEntity[],
): SketchData {
  const { entities, constraints } = session.state.get();
  if (pending.length === 0) return { entities, constraints };
  const present = new Set(entities.map((e) => e.id));
  const missing = pending.filter((e) => !present.has(e.id));
  return missing.length === 0
    ? { entities, constraints }
    : {
        entities: [...entities, ...missing],
        constraints,
      };
}

/** A target of a new point at `at` without constraints (a computed corner, an arc end). */
export function freeTarget(at: Vec2): SnapTarget {
  return { at, kind: 'free', point: null, inferred: [], guides: [] };
}

/**
 * The point for the target: an existing point is reused; otherwise a new point at target.at with
 * the constraints of target.inferred (pointOnCurve, midpoint, hAlign/vAlign with the new point,
 * fix at the origin). New ids from ctx.ids.
 */
export function placePoint(ctx: ToolContext, target: SnapTarget): PlacedPoint {
  if (target.point !== null) {
    return { id: target.point, at: target.at, entities: [], constraints: [] };
  }
  const id = newEntityId(ctx);
  const point: SketchEntity = { kind: 'point', id, x: target.at[0], y: target.at[1] };
  const constraints = target.inferred.map((i) => inferredConstraint(ctx, id, i));
  return { id, at: target.at, entities: [point], constraints };
}

function inferredConstraint(
  ctx: ToolContext,
  point: SketchEntityId,
  i: PointInference,
): SketchConstraint {
  const id = newConstraintId(ctx);
  switch (i.kind) {
    case 'fix':
      return { kind: 'fix', id, point };
    case 'pointOnCurve':
      return { kind: 'pointOnCurve', id, point, curve: i.curve };
    case 'midpoint':
      return { kind: 'midpoint', id, point, line: i.line };
    case 'hAlign':
    case 'vAlign':
      return { kind: i.kind, id, a: point, b: i.with };
  }
}

/** Same existing point (two new points are never the same). */
export function samePoint(a: SnapTarget, b: SnapTarget): boolean {
  return a.point !== null && a.point === b.point;
}

/** The entity of the session under the cursor (render's pick); the origin and other drawings are nothing. */
export function entityAt(
  ctx: ToolContext,
  session: SketchSession,
  x: number,
  y: number,
): SketchEntity | null {
  const hit = ctx.viewport.pick(x, y, ['sketchEntity']);
  if (hit?.kind !== 'sketchEntity' || hit.sketch !== EDIT_SKETCH_DRAWING_ID) return null;
  return session.state.get().entities.find((e) => e.id === hit.entity) ?? null;
}
