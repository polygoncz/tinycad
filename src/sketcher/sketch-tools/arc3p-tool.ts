// The 3-point arc tool (spec 12, "Oblouky a kružnice (M27)"): a start and an end (both snapped,
// with their inferred constraints) and a point on the arc → the arc arcFrom3(start, through, end)
// around a new centre point. The point on the arc is not an entity (the arc has only its centre
// and ends); snapped onto an existing point it adds pointOnCurve(point, arc), which is required.
// An arc is always counter-clockwise in the data, so a clockwise fit swaps its start and end. The
// radius infers equal with the last circle or arc (inferRadius); Ctrl/Cmd turns the automatic
// constraints off. The click and the preview of a move share one step (arc3pStep).

import { arcFrom3, inferRadius } from '@/sketch';
import type { ArcFit, SketchConstraint, SketchData, SketchEntityId } from '@/sketch';
import type { Tool, ToolContext } from '@/interaction';
import { isPlainEscape } from '@/interaction';
import type { SketchEditor } from '../sketch-editor';
import type { GlyphKind } from '../sketch-glyphs';
import type { SketchSession } from '../sketch-session';
import {
  addDrawn,
  clearPreview,
  clickTool,
  distance,
  lastRound,
  MIN_LENGTH,
  newConstraintId,
  newEntityId,
  previewArcFit,
  previewInference,
  previewPairs,
  snapMode,
} from './common';
import { freeTarget, placePoint, samePoint, sessionData, snapAt } from './snap';
import type { SnapTarget } from './snap';

/**
 * What a click at a target does: nothing, take the start, take the end, or add the arc `fit`
 * through the existing point `through` (null = a place only), equal to the circle or arc `equal`
 * (null = none).
 */
type Arc3pStep =
  | { readonly kind: 'none' }
  | { readonly kind: 'start' | 'end'; readonly target: SnapTarget }
  | {
      readonly kind: 'arc';
      readonly fit: ArcFit;
      readonly through: SketchEntityId | null;
      readonly equal: SketchEntityId | null;
    };

export function createArc3pTool(sketches: SketchEditor): Tool {
  let start: SnapTarget | null = null;
  let end: SnapTarget | null = null;

  return clickTool(sketches, {
    reset() {
      start = null;
      end = null;
    },
    onMove(ctx, session, x, y, mods) {
      const mode = snapMode(sketches, mods);
      const cursor = snapAt(ctx, session, x, y, mode);
      if (cursor === null) return;
      const step = arc3pStep(sessionData(session, []), { start, end }, cursor, mode.infer);
      previewInference(session, cursor.at, stepInferences(step), cursor.guides);
      if (start === null) return;
      if (end === null) {
        previewPairs(ctx, session, [start.at, cursor.at]);
        return;
      }
      if (step.kind !== 'arc') {
        // A degenerate arc (the point on the line start–end) is not drawn.
        clearPreview(ctx);
        return;
      }
      previewArcFit(ctx, session, step.fit, start.at, end.at);
    },
    onClick(ctx, session, x, y, mods) {
      const mode = snapMode(sketches, mods);
      const target = snapAt(ctx, session, x, y, mode);
      if (target === null) return;
      const step = arc3pStep(sessionData(session, []), { start, end }, target, mode.infer);
      switch (step.kind) {
        case 'none':
          return;
        case 'start':
          start = step.target;
          return;
        case 'end':
          end = step.target;
          return;
        case 'arc': {
          if (start === null || end === null) return;
          const picked = { start, end };
          start = null;
          end = null;
          clearPreview(ctx);
          addArc(ctx, session, picked, step);
          return;
        }
      }
    },
    onKey(ctx, _session, e) {
      if (!isPlainEscape(e) || start === null) return false;
      // Escape forgets the picked points; a second one ends the tool.
      start = null;
      end = null;
      clearPreview(ctx);
      return true;
    },
  });
}

/**
 * The step of a click at `target` after the start and the end picked so far (null = not yet).
 * Pure over `data`, so the preview of a move can call it too.
 */
function arc3pStep(
  data: SketchData,
  picked: { readonly start: SnapTarget | null; readonly end: SnapTarget | null },
  target: SnapTarget,
  infer: boolean,
): Arc3pStep {
  const { start, end } = picked;
  if (start === null) return { kind: 'start', target };
  if (end === null) {
    if (samePoint(start, target) || distance(start.at, target.at) <= MIN_LENGTH) {
      return { kind: 'none' };
    }
    return { kind: 'end', target };
  }
  if (samePoint(start, target) || samePoint(end, target)) return { kind: 'none' };
  const fit = arcFrom3(start.at, target.at, end.at);
  if (fit === null || fit.radius <= MIN_LENGTH) return { kind: 'none' };
  const equal = infer ? inferRadius(fit.radius, data, lastRound(data)) : null;
  return { kind: 'arc', fit, through: target.point, equal };
}

/** The inferences the click of the step adds: of the picked point, or of the point on the arc and equal. */
function stepInferences(step: Arc3pStep): readonly { readonly kind: GlyphKind }[] {
  switch (step.kind) {
    case 'none':
      return [];
    case 'start':
    case 'end':
      return step.target.inferred;
    case 'arc':
      return [
        ...(step.through === null ? [] : [{ kind: 'pointOnCurve' as const }]),
        ...(step.equal === null ? [] : [{ kind: 'equal' as const }]),
      ];
  }
}

/**
 * Adds the arc around a new centre: start → end when the fit is counter-clockwise, otherwise end
 * → start; pointOnCurve of the point on the arc is required.
 */
function addArc(
  ctx: ToolContext,
  session: SketchSession,
  picked: { readonly start: SnapTarget; readonly end: SnapTarget },
  step: Extract<Arc3pStep, { kind: 'arc' }>,
): void {
  const { fit, through, equal } = step;
  const c = placePoint(ctx, freeTarget(fit.center));
  const s = placePoint(ctx, picked.start);
  const e = placePoint(ctx, picked.end);
  const id: SketchEntityId = newEntityId(ctx);
  const [from, to] = fit.ccw ? [s, e] : [e, s];
  const onArc: readonly SketchConstraint[] =
    through === null
      ? []
      : [{ kind: 'pointOnCurve', id: newConstraintId(ctx), point: through, curve: id }];
  const equals: readonly SketchConstraint[] =
    equal === null ? [] : [{ kind: 'equal', id: newConstraintId(ctx), a: id, b: equal }];
  void addDrawn(
    session,
    {
      entities: [
        ...c.entities,
        ...s.entities,
        ...e.entities,
        { kind: 'arc', id, center: c.id, start: from.id, end: to.id },
      ],
      constraints: [...s.constraints, ...e.constraints, ...onArc, ...equals],
    },
    { required: new Set(onArc.map((k) => k.id)) },
  );
}
