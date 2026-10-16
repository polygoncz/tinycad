// The point tool (spec 12, "Nové kreslicí nástroje (M31)"): a click → a lone point through the
// snapper with its inferred constraints (on a curve → pointOnCurve, the origin → fix …, all
// automatic); a click on an existing point makes nothing. The tool keeps no work in progress, so
// Escape ends it. The click and the preview of a move share one step (pointStep).

import type { PointInference } from '@/sketch';
import type { Tool } from '@/interaction';
import type { SketchEditor } from '../sketch-editor';
import { addDrawn, clickTool, previewInference, snapMode } from './common';
import { placePoint, snapAt } from './snap';
import type { SnapTarget } from './snap';

/** What a click at a target does: nothing (an existing point) or add a new point. */
type PointStep =
  { readonly kind: 'none' } | { readonly kind: 'point'; readonly target: SnapTarget };

export function createPointTool(sketches: SketchEditor): Tool {
  return clickTool(sketches, {
    reset() {
      // No work in progress.
    },
    onMove(ctx, session, x, y, mods) {
      const target = snapAt(ctx, session, x, y, snapMode(sketches, mods));
      if (target === null) return;
      previewInference(session, target.at, stepInferences(pointStep(target)), target.guides);
    },
    onClick(ctx, session, x, y, mods) {
      const target = snapAt(ctx, session, x, y, snapMode(sketches, mods));
      if (target === null) return;
      const step = pointStep(target);
      if (step.kind === 'none') return;
      const point = placePoint(ctx, step.target);
      void addDrawn(session, { entities: point.entities, constraints: point.constraints });
    },
  });
}

function pointStep(target: SnapTarget): PointStep {
  return target.point === null ? { kind: 'point', target } : { kind: 'none' };
}

function stepInferences(step: PointStep): readonly PointInference[] {
  return step.kind === 'point' ? step.target.inferred : [];
}
