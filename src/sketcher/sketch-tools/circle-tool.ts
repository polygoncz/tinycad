// The circle tool (spec 10, "Nástroje a akce skicáře"; spec 12, M26): a centre (snapped, with its
// inferred constraints) and a point on the rim (snapped only for its place) → a circle with the
// radius > 0, equal to the last circle or arc of the sketch when the radii differ by at most 2 %
// (inferRadius); Ctrl/Cmd turns the inference off. The click and the preview of a move share one
// step (circleStep), so the preview shows exactly the constraints the click adds.
//
// The numeric input (spec 12, M32): the centre has the fields x and y, the rim the diameter (the
// rim in the direction of the cursor). A locked diameter becomes a required diameter dimension of
// the circle and replaces the automatic equal.

import { inferRadius } from '@/sketch';
import type { SketchConstraint, SketchData, SketchEntityId } from '@/sketch';
import type { Tool } from '@/interaction';
import type { InputField } from '../numeric-input';
import type { SketchEditor } from '../sketch-editor';
import type { GlyphKind } from '../sketch-glyphs';
import {
  addDrawn,
  circlePoints,
  clearPreview,
  clickTool,
  constrainPolar,
  constrainXY,
  distance,
  inputValues,
  lastRound,
  measureXY,
  MIN_LENGTH,
  newConstraintId,
  newEntityId,
  previewInference,
  previewPolyline,
  snapMode,
  withoutLocked,
  XY_FIELDS,
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

/** The field of the rim (M32): the diameter of the circle. */
const DIAMETER_FIELDS: readonly InputField[] = Object.freeze([
  Object.freeze({ id: 'diameter', kind: 'length' }),
]);

export function createCircleTool(sketches: SketchEditor): Tool {
  let center: SnapTarget | null = null;

  return clickTool(sketches, {
    reset() {
      center = null;
    },
    hint() {
      return center === null ? 'hint.circle.center' : 'hint.circle.rim';
    },
    inputFields() {
      return center === null ? XY_FIELDS : DIAMETER_FIELDS;
    },
    constrain(cursor, values) {
      if (center === null) return constrainXY(cursor, values);
      const diameter = values.get('diameter');
      if (diameter === undefined) return cursor;
      return constrainPolar(center.at, cursor, new Map([['length', diameter / 2]]));
    },
    measure(at) {
      if (center === null) return measureXY(at);
      return new Map([['diameter', 2 * distance(center.at, at)]]);
    },
    onMove(ctx, session, x, y, mods) {
      const mode = snapMode(sketches, mods);
      const target = snapAt(ctx, session, x, y, mode);
      if (target === null) return;
      const diameter = inputValues(mods).get('diameter') ?? null;
      const step = circleStep(sessionData(session, []), center, target, mode.infer, diameter);
      previewInference(session, target.at, stepInferences(step), target.guides);
      if (center === null) return;
      previewPolyline(ctx, session, circlePoints(center.at, distance(center.at, target.at)));
    },
    onClick(ctx, session, x, y, mods) {
      const mode = snapMode(sketches, mods);
      const target = snapAt(ctx, session, x, y, mode);
      if (target === null) return;
      const diameter = inputValues(mods).get('diameter') ?? null;
      const step = circleStep(sessionData(session, []), center, target, mode.infer, diameter);
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
          const typed: readonly SketchConstraint[] =
            diameter === null
              ? []
              : [{ kind: 'diameter', id: newConstraintId(ctx), curve: id, value: diameter }];
          void addDrawn(
            session,
            {
              entities: [...c.entities, { kind: 'circle', id, center: c.id, radius }],
              constraints: [...c.constraints, ...constraints, ...typed],
            },
            { required: new Set(typed.map((t) => t.id)) },
          );
          return;
        }
      }
    },
  });
}

/**
 * The step of a click at `target` after the centre `center` (null = none yet); the rim snaps only
 * for its place. The entered `diameter` (M32, null = none) sets the radius exactly and replaces
 * the automatic equal (a locked size, withoutLocked). Pure over `data`, so the preview of a
 * move can call it too.
 */
function circleStep(
  data: SketchData,
  center: SnapTarget | null,
  target: SnapTarget,
  infer: boolean,
  diameter: number | null,
): CircleStep {
  if (center === null) return { kind: 'center', target };
  const radius = diameter === null ? distance(center.at, target.at) : diameter / 2;
  // A rim on the centre has no direction, even with an entered diameter.
  if (distance(center.at, target.at) <= MIN_LENGTH) return { kind: 'none' };
  const round = infer ? inferRadius(radius, data, lastRound(data)) : null;
  // A locked diameter is exact (M32): it replaces the automatic equal.
  const [equal] = withoutLocked(round === null ? [] : [{ kind: 'equal', with: round }], {
    direction: false,
    size: diameter !== null,
  });
  return { kind: 'circle', radius, equal: equal?.with ?? null };
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
