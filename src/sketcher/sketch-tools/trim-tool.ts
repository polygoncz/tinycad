// The trim tool (spec 12, "Trim, extend, split (M33)", "Trim"): a click on a curve removes the
// piece under the cursor between its neighbouring cuts (the intersections the session holds).
// The preview shows that piece; without the intersections of the current data (hits() null) the
// tool offers nothing. The kept pieces of a spline come from SketchGeometry.segment, the rest is
// trimEdit of sketch, written by SketchSession.rewrite.

import { cutsOf, paramRange, pieceAt, piecePolyline, trimEdit } from '@/sketch';
import type { Curve2, CurvePiece } from '@/sketch';
import type { Tool, ToolContext } from '@/interaction';
import type { SketchEditor } from '../sketch-editor';
import type { SketchSession } from '../sketch-session';
import { clearPreview, clickTool, previewPolyline, withHint } from './common';
import { curveAt, idSource, isSpline, unchanged } from './curve-pick';
import type { PickedCurve } from './curve-pick';

export function createTrimTool(sketches: SketchEditor): Tool {
  const tool = clickTool(sketches, {
    reset() {
      // Nothing in progress: every click stands alone.
    },
    onMove(ctx, session, x, y) {
      const target = trimTarget(ctx, session, x, y);
      if (target === null) {
        clearPreview(ctx);
        return;
      }
      const { picked, piece } = target;
      previewPolyline(ctx, session, piecePolyline(picked.curve, piece.from, piece.to));
    },
    onClick(ctx, session, x, y) {
      const target = trimTarget(ctx, session, x, y);
      clearPreview(ctx);
      if (target === null) return;
      void trim(ctx, session, target.picked, target.piece);
    },
  });
  return withHint(tool, 'hint.trim.pick');
}

/** The curve under the cursor and its piece there; null without a curve or without the hits. */
function trimTarget(
  ctx: ToolContext,
  session: SketchSession,
  x: number,
  y: number,
): { readonly picked: PickedCurve; readonly piece: CurvePiece } | null {
  const hits = session.hits();
  if (hits === null) return null;
  const picked = curveAt(ctx, session, x, y);
  if (picked === null) return null;
  const cuts = cutsOf(picked.data, picked.entity.id, hits);
  return { picked, piece: pieceAt(picked.curve, cuts, picked.t) };
}

/** Asks the kernel for the kept pieces of a spline, then writes the edit; a failure writes nothing. */
async function trim(
  ctx: ToolContext,
  session: SketchSession,
  picked: PickedCurve,
  piece: CurvePiece,
): Promise<void> {
  let pieces: readonly Curve2[] | undefined;
  if (isSpline(picked.entity)) {
    try {
      pieces = await keptSplinePieces(session, picked.curve, piece);
    } catch {
      // The kernel failed (or is not running): like hits() null, the tool does nothing.
      return;
    }
    if (!unchanged(session, picked.data)) return;
  }
  const edit = trimEdit(
    picked.data,
    { curve: picked.entity.id, piece, ...(pieces === undefined ? {} : { pieces }) },
    idSource(ctx),
  );
  if (edit !== null) await session.rewrite(edit.data, edit.added);
}

/** The pieces of the spline around the removed one, in the order of t (TrimRequest.pieces). */
function keptSplinePieces(
  session: SketchSession,
  curve: Curve2,
  piece: CurvePiece,
): Promise<readonly Curve2[]> {
  // Without any cut the spline goes as a whole: trimEdit needs no pieces.
  if (piece.start === null && piece.end === null) return Promise.resolve([]);
  const [lo, hi] = paramRange(curve);
  const ranges: (readonly [number, number])[] = [];
  if (piece.start !== null) ranges.push([lo, piece.from]);
  if (piece.end !== null) ranges.push([piece.to, hi]);
  return Promise.all(ranges.map(([from, to]) => session.geometry.segment(curve, from, to)));
}
