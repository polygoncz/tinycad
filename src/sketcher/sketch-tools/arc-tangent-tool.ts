// The tangent arc tool (spec 12, "Oblouky a kružnice (M27)"): a click on an end point of an
// existing line or arc, then an end (snapped, with its inferred constraints) → the arc
// tangentArcFrom(point, endTangent(curve, point), end) around a new centre point, starting at the
// shared end point, with tangent(arc, curve), which is required. The connecting curve is the last
// line or arc of the data that ends in the clicked point; a click elsewhere does nothing. An arc
// is always counter-clockwise in the data, so a clockwise fit swaps its start and end. Ctrl/Cmd
// turns the automatic constraints off. The click and the preview of a move share one step
// (arcTangentStep).

import type { Vec2 } from '@/core';
import { endTangent, tangentArcFrom } from '@/sketch';
import type { ArcFit, SketchConstraint, SketchCurve, SketchData, SketchEntityId } from '@/sketch';
import type { Tool, ToolContext } from '@/interaction';
import { isPlainEscape } from '@/interaction';
import type { SketchEditor } from '../sketch-editor';
import type { GlyphKind } from '../sketch-glyphs';
import type { SketchSession } from '../sketch-session';
import {
  clearPreview,
  clickTool,
  newConstraintId,
  newEntityId,
  previewArcFit,
  previewInference,
  snapMode,
} from './common';
import { freeTarget, placePoint, sessionData, snapAt } from './snap';
import type { SnapTarget } from './snap';

/** The end point the arc starts at, the curve it continues and the direction it goes on in. */
interface TangentStart {
  readonly point: SketchEntityId;
  readonly at: Vec2;
  readonly curve: SketchEntityId;
  readonly direction: Vec2;
}

/**
 * What a click at a target does: nothing, take the start, or add the arc `fit` from the start to
 * the target `end`.
 */
type ArcTangentStep =
  | { readonly kind: 'none' }
  | { readonly kind: 'start'; readonly start: TangentStart }
  | { readonly kind: 'arc'; readonly fit: ArcFit; readonly end: SnapTarget };

export function createArcTangentTool(sketches: SketchEditor): Tool {
  let start: TangentStart | null = null;

  return clickTool(sketches, {
    reset() {
      start = null;
    },
    onMove(ctx, session, x, y, mods) {
      const mode = snapMode(sketches, mods);
      const cursor = snapAt(ctx, session, x, y, mode);
      if (cursor === null) return;
      const step = arcTangentStep(sessionData(session, []), start, cursor);
      // Only the end of the arc is a new point: the start is an existing one, without guides.
      const guides = step.kind === 'arc' ? cursor.guides : [];
      previewInference(session, cursor.at, stepInferences(step), guides);
      if (start === null) return;
      if (step.kind !== 'arc') {
        // A degenerate arc (the end on the line of the direction) is not drawn.
        clearPreview(ctx);
        return;
      }
      previewArcFit(ctx, session, step.fit, start.at, step.end.at);
    },
    onClick(ctx, session, x, y, mods) {
      const mode = snapMode(sketches, mods);
      const target = snapAt(ctx, session, x, y, mode);
      if (target === null) return;
      const step = arcTangentStep(sessionData(session, []), start, target);
      switch (step.kind) {
        case 'none':
          return;
        case 'start':
          start = step.start;
          return;
        case 'arc': {
          if (start === null) return;
          const from = start;
          start = null;
          clearPreview(ctx);
          addArc(ctx, session, from, step);
          return;
        }
      }
    },
    onKey(ctx, _session, e) {
      if (!isPlainEscape(e) || start === null) return false;
      // Escape forgets the picked start; a second one ends the tool.
      start = null;
      clearPreview(ctx);
      return true;
    },
  });
}

/**
 * The step of a click at `target` after the start picked so far (null = not yet). Pure over
 * `data`, so the preview of a move can call it too.
 */
function arcTangentStep(
  data: SketchData,
  start: TangentStart | null,
  target: SnapTarget,
): ArcTangentStep {
  if (start === null) {
    const picked = tangentStart(data, target);
    return picked === null ? { kind: 'none' } : { kind: 'start', start: picked };
  }
  if (target.point === start.point) return { kind: 'none' };
  const fit = tangentArcFrom(start.at, start.direction, target.at);
  return fit === null ? { kind: 'none' } : { kind: 'arc', fit, end: target };
}

/**
 * The start at a snapped existing point: the last line or arc of the data that ends in it and
 * the direction it goes on in; null for any other target or a degenerate curve.
 */
function tangentStart(data: SketchData, target: SnapTarget): TangentStart | null {
  const point = target.point;
  if (point === null) return null;
  const curve = data.entities.findLast(
    (e): e is Extract<SketchCurve, { kind: 'line' | 'arc' }> =>
      (e.kind === 'line' && (e.p1 === point || e.p2 === point)) ||
      (e.kind === 'arc' && (e.start === point || e.end === point)),
  );
  if (curve === undefined) return null;
  const direction = endTangent(curve, point, data);
  return direction === null ? null : { point, at: target.at, curve: curve.id, direction };
}

/** The inferences the click of the step adds: none for the start, the end's and tangent for the arc. */
function stepInferences(step: ArcTangentStep): readonly { readonly kind: GlyphKind }[] {
  switch (step.kind) {
    case 'none':
    case 'start':
      return [];
    case 'arc':
      return [...step.end.inferred, { kind: 'tangent' }];
  }
}

/**
 * Adds the arc around a new centre from the shared start to the end (swapped for a clockwise
 * fit) with tangent(arc, curve), which is required.
 */
function addArc(
  ctx: ToolContext,
  session: SketchSession,
  start: TangentStart,
  step: Extract<ArcTangentStep, { kind: 'arc' }>,
): void {
  const { fit } = step;
  const c = placePoint(ctx, freeTarget(fit.center));
  const e = placePoint(ctx, step.end);
  const id: SketchEntityId = newEntityId(ctx);
  const [from, to] = fit.ccw ? [start.point, e.id] : [e.id, start.point];
  const tangent: SketchConstraint = {
    kind: 'tangent',
    id: newConstraintId(ctx),
    a: id,
    b: start.curve,
  };
  void session.addGeometry(
    {
      entities: [
        ...c.entities,
        ...e.entities,
        { kind: 'arc', id, center: c.id, start: from, end: to },
      ],
      constraints: [...e.constraints, tangent],
    },
    { required: new Set([tangent.id]) },
  );
}
