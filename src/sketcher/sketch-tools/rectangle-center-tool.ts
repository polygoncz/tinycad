// The center rectangle tool (spec 12, "Nové kreslicí nástroje (M31)"): the centre and one corner
// → an axis-parallel rectangle (rectangleFromCenter) held by rectangleCenterShape: 4 lines, a
// construction diagonal, horizontals, verticals and the midpoint of the centre on the diagonal
// (required). The centre and the corner go through the snapper; the three computed corners too,
// at their place, without the grid and never onto the clicked points. A degenerate rectangle
// makes nothing. The click and the preview of a move share one step (rectangleCenterStep).

import type { Vec2 } from '@/core';
import { rectangleCenterShape, rectangleFromCenter } from '@/sketch';
import type { PointInference, SketchData } from '@/sketch';
import { isPlainEscape } from '@/interaction';
import type { Tool } from '@/interaction';
import type { SketchEditor } from '../sketch-editor';
import { clearPreview, clickTool, previewInference, previewPairs, snapMode } from './common';
import { placePoint, samePoint, sessionData, snapAt, snapToleranceAt } from './snap';
import type { SnapTarget } from './snap';
import { addShape, shapeIds, snapComputed, withoutOwnAlignment } from './shape';

/** Corners a, b, c, d (lines ab, bc, cd, da); c is the clicked corner. */
type Corners = readonly [SnapTarget, SnapTarget, SnapTarget, SnapTarget];

/**
 * What a click at a target does: nothing (a degenerate rectangle), take the centre, or add the
 * rectangle of the centre and the four snapped corners.
 */
type RectangleCenterStep =
  | { readonly kind: 'none' }
  | { readonly kind: 'center'; readonly target: SnapTarget }
  | { readonly kind: 'rectangle'; readonly center: SnapTarget; readonly corners: Corners };

export function createRectangleCenterTool(sketches: SketchEditor): Tool {
  let center: SnapTarget | null = null;

  return clickTool(sketches, {
    reset() {
      center = null;
    },
    onMove(ctx, session, x, y, mods) {
      const mode = snapMode(sketches, mods);
      const target = snapAt(ctx, session, x, y, mode);
      const tolerance = snapToleranceAt(ctx, session, x, y);
      if (target === null || tolerance === null) return;
      const data = sessionData(session, []);
      const step = rectangleCenterStep(data, center, target, tolerance, mode.infer);
      previewInference(session, target.at, stepInferences(step), target.guides);
      if (center === null) return;
      // A degenerate rectangle is not drawn.
      if (step.kind === 'rectangle') previewPairs(ctx, session, outline(step.corners));
      else clearPreview(ctx);
    },
    onClick(ctx, session, x, y, mods) {
      const mode = snapMode(sketches, mods);
      const target = snapAt(ctx, session, x, y, mode);
      const tolerance = snapToleranceAt(ctx, session, x, y);
      if (target === null || tolerance === null) return;
      const data = sessionData(session, []);
      const step = rectangleCenterStep(data, center, target, tolerance, mode.infer);
      switch (step.kind) {
        case 'none':
          return;
        case 'center':
          center = step.target;
          return;
        case 'rectangle': {
          center = null;
          clearPreview(ctx);
          const placedCenter = placePoint(ctx, step.center);
          const [a, b, c, d] = step.corners;
          const placed = [
            placePoint(ctx, a),
            placePoint(ctx, b),
            placePoint(ctx, c),
            placePoint(ctx, d),
          ] as const;
          const [pa, pb, pc, pd] = placed;
          const draft = rectangleCenterShape(
            [pa.id, pb.id, pc.id, pd.id],
            placedCenter.id,
            shapeIds(ctx),
          );
          addShape(session, [placedCenter, ...placed], draft);
          return;
        }
      }
    },
    onKey(ctx, _session, e) {
      if (!isPlainEscape(e) || center === null) return false;
      center = null;
      clearPreview(ctx);
      return true;
    },
  });
}

/**
 * The step of a click at `target` after the centre `center` (null = none yet). Pure over `data`,
 * so the preview of a move can call it too.
 */
function rectangleCenterStep(
  data: SketchData,
  center: SnapTarget | null,
  target: SnapTarget,
  tolerance: number,
  infer: boolean,
): RectangleCenterStep {
  if (center === null) return { kind: 'center', target };
  if (samePoint(center, target)) return { kind: 'none' };
  const corners = rectangleFromCenter(center.at, target.at);
  // A degenerate rectangle: the click is ignored and the centre stays.
  if (corners === null) return { kind: 'none' };
  const [a, b, , d] = corners;
  const computed = [a, b, d] as const;
  const [ta, tb, td] = snapComputed(data, computed, tolerance, infer, [center, target]);
  const [fc, fa, fb, fc2, fd] = withoutOwnAlignment([center, ta, tb, target, td] as const);
  return { kind: 'rectangle', center: fc, corners: [fa, fb, fc2, fd] };
}

/**
 * The inferences the click of the step adds and the preview shows: of the clicked centre, or of
 * the four corners (the centre showed its own when it was clicked).
 */
function stepInferences(step: RectangleCenterStep): readonly PointInference[] {
  switch (step.kind) {
    case 'none':
      return [];
    case 'center':
      return step.target.inferred;
    case 'rectangle':
      return step.corners.flatMap((t) => t.inferred);
  }
}

/** The sides ab, bc, cd, da and the diagonal ac as overlay pairs. */
function outline(corners: Corners): readonly Vec2[] {
  const [a, b, c, d] = corners;
  return [a.at, b.at, b.at, c.at, c.at, d.at, d.at, a.at, a.at, c.at];
}
