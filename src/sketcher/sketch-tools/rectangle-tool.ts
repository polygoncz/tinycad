// The rectangle tool (spec 10, "Nástroje a akce skicáře"; spec 12, M26): two opposite corners →
// 4 points, 4 lines, 2× horizontal and 2× vertical in one addGeometry. The clicked corners go
// through the snapper; the two computed corners too, at their place, so a rectangle drawn onto an
// existing edge shares its points. The horizontals and verticals are required (they define the
// rectangle); the inferred constraints of the corners are automatic. Corners with the same x or y
// make nothing. The click and the preview of a move share one step (rectangleStep), so the
// preview shows exactly the inferred constraints the click adds.
//
// The numeric input (spec 12, M32): the first corner has the fields x and y, the second width and
// height (the sign from the quadrant of the cursor); a locked width becomes a required distance of
// the side ab, a locked height of the side bc.

import type { Vec2 } from '@/core';
import type {
  PointInference,
  SketchConstraint,
  SketchData,
  SketchEntityId,
  SketchLine,
} from '@/sketch';
import type { Tool, ToolContext } from '@/interaction';
import type { SketchEditor } from '../sketch-editor';
import type { SketchSession } from '../sketch-session';
import {
  addDrawn,
  clearPreview,
  clickTool,
  constrainXY,
  existingLine,
  inputValues,
  measureXY,
  MIN_LENGTH,
  newConstraintId,
  newEntityId,
  previewInference,
  previewPolyline,
  snapMode,
  XY_FIELDS,
} from './common';
import { constrainSize, measureSize, SIZE_FIELDS, sizeDimensions } from './rectangle-input';
import { freeTarget, placePoint, sessionData, snapAt, snapPoint, snapToleranceAt } from './snap';
import { computedTolerance } from './shape';
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
    hint() {
      return corner === null ? 'hint.rectangle.first' : 'hint.rectangle.second';
    },
    inputFields() {
      return corner === null ? XY_FIELDS : SIZE_FIELDS;
    },
    constrain(cursor, values) {
      return corner === null
        ? constrainXY(cursor, values)
        : constrainSize(corner.at, cursor, values, false);
    },
    measure(at) {
      return corner === null ? measureXY(at) : measureSize(corner.at, at, false);
    },
    onMove(ctx, session, x, y, mods) {
      const mode = snapMode(sketches, mods);
      const target = snapAt(ctx, session, x, y, mode);
      const tolerance = snapToleranceAt(ctx, session, x, y);
      if (target === null || tolerance === null) return;
      const step = rectangleStep(
        sessionData(session, []),
        corner,
        target,
        computedTolerance(mode, tolerance),
        mode.infer,
      );
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
      const step = rectangleStep(
        sessionData(session, []),
        corner,
        target,
        computedTolerance(mode, tolerance),
        mode.infer,
      );
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
          addRectangle(ctx, session, [place(a), place(b), place(c), place(d)], inputValues(mods));
          return;
        }
      }
    },
  });
}

/**
 * The step of a click at `target` after the first corner `start` (null = none yet). Pure over
 * `data`, so the preview of a move can call it too.
 */
function rectangleStep(
  data: SketchData,
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
  const tb = snapPoint(data, b, tolerance, computed);
  const td = snapPoint(data, d, tolerance, computed);
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
 * an existing line already joins gets no line and no axis (the existing edge is that side). The
 * locked width and height (`values`, M32) add their required distances of ab and bc.
 */
function addRectangle(
  ctx: ToolContext,
  session: SketchSession,
  points: readonly [PlacedPoint, PlacedPoint, PlacedPoint, PlacedPoint],
  values: ReadonlyMap<string, number>,
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
  const typed = sizeDimensions(ctx, [pa.id, pb.id, pc.id], values);
  void addDrawn(
    session,
    {
      entities: [...points.flatMap((p) => p.entities), ...lines.map((l) => l.line)],
      constraints: [...points.flatMap((p) => p.constraints), ...axes, ...typed],
    },
    { required: new Set([...axes, ...typed].map((c) => c.id)) },
  );
}

function alignedWith(i: PointInference, points: ReadonlySet<SketchEntityId>): boolean {
  return (i.kind === 'hAlign' || i.kind === 'vAlign') && points.has(i.with);
}

/** The corners in order from p: p, [q.x, p.y], q, [p.x, q.y] (lines ab, bc, cd, da). */
function corners(p: Vec2, q: Vec2): readonly [Vec2, Vec2, Vec2, Vec2] {
  return [p, [q[0], p[1]], q, [p[0], q[1]]];
}
