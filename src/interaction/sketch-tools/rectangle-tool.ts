// The rectangle tool (spec 10, "Nástroje a akce skicáře"): two opposite corners → 4 points (the
// snapped corners reused), 4 lines, 2× horizontal and 2× vertical in one addGeometry. Corners with
// the same x or y make nothing.

import type { Vec2 } from '@/core';
import type { SketchConstraint, SketchLine } from '@/sketch';
import type { SketchEditor } from '../sketch-editor';
import type { Tool } from '../tools';
import {
  MIN_LENGTH,
  clearPreview,
  clickTool,
  newConstraintId,
  newEntityId,
  previewPolyline,
} from './common';
import { placePoint, snapAt } from './snap';
import type { PlacedPoint, SnapTarget } from './snap';

export function createRectangleTool(sketches: SketchEditor): Tool {
  let corner: SnapTarget | null = null;

  return clickTool(sketches, {
    reset() {
      corner = null;
    },
    onMove(ctx, session, x, y) {
      if (corner === null) return;
      const target = snapAt(ctx, session, x, y);
      if (target === null) return;
      const [a, b, c, d] = corners(corner.at, target.at);
      previewPolyline(ctx, session, [a, b, c, d, a]);
    },
    onClick(ctx, session, x, y) {
      const target = snapAt(ctx, session, x, y);
      if (target === null) return;
      const start = corner;
      if (start === null) {
        corner = target;
        return;
      }
      const [, b, , d] = corners(start.at, target.at);
      // A degenerate rectangle: the click is ignored and the first corner stays.
      if (
        Math.abs(target.at[0] - start.at[0]) <= MIN_LENGTH ||
        Math.abs(target.at[1] - start.at[1]) <= MIN_LENGTH
      ) {
        return;
      }
      corner = null;
      clearPreview(ctx);
      const pa = placePoint(ctx, start);
      const pb = placePoint(ctx, { kind: 'free', at: b });
      const pc = placePoint(ctx, target);
      const pd = placePoint(ctx, { kind: 'free', at: d });
      const line = (p: PlacedPoint, q: PlacedPoint): SketchLine => ({
        kind: 'line',
        id: newEntityId(ctx),
        p1: p.id,
        p2: q.id,
      });
      const lines = [line(pa, pb), line(pb, pc), line(pc, pd), line(pd, pa)];
      const axes = lines.map((l, i): SketchConstraint => ({
        kind: i % 2 === 0 ? 'horizontal' : 'vertical',
        id: newConstraintId(ctx),
        line: l.id,
      }));
      void session.addGeometry({
        entities: [...pa.entities, ...pb.entities, ...pc.entities, ...pd.entities, ...lines],
        constraints: [...pa.constraints, ...pc.constraints, ...axes],
      });
    },
  });
}

/** The corners in order from p: p, [q.x, p.y], q, [p.x, q.y] (lines ab, bc, cd, da). */
function corners(p: Vec2, q: Vec2): readonly [Vec2, Vec2, Vec2, Vec2] {
  return [p, [q[0], p[1]], q, [p[0], q[1]]];
}
