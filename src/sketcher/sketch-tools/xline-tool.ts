// The construction line tool (spec 12, "Nové kreslicí nástroje (M31)"): two clicks are two points
// of an infinite construction line (xline, always construction: true). Both points go through the
// snapper with their inferred constraints; the line gets horizontal or vertical from inferLine
// within 3° (automatic, B3); Ctrl/Cmd turns it off. Two clicks on one place make nothing. After a
// line the tool stays for the next one. The click and the preview of a move share one step
// (xlineStep).
//
// The numeric input (spec 12, M32): the first point has the fields x and y, the second length and
// angle from the first. The length only places the second point (no dimension); a locked angle
// replaces the automatic axis: 0/180° → a required horizontal, 90/270° → vertical, another angle
// none.

import type { Vec2 } from '@/core';
import { XLINE_EXTENT } from '@/sketch';
import type { SketchData, SketchXLine } from '@/sketch';
import { isPlainEscape } from '@/interaction';
import type { Tool } from '@/interaction';
import type { SketchEditor } from '../sketch-editor';
import type { GlyphKind } from '../sketch-glyphs';
import {
  MIN_LENGTH,
  POLAR_FIELDS,
  XY_FIELDS,
  addDrawn,
  axisOfAngle,
  clearPreview,
  clickTool,
  constrainPolar,
  constrainXY,
  distance,
  inputValues,
  measurePolar,
  measureXY,
  newEntityId,
  previewInference,
  previewPairs,
  snapMode,
} from './common';
import { placePoint, samePoint, sessionData, snapAt } from './snap';
import type { SnapTarget } from './snap';
import { axisConstraint, sideAxis } from './shape';
import type { AxisKind } from './shape';

/**
 * What a click at a target does: nothing (on the first point), take the first point, or add the
 * line through the first point and `target` with its axis (null = none).
 */
type XLineStep =
  | { readonly kind: 'none' }
  | { readonly kind: 'first'; readonly target: SnapTarget }
  | {
      readonly kind: 'xline';
      readonly target: SnapTarget;
      readonly axis: AxisKind | null;
      /** The axis is of a locked angle (M32): required, not automatic. */
      readonly typed: boolean;
    };

export function createXLineTool(sketches: SketchEditor): Tool {
  let first: SnapTarget | null = null;

  return clickTool(sketches, {
    reset() {
      first = null;
    },
    hint() {
      return first === null ? 'hint.xline.first' : 'hint.xline.second';
    },
    inputFields() {
      return first === null ? XY_FIELDS : POLAR_FIELDS;
    },
    constrain(cursor, values) {
      return first === null
        ? constrainXY(cursor, values)
        : constrainPolar(first.at, cursor, values);
    },
    measure(at) {
      return first === null ? measureXY(at) : measurePolar(first.at, at);
    },
    onMove(ctx, session, x, y, mods) {
      const mode = snapMode(sketches, mods);
      const target = snapAt(ctx, session, x, y, mode);
      if (target === null) return;
      const angle = inputValues(mods).get('angle') ?? null;
      const step = xlineStep(sessionData(session, []), first, target, mode.infer, angle);
      previewInference(session, target.at, stepInferences(step), target.guides);
      if (first === null) return;
      // A degenerate line is not drawn.
      if (step.kind === 'xline') previewPairs(ctx, session, extent(first.at, step.target.at));
      else clearPreview(ctx);
    },
    onClick(ctx, session, x, y, mods) {
      const mode = snapMode(sketches, mods);
      const target = snapAt(ctx, session, x, y, mode);
      if (target === null) return;
      const angle = inputValues(mods).get('angle') ?? null;
      const step = xlineStep(sessionData(session, []), first, target, mode.infer, angle);
      switch (step.kind) {
        case 'none':
          return;
        case 'first':
          first = step.target;
          return;
        case 'xline': {
          if (first === null) return;
          const p1 = placePoint(ctx, first);
          const p2 = placePoint(ctx, step.target);
          first = null;
          clearPreview(ctx);
          const line: SketchXLine = {
            kind: 'xline',
            id: newEntityId(ctx),
            p1: p1.id,
            p2: p2.id,
            construction: true,
          };
          const axis = axisConstraint(ctx, step.axis, line.id);
          const required = new Set(step.typed ? axis.map((c) => c.id) : []);
          void addDrawn(
            session,
            {
              entities: [...p1.entities, ...p2.entities, line],
              constraints: [...p1.constraints, ...p2.constraints, ...axis],
            },
            { required },
          );
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
 * The step of a click at `target` after the first point `first` (null = none yet); `angle` = the
 * entered angle (M32, radians), which replaces the automatic axis. Pure over `data`, so the
 * preview of a move can call it too.
 */
function xlineStep(
  data: SketchData,
  first: SnapTarget | null,
  target: SnapTarget,
  infer: boolean,
  angle: number | null,
): XLineStep {
  if (first === null) return { kind: 'first', target };
  if (samePoint(first, target) || distance(first.at, target.at) <= MIN_LENGTH) {
    return { kind: 'none' };
  }
  const side = sideAxis(data, first, target, infer);
  if (angle !== null) {
    return { kind: 'xline', target: side.target, axis: axisOfAngle(angle), typed: true };
  }
  return { kind: 'xline', target: side.target, axis: side.axis, typed: false };
}

/** The inferences the click of the step adds: of the clicked point and the axis of the line. */
function stepInferences(step: XLineStep): readonly { readonly kind: GlyphKind }[] {
  switch (step.kind) {
    case 'none':
      return [];
    case 'first':
      return step.target.inferred;
    case 'xline':
      return step.axis === null
        ? step.target.inferred
        : [...step.target.inferred, { kind: step.axis }];
  }
}

/** The line through p and q as one long pair, like curve2 of an xline (XLINE_EXTENT each way). */
function extent(p: Vec2, q: Vec2): readonly Vec2[] {
  const length = distance(p, q);
  const d: Vec2 = [(q[0] - p[0]) / length, (q[1] - p[1]) / length];
  const m: Vec2 = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  return [
    [m[0] - XLINE_EXTENT * d[0], m[1] - XLINE_EXTENT * d[1]],
    [m[0] + XLINE_EXTENT * d[0], m[1] + XLINE_EXTENT * d[1]],
  ];
}
