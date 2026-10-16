// The arc tool (spec 10, "Nástroje a akce skicáře"; spec 12, M26): a centre, a start (both
// snapped, with their inferred constraints) and an end (snapped, then projected onto the circle
// through the start; always a new point without inferred constraints or guides, which would not
// hold after the projection) → a counter-clockwise arc from start to end, equal to the last circle or arc
// of the sketch when the radii differ by at most 2 % (inferRadius); Ctrl/Cmd turns the inference
// off. The click and the preview of a move share one step (arcStep), so the preview shows exactly
// the constraints the click adds.
//
// The numeric input (spec 12, M32): the centre has the fields x and y, the start radius and angle
// from the centre, the end the sweep from the start (counter-clockwise; ≤ 0 is a degenerate step).
// A locked radius becomes a required radius dimension of the arc and replaces the automatic equal;
// the angles have no dimension.

import type { Vec2 } from '@/core';
import { inferRadius } from '@/sketch';
import type { SketchConstraint, SketchData, SketchEntityId } from '@/sketch';
import type { Tool } from '@/interaction';
import type { InputField } from '../numeric-input';
import type { SketchEditor } from '../sketch-editor';
import type { GlyphKind } from '../sketch-glyphs';
import {
  addDrawn,
  arcPoints,
  clearPreview,
  clickTool,
  constrainPolar,
  constrainXY,
  distance,
  inputValues,
  lastRound,
  measurePolar,
  measureXY,
  MIN_LENGTH,
  newConstraintId,
  newEntityId,
  previewInference,
  previewPairs,
  previewPolyline,
  snapMode,
  XY_FIELDS,
} from './common';
import { ccwSweep } from '../sketch-angles';
import { freeTarget, placePoint, samePoint, sessionData, snapAt } from './snap';
import type { SnapTarget } from './snap';

/**
 * What a click at a target does: nothing, take the centre, take the start, or add the arc to the
 * new end point `end` (projected onto the circle, without inferences), equal to the circle or
 * arc `equal` (null = none).
 */
type ArcStep =
  | { readonly kind: 'none' }
  | { readonly kind: 'center' | 'start'; readonly target: SnapTarget }
  | { readonly kind: 'arc'; readonly end: SnapTarget; readonly equal: SketchEntityId | null };

/** The fields of the start (M32): its radius and angle from the centre. */
const START_FIELDS: readonly InputField[] = Object.freeze([
  Object.freeze({ id: 'radius', kind: 'length' }),
  Object.freeze({ id: 'angle', kind: 'angle' }),
]);

/** The field of the end (M32): the sweep of the arc from the start. */
const END_FIELDS: readonly InputField[] = Object.freeze([
  Object.freeze({ id: 'sweep', kind: 'angle' }),
]);

