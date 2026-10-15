// The rectangle tool (spec 10, "Nástroje a akce skicáře"; spec 12, M26): two opposite corners →
// 4 points, 4 lines, 2× horizontal and 2× vertical in one addGeometry. The clicked corners go
// through the snapper; the two computed corners too, at their place, so a rectangle drawn onto an
// existing edge shares its points. The horizontals and verticals are required (they define the
// rectangle); the inferred constraints of the corners are automatic. Corners with the same x or y
// make nothing. The click and the preview of a move share one step (rectangleStep), so the
// preview shows exactly the inferred constraints the click adds.

import type { Vec2 } from '@/core';
import type { PointInference, SketchConstraint, SketchEntityId, SketchLine } from '@/sketch';
import type { Tool, ToolContext } from '@/interaction';
import type { SketchEditor } from '../sketch-editor';
import type { SketchSession } from '../sketch-session';
import {
  MIN_LENGTH,
  existingLine,
  clearPreview,
  clickTool,
  newConstraintId,
  newEntityId,
  previewInference,
  previewPolyline,
  snapMode,
} from './common';
import { freeTarget, placePoint, sessionData, snapAt, snapPoint, snapToleranceAt } from './snap';
import type { PlacedPoint, SnapTarget } from './snap';

/** Four corners a, b, c, d (lines ab, bc, cd, da). */
type Corners = readonly [SnapTarget, SnapTarget, SnapTarget, SnapTarget];

/**
 * What a click at a target does: nothing (a degenerate rectangle), take the first corner, or add
 * the rectangle of the four snapped corners, with the inferences each one gets.
 */
type RectangleStep =
  | { readonly kind: 'none' }
  | { readonly kind: 'corner'; readonly target: SnapTarget }
  | { readonly kind: 'rectangle'; readonly corners: Corners };

export function createRectangleTool(sketches: SketchEditor): Tool {
  let corner: SnapTarget | null = null;

  return clickTool(sketches, {
    reset() {
      corner = null;
    },
    onMove(ctx, session, x, y, mods) {
      const mode = snapMode(sketches, mods);
      const target = snapAt(ctx, session, x, y, mode);
      const tolerance = snapToleranceAt(ctx, session, x, y);
      if (target === null || tolerance === null) return;
      const step = rectangleStep(session, corner, target, tolerance, mode.infer);
      previewInference(session, target.at, stepInferences(step), target.guides);
      if (corner === null) return;
      const [a, b, c, d] = corners(corner.at, target.at);
      previewPolyline(ctx, session, [a, b, c, d, a]);
    },
    onClick(ctx, session, x, y, mods) {
      const mode = snapMode(sketches, mods);
      const target = snapAt(ctx, session, x, y, mode);
      const tolerance = snapToleranceAt(ctx, session, x, y);
      if (target === null || tolerance === null) return;
      const step = rectangleStep(session, corner, target, tolerance, mode.infer);
      switch (step.kind) {
        case 'none':
          return;
        case 'corner':
          corner = step.target;
          return;
        case 'rectangle': {
          corner = null;
          clearPreview(ctx);
          const [a, b, c, d] = step.corners;
          const place = (t: SnapTarget): PlacedPoint => placePoint(ctx, t);
          addRectangle(ctx, session, [place(a), place(b), place(c), place(d)]);
          return;
        }
      }
    },
  });
}

/**
 * The step of a click at `target` after the first corner `start` (null = none yet). Pure over
 * the data of the session, so the preview of a move can call it too.
 */
function rectangleStep(
  session: SketchSession,
  start: SnapTarget | null,
  target: SnapTarget,
  tolerance: number,
  infer: boolean,
): RectangleStep {
  if (start === null) return { kind: 'corner', target };
  // A degenerate rectangle: the click is ignored and the first corner stays.
  if (
    Math.abs(target.at[0] - start.at[0]) <= MIN_LENGTH ||
    Math.abs(target.at[1] - start.at[1]) <= MIN_LENGTH
  ) {
    return { kind: 'none' };
  }
  const [, b, , d] = corners(start.at, target.at);
  // The computed corners snap without the grid (they derive from snapped corners) and never
  // onto the clicked corners or onto each other, which would collapse a side.
  const clicked = [start.point, target.point].filter((id): id is SketchEntityId => id !== null);
  const computed = { infer, grid: null, exclude: new Set(clicked) };
  const tb = snapPoint(session, b, tolerance, computed);
  const td = snapPoint(session, d, tolerance, computed);
  const tdd = td.point !== null && td.point === tb.point ? freeTarget(d) : td;
  // An alignment of a corner with another corner duplicates an axis of the rectangle.
  const own = new Set([start, tb, target, tdd].flatMap((t) => (t.point === null ? [] : [t.point])));
  const filtered = (t: SnapTarget): SnapTarget => ({
    ...t,
    inferred: t.inferred.filter((i) => !alignedWith(i, own)),
  });
  return {
    kind: 'rectangle',
    corners: [filtered(start), filtered(tb), filtered(target), filtered(tdd)],
  };
}

/**
 * The inferences the click of the step adds and the preview shows: of the clicked corner, or of
 * the corners b, c, d of the rectangle (the first corner showed its own when it was clicked).
 */
function stepInferences(step: RectangleStep): readonly PointInference[] {
  switch (step.kind) {
    case 'none':
      return [];
    case 'corner':
      return step.target.inferred;
    case 'rectangle':
      return step.corners.slice(1).flatMap((t) => t.inferred);
  }
}

/**
 * Lines a→b→c→d→a with horizontal, vertical, horizontal, vertical (required). A side whose points
 * an existing line already joins gets no line and no axis (the existing edge is that side).
 */
function addRectangle(
  ctx: ToolContext,
  session: SketchSession,
  points: readonly [PlacedPoint, PlacedPoint, PlacedPoint, PlacedPoint],
): void {
  const [pa, pb, pc, pd] = points;
  const data = sessionData(session, []);
  const sides = [
    [pa, pb, 'horizontal'],
    [pb, pc, 'vertical'],
    [pc, pd, 'horizontal'],
    [pd, pa, 'vertical'],
  ] as const;
  const lines = sides
    .filter(([p, q]) => existingLine(data, p.id, q.id) === null)
    .map(([p, q, kind]) => ({
      line: { kind: 'line', id: newEntityId(ctx), p1: p.id, p2: q.id } satisfies SketchLine,
      kind,
    }));
  const axes = lines.map(({ line, kind }): SketchConstraint => ({
    kind,
    id: newConstraintId(ctx),
    line: line.id,
  }));
  if (lines.length === 0 && points.every((p) => p.entities.length === 0)) return;
  void session.addGeometry(
    {
      entities: [...points.flatMap((p) => p.entities), ...lines.map((l) => l.line)],
      constraints: [...points.flatMap((p) => p.constraints), ...axes],
    },
    { required: new Set(axes.map((c) => c.id)) },
  );
}

function alignedWith(i: PointInference, points: ReadonlySet<SketchEntityId>): boolean {
  return (i.kind === 'hAlign' || i.kind === 'vAlign') && points.has(i.with);
}

/** The corners in order from p: p, [q.x, p.y], q, [p.x, q.y] (lines ab, bc, cd, da). */
function corners(p: Vec2, q: Vec2): readonly [Vec2, Vec2, Vec2, Vec2] {
  return [p, [q[0], p[1]], q, [p[0], q[1]]];
}
