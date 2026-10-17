// The 3-point circle tool (spec 12, "Oblouky a kružnice (M27)"): three clicks on the rim → the
// circumscribed circle (circleFrom3) with a new centre point. The clicked points are no entities;
// a click snapped onto an existing point puts it on the circle (pointOnCurve, required). The
// radius equals the last circle or arc of the sketch when they differ by at most 2 %
// (inferRadius, automatic); Ctrl/Cmd turns that inference off. The click and the preview of a
// move share one step (circle3pStep), so the preview shows exactly the constraints the click adds.

import { vec2 } from '@/core';
import { circleFrom3, inferRadius } from '@/sketch';
import type { CircleFit, SketchData, SketchEntityId } from '@/sketch';
import { isPlainEscape } from '@/interaction';
import type { Tool } from '@/interaction';
import type { SketchEditor } from '../sketch-editor';
import type { GlyphKind } from '../sketch-glyphs';
import {
  MIN_LENGTH,
  circlePoints,
  clearPreview,
  clickTool,
  lastRound,
  previewInference,
  previewPairs,
  previewPolyline,
  snapMode,
} from './common';
import { addRimCircle, rimInferences } from './circle2p-tool';
import { samePoint, sessionData, snapAt } from './snap';
import type { SnapTarget } from './snap';

/**
 * What a click at a target does: nothing (a point coincident with a picked one, three points on a
 * line), take one more rim point, or add the circle `fit` (the target is its third rim point),
 * equal to the circle or arc `equal` (null = none).
 */
type Circle3pStep =
  | { readonly kind: 'none' }
  | { readonly kind: 'pick'; readonly target: SnapTarget }
  | {
      readonly kind: 'circle';
      readonly fit: CircleFit;
      readonly target: SnapTarget;
      readonly equal: SketchEntityId | null;
    };

/** The hint keys by the number of picked points (M37). */
const CIRCLE3P_HINTS: readonly string[] = [
  'hint.circle3p.first',
  'hint.circle3p.second',
  'hint.circle3p.third',
];

export function createCircle3pTool(sketches: SketchEditor): Tool {
  let picked: readonly SnapTarget[] = [];

  return clickTool(sketches, {
    reset() {
      picked = [];
    },
    hint() {
      return CIRCLE3P_HINTS[picked.length] ?? null;
    },
    onMove(ctx, session, x, y, mods) {
      const mode = snapMode(sketches, mods);
      const target = snapAt(ctx, session, x, y, mode);
      if (target === null) return;
      const step = circle3pStep(sessionData(session, []), picked, target, mode.infer);
      previewInference(session, target.at, stepInferences(step), target.guides);
      const [a] = picked;
      if (a === undefined) return;
      // Degenerate input draws no circle (spec 12); after one point the chord to the cursor.
      if (step.kind === 'circle') {
        previewPolyline(ctx, session, circlePoints(step.fit.center, step.fit.radius));
      } else if (picked.length === 1 && step.kind === 'pick') {
        previewPairs(ctx, session, [a.at, target.at]);
      } else {
        clearPreview(ctx);
      }
    },
    onClick(ctx, session, x, y, mods) {
      const mode = snapMode(sketches, mods);
      const target = snapAt(ctx, session, x, y, mode);
      if (target === null) return;
      const step = circle3pStep(sessionData(session, []), picked, target, mode.infer);
      switch (step.kind) {
        case 'none':
          return;
        case 'pick':
          picked = [...picked, step.target];
          return;
        case 'circle': {
          const rim = [...picked, step.target];
          picked = [];
          clearPreview(ctx);
          addRimCircle(ctx, session, step.fit, rim, step.equal);
          return;
        }
      }
    },
    onKey(ctx, _session, e) {
      if (!isPlainEscape(e) || picked.length === 0) return false;
      picked = [];
      clearPreview(ctx);
      return true;
    },
  });
}

/**
 * The step of a click at `target` after the rim points `picked` so far (0 to 2). Pure over
 * `data`, so the preview of a move can call it too.
 */
function circle3pStep(
  data: SketchData,
  picked: readonly SnapTarget[],
  target: SnapTarget,
  infer: boolean,
): Circle3pStep {
  const coincident = picked.some(
    (p) => samePoint(p, target) || vec2.dist(p.at, target.at) <= MIN_LENGTH,
  );
  if (coincident) return { kind: 'none' };
  const [a, b] = picked;
  if (a === undefined || b === undefined) return { kind: 'pick', target };
  const fit = circleFrom3(a.at, b.at, target.at);
  if (fit === null || fit.radius <= MIN_LENGTH) return { kind: 'none' };
  const equal = infer ? inferRadius(fit.radius, data, lastRound(data)) : null;
  return { kind: 'circle', fit, target, equal };
}

/** The inferences the click of the step adds: pointOnCurve of an existing point, and equal. */
function stepInferences(step: Circle3pStep): readonly { readonly kind: GlyphKind }[] {
  switch (step.kind) {
    case 'none':
      return [];
    case 'pick':
      return rimInferences(step.target);
    case 'circle':
      return rimInferences(step.target, step.equal);
  }
}