export function createArcTool(sketches: SketchEditor): Tool {
  let center: SnapTarget | null = null;
  let start: SnapTarget | null = null;
  /** The locked radius of the start (M32), written as the dimension with the arc; null = none. */
  let radius: number | null = null;

  return clickTool(sketches, {
    reset() {
      center = null;
      start = null;
      radius = null;
    },
    inputFields() {
      if (center === null) return XY_FIELDS;
      return start === null ? START_FIELDS : END_FIELDS;
    },
    constrain(_session, cursor, values) {
      if (center === null) return constrainXY(cursor, values);
      if (start === null) return constrainPolar(center.at, cursor, polarOf(values));
      return constrainSweep(center.at, start.at, cursor, values);
    },
    measure(_session, at) {
      if (center === null) return measureXY(at);
      if (start === null) {
        const polar = measurePolar(center.at, at);
        return new Map([
          ['radius', polar.get('length') ?? 0],
          ['angle', polar.get('angle') ?? 0],
        ]);
      }
      const end = project(center.at, start.at, at);
      const sweep = end === null ? 0 : ccwSweep(angle(center.at, start.at), angle(center.at, end));
      return new Map([['sweep', sweep]]);
    },
    onMove(ctx, session, x, y, mods) {
      const mode = snapMode(sketches, mods);
      const cursor = snapAt(ctx, session, x, y, mode);
      if (cursor === null) return;
      const picked = { center, start, radius: start === null ? null : radius };
      const step = arcStep(sessionData(session, []), picked, cursor, mode.infer);
      const at = step.kind === 'arc' ? step.end.at : cursor.at;
      // The end gets no guides: they hold at the cursor, not at the projected end.
      const guides = start === null ? cursor.guides : [];
      previewInference(session, at, stepInferences(step), guides);
      if (center === null) return;
      if (start === null) {
        previewPairs(ctx, session, [center.at, cursor.at]);
        return;
      }
      const end = project(center.at, start.at, cursor.at);
      if (end === null) return;
      const from = angle(center.at, start.at);
      const sweep = ccwSweep(from, angle(center.at, end));
      previewPolyline(
        ctx,
        session,
        arcPoints(center.at, distance(center.at, start.at), from, sweep),
      );
    },
    onClick(ctx, session, x, y, mods) {
      const mode = snapMode(sketches, mods);
      const target = snapAt(ctx, session, x, y, mode);
      if (target === null) return;
      const picked = { center, start, radius };
      const step = arcStep(sessionData(session, []), picked, target, mode.infer);
      switch (step.kind) {
        case 'none':
          return;
        case 'center':
          center = step.target;
          return;
        case 'start':
          start = step.target;
          radius = inputValues(mods).get('radius') ?? null;
          return;
        case 'arc': {
          if (center === null || start === null) return;
          const { equal } = step;
          const typedRadius = radius;
          const c = placePoint(ctx, center);
          const s = placePoint(ctx, start);
          const e = placePoint(ctx, step.end);
          center = null;
          start = null;
          radius = null;
          clearPreview(ctx);
          const id: SketchEntityId = newEntityId(ctx);
          const constraints: readonly SketchConstraint[] =
            equal === null ? [] : [{ kind: 'equal', id: newConstraintId(ctx), a: id, b: equal }];
          const typed: readonly SketchConstraint[] =
            typedRadius === null
              ? []
              : [{ kind: 'radius', id: newConstraintId(ctx), curve: id, value: typedRadius }];
          void addDrawn(
            session,
            {
              entities: [
                ...c.entities,
                ...s.entities,
                ...e.entities,
                { kind: 'arc', id, center: c.id, start: s.id, end: e.id },
              ],
              constraints: [
                ...c.constraints,
                ...s.constraints,
                ...e.constraints,
                ...constraints,
                ...typed,
              ],
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
 * The step of a click at `target` after the centre and the start picked so far (null = not yet);
 * `radius` = the locked radius of the start (M32), which replaces the automatic equal. Pure over
 * `data`, so the preview of a move can call it too.
 */
function arcStep(
  data: SketchData,
  picked: {
    readonly center: SnapTarget | null;
    readonly start: SnapTarget | null;
    readonly radius: number | null;
  },
  target: SnapTarget,
  infer: boolean,
): ArcStep {
  const { center, start } = picked;
  if (center === null) return { kind: 'center', target };
  if (start === null) {
    if (samePoint(center, target) || distance(center.at, target.at) <= MIN_LENGTH) {
      return { kind: 'none' };
    }
    return { kind: 'start', target };
  }
  // The end is always a new point: projecting an existing point would move it.
  const at = project(center.at, start.at, target.at);
  if (at === null || distance(at, start.at) <= MIN_LENGTH) return { kind: 'none' };
  const radius = distance(center.at, start.at);
  const equal = infer && picked.radius === null ? inferRadius(radius, data, lastRound(data)) : null;
  // No inferences of the snap: they hold at the cursor, not at the projected end (spec 12).
  return { kind: 'arc', end: freeTarget(at), equal };
}

/** The inferences the click of the step adds: of the picked point, or of the end and equal. */
function stepInferences(step: ArcStep): readonly { readonly kind: GlyphKind }[] {
  switch (step.kind) {
    case 'none':
      return [];
    case 'center':
    case 'start':
      return step.target.inferred;
    case 'arc':
      return step.equal === null ? [] : [{ kind: 'equal' }];
  }
}

const angle = (center: Vec2, p: Vec2): number => Math.atan2(p[1] - center[1], p[0] - center[0]);

/** The cursor projected onto the circle around center through start; null on the centre. */
function project(center: Vec2, start: Vec2, cursor: Vec2): Vec2 | null {
  const d = distance(center, cursor);
  if (d <= MIN_LENGTH) return null;
  const r = distance(center, start);
  return [
    center[0] + ((cursor[0] - center[0]) * r) / d,
    center[1] + ((cursor[1] - center[1]) * r) / d,
  ];
}

/** The entered `radius` and `angle` of the start as the `length` and `angle` of constrainPolar. */
function polarOf(values: ReadonlyMap<string, number>): ReadonlyMap<string, number> {
  const polar = new Map<string, number>();
  const radius = values.get('radius');
  const direction = values.get('angle');
  if (radius !== undefined) polar.set('length', radius);
  if (direction !== undefined) polar.set('angle', direction);
  return polar;
}

/**
 * The end for the cursor and the entered `sweep` (spec 12, M32): on the circle through the start
 * at the angle of the start + sweep. A sweep ≤ 0 is a degenerate step: the start itself, which
 * arcStep refuses.
 */
function constrainSweep(
  center: Vec2,
  start: Vec2,
  cursor: Vec2,
  values: ReadonlyMap<string, number>,
): Vec2 {
  const sweep = values.get('sweep');
  if (sweep === undefined) return cursor;
  if (sweep <= 0) return start;
  const r = distance(center, start);
  const to = angle(center, start) + sweep;
  return [center[0] + r * Math.cos(to), center[1] + r * Math.sin(to)];
}
