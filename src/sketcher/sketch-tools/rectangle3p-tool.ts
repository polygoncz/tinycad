// The 3-point rectangle tool (spec 12, "Nové kreslicí nástroje (M31)"): two corners are the first
// side, the third click the height perpendicular to it (rectangleFrom3) → a rotated rectangle
// held by rectangle3Shape: 4 lines, perpendicular and 2× parallel (required). The clicked corners
// go through the snapper; the two computed corners too, at their place, without the grid and
// never onto the clicked corners. The first side gets horizontal or vertical from inferLine
// within 3° (automatic, B3); Ctrl/Cmd turns it off. A degenerate rectangle makes nothing. The
// click and the preview of a move share one step (rectangle3pStep).

import type { Vec2 } from '@/core';
import { rectangle3Shape, rectangleFrom3 } from '@/sketch';
import type { SketchData } from '@/sketch';
import { isPlainEscape } from '@/interaction';
import type { Tool } from '@/interaction';
import type { SketchEditor } from '../sketch-editor';
import type { GlyphKind } from '../sketch-glyphs';
import {
  MIN_LENGTH,
  clearPreview,
  clickTool,
  distance,
  previewInference,
  previewPairs,
  previewPolyline,
  snapMode,
} from './common';
import { placePoint, samePoint, sessionData, snapAt, snapToleranceAt } from './snap';
import type { SnapTarget } from './snap';
import {
  addShape,
  axisConstraint,
  shapeIds,
  sideAxis,
  snapComputed,
  withoutOwnAlignment,
} from './shape';
import type { AxisKind } from './shape';

/** The first side a → b with the axis it gets (null = none). */
interface Side {
  readonly a: SnapTarget;
  readonly b: SnapTarget;
  readonly axis: AxisKind | null;
}

/**
 * What a click at a target does: nothing (degenerate), take the first corner, take the second
 * corner (the first side), or add the rectangle of the side and the two snapped computed corners.
 */
type Rectangle3pStep =
  | { readonly kind: 'none' }
  | { readonly kind: 'first'; readonly target: SnapTarget }
  | { readonly kind: 'side'; readonly side: Side }
  | {
      readonly kind: 'rectangle';
      readonly side: Side;
      readonly corners: readonly [SnapTarget, SnapTarget, SnapTarget, SnapTarget];
    };

/** The work in progress: the first corner, or the first side. */
type Progress =
  | { readonly kind: 'first'; readonly a: SnapTarget }
  | { readonly kind: 'side'; readonly side: Side };

export function createRectangle3pTool(sketches: SketchEditor): Tool {
  let progress: Progress | null = null;

  return clickTool(sketches, {
    reset() {
      progress = null;
    },
    onMove(ctx, session, x, y, mods) {
      const mode = snapMode(sketches, mods);
      const target = snapAt(ctx, session, x, y, mode);
      const tolerance = snapToleranceAt(ctx, session, x, y);
      if (target === null || tolerance === null) return;
      const data = sessionData(session, []);
      const step = rectangle3pStep(data, progress, target, tolerance, mode.infer);
      previewInference(session, target.at, stepInferences(step), target.guides);
      if (progress === null) return;
      // A degenerate side or rectangle is not drawn.
      switch (step.kind) {
        case 'side':
          previewPairs(ctx, session, [step.side.a.at, step.side.b.at]);
          return;
        case 'rectangle': {
          const [a, b, c, d] = step.corners;
          previewPolyline(ctx, session, [a.at, b.at, c.at, d.at, a.at]);
          return;
        }
        default:
          clearPreview(ctx);
      }
    },
    onClick(ctx, session, x, y, mods) {
      const mode = snapMode(sketches, mods);
      const target = snapAt(ctx, session, x, y, mode);
      const tolerance = snapToleranceAt(ctx, session, x, y);
      if (target === null || tolerance === null) return;
      const data = sessionData(session, []);
      const step = rectangle3pStep(data, progress, target, tolerance, mode.infer);
      switch (step.kind) {
        case 'none':
          return;
        case 'first':
          progress = { kind: 'first', a: step.target };
          return;
        case 'side':
          progress = { kind: 'side', side: step.side };
          return;
        case 'rectangle': {
          progress = null;
          clearPreview(ctx);
          const [a, b, c, d] = step.corners;
          const placed = [
            placePoint(ctx, a),
            placePoint(ctx, b),
            placePoint(ctx, c),
            placePoint(ctx, d),
          ] as const;
          const [pa, pb, pc, pd] = placed;
          const draft = rectangle3Shape([pa.id, pb.id, pc.id, pd.id], shapeIds(ctx));
          // The first curve of the draft is the side ab.
          const axis = axisConstraint(ctx, step.side.axis, draft.curves[0]?.id);
          addShape(session, placed, draft, axis);
          return;
        }
      }
    },
    onKey(ctx, _session, e) {
      if (!isPlainEscape(e) || progress === null) return false;
      progress = null;
      clearPreview(ctx);
      return true;
    },
  });
}

/**
 * The step of a click at `target` with the work in progress `progress` (null = none yet). Pure
 * over `data`, so the preview of a move can call it too.
 */
function rectangle3pStep(
  data: SketchData,
  progress: Progress | null,
  target: SnapTarget,
  tolerance: number,
  infer: boolean,
): Rectangle3pStep {
  if (progress === null) return { kind: 'first', target };
  if (progress.kind === 'first') {
    const { a } = progress;
    if (samePoint(a, target) || distance(a.at, target.at) <= MIN_LENGTH) return { kind: 'none' };
    const { target: b, axis } = sideAxis(data, a, target, infer);
    return { kind: 'side', side: { a, b, axis } };
  }
  const { side } = progress;
  const corners = rectangleFrom3(side.a.at, side.b.at, target.at);
  // A degenerate rectangle: the click is ignored and the side stays.
  if (corners === null) return { kind: 'none' };
  const computed: readonly [Vec2, Vec2] = [corners[2], corners[3]];
  const [tc, td] = snapComputed(data, computed, tolerance, infer, [side.a, side.b]);
  const [fa, fb, fc, fd] = withoutOwnAlignment([side.a, side.b, tc, td] as const);
  return { kind: 'rectangle', side, corners: [fa, fb, fc, fd] };
}

/**
 * The inferences the click of the step adds and the preview shows: of the clicked first corner,
 * of the second corner with the axis of the side, or of the computed corners c and d (the first
 * side showed its own when it was clicked).
 */
function stepInferences(step: Rectangle3pStep): readonly { readonly kind: GlyphKind }[] {
  switch (step.kind) {
    case 'none':
      return [];
    case 'first':
      return step.target.inferred;
    case 'side': {
      const { b, axis } = step.side;
      return axis === null ? b.inferred : [...b.inferred, { kind: axis }];
    }
    case 'rectangle':
      return step.corners.slice(2).flatMap((t) => t.inferred);
  }
}
