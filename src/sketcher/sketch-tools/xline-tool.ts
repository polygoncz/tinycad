// The construction line tool (spec 12, "Nové kreslicí nástroje (M31)"): two clicks are two points
// of an infinite construction line (xline, always construction: true). Both points go through the
// snapper with their inferred constraints; the line gets horizontal or vertical from inferLine
// within 3° (automatic, B3); Ctrl/Cmd turns it off. Two clicks on one place make nothing. After a
// line the tool stays for the next one. The click and the preview of a move share one step
// (xlineStep).

import type { Vec2 } from '@/core';
import { XLINE_EXTENT } from '@/sketch';
import type { SketchData, SketchXLine } from '@/sketch';
import { isPlainEscape } from '@/interaction';
import type { Tool } from '@/interaction';
import type { SketchEditor } from '../sketch-editor';
import type { GlyphKind } from '../sketch-glyphs';
import {
  MIN_LENGTH,
  clearPreview,
  clickTool,
  distance,
  newEntityId,
  previewInference,
  previewPairs,
  snapMode,
  addDrawn,
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
  | { readonly kind: 'xline'; readonly target: SnapTarget; readonly axis: AxisKind | null };

export function createXLineTool(sketches: SketchEditor): Tool {
  let first: SnapTarget | null = null;

  return clickTool(sketches, {
    reset() {
      first = null;
    },
    onMove(ctx, session, x, y, mods) {
      const mode = snapMode(sketches, mods);
      const target = snapAt(ctx, session, x, y, mode);
      if (target === null) return;
      const step = xlineStep(sessionData(session, []), first, target, mode.infer);
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
      const step = xlineStep(sessionData(session, []), first, target, mode.infer);
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
          void addDrawn(session, {
            entities: [...p1.entities, ...p2.entities, line],
            constraints: [
              ...p1.constraints,
              ...p2.constraints,
              ...axisConstraint(ctx, step.axis, line.id),
            ],
          });
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
 * The step of a click at `target` after the first point `first` (null = none yet). Pure over
 * `data`, so the preview of a move can call it too.
 */
function xlineStep(
  data: SketchData,
  first: SnapTarget | null,
  target: SnapTarget,
  infer: boolean,
): XLineStep {
  if (first === null) return { kind: 'first', target };
  if (samePoint(first, target) || distance(first.at, target.at) <= MIN_LENGTH) {
    return { kind: 'none' };
  }
  const side = sideAxis(data, first, target, infer);
  return { kind: 'xline', target: side.target, axis: side.axis };
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
