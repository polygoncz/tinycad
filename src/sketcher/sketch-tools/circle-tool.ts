// The circle tool (spec 10, "Nástroje a akce skicáře"; spec 12, M26): a centre (snapped, with its
// inferred constraints) and a point on the rim (snapped only for its place) → a circle with the
// radius > 0, equal to the last circle or arc of the sketch when the radii differ by at most 2 %
// (inferRadius); Ctrl/Cmd turns the inference off. The click and the preview of a move share one
// step (circleStep), so the preview shows exactly the constraints the click adds.

import { inferRadius } from '@/sketch';
import type { SketchConstraint, SketchData, SketchEntityId } from '@/sketch';
import type { Tool } from '@/interaction';
import type { SketchEditor } from '../sketch-editor';
import type { GlyphKind } from '../sketch-glyphs';
import {
  addDrawn,
  circlePoints,
  clearPreview,
  clickTool,
  distance,
  lastRound,
  MIN_LENGTH,
  newConstraintId,
  newEntityId,
  previewInference,
  previewPolyline,
  snapMode,
} from './common';
import { placePoint, sessionData, snapAt } from './snap';
import type { SnapTarget } from './snap';

/**
 * What a click at a target does: nothing (a zero radius), take the centre, or add the circle of
 * `radius`, equal to the circle or arc `equal` (null = none).
 */
type CircleStep =
  | { readonly kind: 'none' }
  | { readonly kind: 'center'; readonly target: SnapTarget }
  | { readonly kind: 'circle'; readonly radius: number; readonly equal: SketchEntityId | null };

export function createCircleTool(sketches: SketchEditor): Tool {
  let center: SnapTarget | null = null;

  return clickTool(sketches, {
    reset() {
      center = null;
    },
    onMove(ctx, session, x, y, mods) {
      const mode = snapMode(sketches, mods);
      const target = snapAt(ctx, session, x, y, mode);
      if (target === null) return;
      const step = circleStep(sessionData(session, []), center, target, mode.infer);
      previewInference(session, target.at, stepInferences(step), target.guides);
      if (center === null) return;
      previewPolyline(ctx, session, circlePoints(center.at, distance(center.at, target.at)));
    },
    onClick(ctx, session, x, y, mods) {
      const mode = snapMode(sketches, mods);
      const target = snapAt(ctx, session, x, y, mode);
      if (target === null) return;
      const step = circleStep(sessionData(session, []), center, target, mode.infer);
      switch (step.kind) {
        case 'none':
          return;
        case 'center':
          center = step.target;
          return;
        case 'circle': {
          if (center === null) return;
          const { radius, equal } = step;
          const c = placePoint(ctx, center);
          center = null;
          clearPreview(ctx);
          const id: SketchEntityId = newEntityId(ctx);
          const constraints: readonly SketchConstraint[] =
            equal === null ? [] : [{ kind: 'equal', id: newConstraintId(ctx), a: id, b: equal }];
          void addDrawn(session, {
            entities: [...c.entities, { kind: 'circle', id, center: c.id, radius }],
            constraints: [...c.constraints, ...constraints],
          });
          return;
        }
      }
    },
  });
}

/**
 * The step of a click at `target` after the centre `center` (null = none yet); the rim snaps only
 * for its place. Pure over `data`, so the preview of a move can call it too.
 */
function circleStep(
  data: SketchData,
  center: SnapTarget | null,
  target: SnapTarget,
  infer: boolean,
): CircleStep {
  if (center === null) return { kind: 'center', target };
  const radius = distance(center.at, target.at);
  if (radius <= MIN_LENGTH) return { kind: 'none' };
  const equal = infer ? inferRadius(radius, data, lastRound(data)) : null;
  return { kind: 'circle', radius, equal };
}

/** The inferences the click of the step adds: of the centre, or equal of the circle. */
function stepInferences(step: CircleStep): readonly { readonly kind: GlyphKind }[] {
  switch (step.kind) {
    case 'none':
      return [];
    case 'center':
      return step.target.inferred;
    case 'circle':
      return step.equal === null ? [] : [{ kind: 'equal' }];
  }
}
