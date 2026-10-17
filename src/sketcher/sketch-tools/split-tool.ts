// The split tool (spec 12, "Trim, extend, split (M33)", "Split"): a click on a curve splits it in
// a point: in a cut (an intersection the session holds) within the click tolerance of the
// cursor, otherwise in the point of the curve nearest to the cursor. The preview shows the point.
// The two pieces of a spline come from SketchGeometry.segment, the rest is splitEdit of sketch,
// written by SketchSession.rewrite. A point at an end of the curve splits nothing.

import { cutsOf, paramRange, pointAt, samePoint, splitEdit } from '@/sketch';
import type { Curve2, CurveCut } from '@/sketch';
import { vec2 } from '@/core';
import type { Vec2 } from '@/core';
import { CLICK_TOLERANCE_PX } from '@/interaction';
import type { Tool, ToolContext } from '@/interaction';
import type { SketchEditor } from '../sketch-editor';
import type { SketchSession } from '../sketch-session';
import { PREVIEW_OVERLAY_ID, clearPreview, clickTool, cursorAt, toWorld, withHint } from './common';
import { curveAt, idSource, isSpline, unchanged } from './curve-pick';
import type { PickedCurve } from './curve-pick';

/** Where a click splits: the curve and a parameter or a cut, and the point there. */
interface SplitTarget {
  readonly picked: PickedCurve;
  readonly where: number | CurveCut;
  readonly point: Vec2;
}

export function createSplitTool(sketches: SketchEditor): Tool {
  const tool = clickTool(sketches, {
    reset() {
      // Nothing in progress: every click stands alone.
    },
    onMove(ctx, session, x, y) {
      const target = splitTarget(ctx, session, x, y);
      if (target === null) {
        clearPreview(ctx);
        return;
      }
      ctx.viewport.overlay.set(PREVIEW_OVERLAY_ID, [
        { kind: 'points', points: [toWorld(session, target.point)], style: 'preview' },
      ]);
    },
    onClick(ctx, session, x, y) {
      const target = splitTarget(ctx, session, x, y);
      clearPreview(ctx);
      if (target === null) return;
      void split(ctx, session, target);
    },
  });
  return withHint(tool, 'hint.split.pick');
}

/**
 * The curve under the cursor and where it splits: the nearest cut within CLICK_TOLERANCE_PX of
 * the cursor (only with the hits of the current data), otherwise the nearest point of the curve.
 * Null without a curve or at an end of a curve that is not a circle.
 */
function splitTarget(
  ctx: ToolContext,
  session: SketchSession,
  x: number,
  y: number,
): SplitTarget | null {
  const picked = curveAt(ctx, session, x, y);
  if (picked === null) return null;
  const tolerance = clickToleranceAt(ctx, session, x, y);
  const hits = session.hits();
  const cuts =
    hits === null || tolerance === null ? [] : cutsOf(picked.data, picked.entity.id, hits);
  const near = cuts
    .map((cut) => ({ cut, d: vec2.dist(cut.point, picked.cursor) }))
    .filter(({ d }) => tolerance !== null && d <= tolerance)
    .sort((a, b) => a.d - b.d)[0];
  if (near !== undefined) return { picked, where: near.cut, point: near.cut.point };
  const point = pointAt(picked.curve, picked.t);
  if (picked.curve.kind !== 'circle' && atEnd(picked.curve, point)) return null;
  return { picked, where: picked.t, point };
}

/** CLICK_TOLERANCE_PX in mm of the plane at the cursor; null for a ray parallel to the plane. */
function clickToleranceAt(
  ctx: ToolContext,
  session: SketchSession,
  x: number,
  y: number,
): number | null {
  const at = cursorAt(ctx, session, x, y);
  const aside = cursorAt(ctx, session, x + CLICK_TOLERANCE_PX, y);
  return at === null || aside === null ? null : vec2.dist(at, aside);
}

function atEnd(curve: Curve2, point: Vec2): boolean {
  const [lo, hi] = paramRange(curve);
  return samePoint(point, pointAt(curve, lo)) || samePoint(point, pointAt(curve, hi));
}

/** Asks the kernel for the two pieces of a spline, then writes the edit; a failure writes nothing. */
async function split(ctx: ToolContext, session: SketchSession, target: SplitTarget): Promise<void> {
  const { picked, where } = target;
  let pieces: readonly [Curve2, Curve2] | undefined;
  if (isSpline(picked.entity)) {
    const t = typeof where === 'number' ? where : where.t;
    const [lo, hi] = paramRange(picked.curve);
    try {
      pieces = await Promise.all([
        session.geometry.segment(picked.curve, lo, t),
        session.geometry.segment(picked.curve, t, hi),
      ]);
    } catch {
      // The kernel failed (or is not running): nothing to write.
      return;
    }
    if (!unchanged(session, picked.data)) return;
  }
  const edit = splitEdit(
    picked.data,
    { curve: picked.entity.id, where, ...(pieces === undefined ? {} : { pieces }) },
    idSource(ctx),
  );
  if (edit !== null) await session.rewrite(edit.data, edit.added);
}
