// The rectangle tool (spec 10, "Nástroje a akce skicáře"; spec 12, M26): two opposite corners →
// 4 points, 4 lines, 2× horizontal and 2× vertical in one addGeometry. The clicked corners go
// through the snapper; the two computed corners too, at their place, so a rectangle drawn onto an
// existing edge shares its points. The horizontals and verticals are required (they define the
// rectangle); the inferred constraints of the corners are automatic. Corners with the same x or y
// make nothing.

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
  previewPolyline,
  snapMode,
} from './common';
import { freeTarget, placePoint, sessionData, snapAt, snapPoint, snapToleranceAt } from './snap';
import type { PlacedPoint, SnapTarget } from './snap';

export function createRectangleTool(sketches: SketchEditor): Tool {
  let corner: SnapTarget | null = null;

  return clickTool(sketches, {
    reset() {
      corner = null;
    },
    onMove(ctx, session, x, y, mods) {
      if (corner === null) return;
      const target = snapAt(ctx, session, x, y, snapMode(sketches, mods));
      if (target === null) return;
      const [a, b, c, d] = corners(corner.at, target.at);
      previewPolyline(ctx, session, [a, b, c, d, a]);
    },
    onClick(ctx, session, x, y, mods) {
      const mode = snapMode(sketches, mods);
      const target = snapAt(ctx, session, x, y, mode);
      const tolerance = snapToleranceAt(ctx, session, x, y);
      if (target === null || tolerance === null) return;
      const start = corner;
      if (start === null) {
        corner = target;
        return;
      }
      // A degenerate rectangle: the click is ignored and the first corner stays.
      if (
        Math.abs(target.at[0] - start.at[0]) <= MIN_LENGTH ||
        Math.abs(target.at[1] - start.at[1]) <= MIN_LENGTH
      ) {
        return;
      }
      corner = null;
      clearPreview(ctx);
      const [, b, , d] = corners(start.at, target.at);
      // The computed corners snap without the grid (they derive from snapped corners) and never
      // onto the clicked corners or onto each other, which would collapse a side.
      const clicked = [start.point, target.point].filter((id): id is SketchEntityId => id !== null);
      const computed = { infer: mode.infer, grid: null, exclude: new Set(clicked) };
      const tb = snapPoint(session, b, tolerance, computed);
      const td = snapPoint(session, d, tolerance, computed);
      const tdd = td.point !== null && td.point === tb.point ? freeTarget(d) : td;
      // An alignment of a corner with another corner duplicates an axis of the rectangle.
      const own = new Set(
        [start, tb, target, tdd].flatMap((t) => (t.point === null ? [] : [t.point])),
      );
      const place = (t: SnapTarget): PlacedPoint =>
        placePoint(ctx, { ...t, inferred: t.inferred.filter((i) => !alignedWith(i, own)) });
      addRectangle(ctx, session, [place(start), place(tb), place(target), place(tdd)]);
    },
  });
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
