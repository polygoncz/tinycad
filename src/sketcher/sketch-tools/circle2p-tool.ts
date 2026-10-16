// The 2-point circle tool (spec 12, "Oblouky a kružnice (M27)"): two clicks are the ends of a
// diameter (circleFrom2) → a circle with a new centre point. The clicked points are no entities;
// a click snapped onto an existing point puts it on the circle (pointOnCurve, required). The
// radius equals the last circle or arc of the sketch when they differ by at most 2 %
// (inferRadius, automatic); Ctrl/Cmd turns that inference off. The click and the preview of a
// move share one step (circle2pStep), so the preview shows exactly the constraints the click adds.

import { circleFrom2, inferRadius } from '@/sketch';
import type {
  CircleFit,
  SketchConstraint,
  SketchConstraintId,
  SketchData,
  SketchEntity,
  SketchEntityId,
} from '@/sketch';
import { isPlainEscape } from '@/interaction';
import type { Tool, ToolContext } from '@/interaction';
import type { SketchEditor } from '../sketch-editor';
import type { GlyphKind } from '../sketch-glyphs';
import type { SketchSession } from '../sketch-session';
import {
  addDrawn,
  circlePoints,
  clearPreview,
  clickTool,
  lastRound,
  MIN_LENGTH,
  newConstraintId,
  newEntityId,
  previewInference,
  previewPolyline,
  snapMode,
} from './common';
import { samePoint, sessionData, snapAt } from './snap';
import type { SnapTarget } from './snap';

/**
 * What a click at a target does: nothing (coincident ends), take the first end, or add the circle
 * `fit` through the clicked `rim` targets, equal to the circle or arc `equal` (null = none).
 */
type Circle2pStep =
  | { readonly kind: 'none' }
  | { readonly kind: 'first'; readonly target: SnapTarget }
  | {
      readonly kind: 'circle';
      readonly fit: CircleFit;
      readonly target: SnapTarget;
      readonly equal: SketchEntityId | null;
    };

export function createCircle2pTool(sketches: SketchEditor): Tool {
  let first: SnapTarget | null = null;

  return clickTool(sketches, {
    reset() {
      first = null;
    },
    onMove(ctx, session, x, y, mods) {
      const mode = snapMode(sketches, mods);
      const target = snapAt(ctx, session, x, y, mode);
      if (target === null) return;
      const step = circle2pStep(sessionData(session, []), first, target, mode.infer);
      previewInference(session, target.at, stepInferences(step), target.guides);
      if (first === null) return;
      // Degenerate input draws no circle (spec 12).
      if (step.kind === 'circle') {
        previewPolyline(ctx, session, circlePoints(step.fit.center, step.fit.radius));
      } else clearPreview(ctx);
    },
    onClick(ctx, session, x, y, mods) {
      const mode = snapMode(sketches, mods);
      const target = snapAt(ctx, session, x, y, mode);
      if (target === null) return;
      const step = circle2pStep(sessionData(session, []), first, target, mode.infer);
      switch (step.kind) {
        case 'none':
          return;
        case 'first':
          first = step.target;
          return;
        case 'circle': {
          if (first === null) return;
          const rim = [first, step.target];
          first = null;
          clearPreview(ctx);
          addRimCircle(ctx, session, step.fit, rim, step.equal);
          return;
        }
      }
    },
    onKey(ctx, _session, e) {
      if (!isPlainEscape(e) || first === null) return false;
      first = null;
      clearPreview(ctx);
      return true;
    },
  });
}

/**
 * The step of a click at `target` after the first end `first` (null = none yet). Pure over
 * `data`, so the preview of a move can call it too.
 */
function circle2pStep(
  data: SketchData,
  first: SnapTarget | null,
  target: SnapTarget,
  infer: boolean,
): Circle2pStep {
  if (first === null) return { kind: 'first', target };
  if (samePoint(first, target)) return { kind: 'none' };
  const fit = circleFrom2(first.at, target.at);
  if (fit === null || fit.radius <= MIN_LENGTH) return { kind: 'none' };
  const equal = infer ? inferRadius(fit.radius, data, lastRound(data)) : null;
  return { kind: 'circle', fit, target, equal };
}

/** The inferences the click of the step adds: pointOnCurve of an existing point, and equal. */
function stepInferences(step: Circle2pStep): readonly { readonly kind: GlyphKind }[] {
  switch (step.kind) {
    case 'none':
      return [];
    case 'first':
      return rimInferences(step.target);
    case 'circle':
      return rimInferences(step.target, step.equal);
  }
}

/**
 * The constraints a click on the rim adds: pointOnCurve when it is an existing point, equal with
 * the circle or arc `equal` (null = none).
 */
export function rimInferences(
  target: SnapTarget,
  equal: SketchEntityId | null = null,
): readonly { readonly kind: GlyphKind }[] {
  const onCurve: readonly GlyphKind[] = target.point === null ? [] : ['pointOnCurve'];
  const equalRadius: readonly GlyphKind[] = equal === null ? [] : ['equal'];
  return [...onCurve, ...equalRadius].map((kind) => ({ kind }));
}

/**
 * Writes the circle `fit` with a new centre point: every existing point among `rim` gets
 * pointOnCurve (required, spec 12), `equal` an automatic equal of the radius.
 */
export function addRimCircle(
  ctx: ToolContext,
  session: SketchSession,
  fit: CircleFit,
  rim: readonly SnapTarget[],
  equal: SketchEntityId | null,
): void {
  const centerId = newEntityId(ctx);
  const id = newEntityId(ctx);
  const entities: readonly SketchEntity[] = [
    { kind: 'point', id: centerId, x: fit.center[0], y: fit.center[1] },
    { kind: 'circle', id, center: centerId, radius: fit.radius },
  ];
  const onCurve: readonly SketchConstraint[] = rim.flatMap((t) =>
    t.point === null
      ? []
      : [{ kind: 'pointOnCurve', id: newConstraintId(ctx), point: t.point, curve: id }],
  );
  const automatic: readonly SketchConstraint[] =
    equal === null ? [] : [{ kind: 'equal', id: newConstraintId(ctx), a: id, b: equal }];
  const required: ReadonlySet<SketchConstraintId> = new Set(onCurve.map((c) => c.id));
  void addDrawn(session, { entities, constraints: [...onCurve, ...automatic] }, { required });
}
