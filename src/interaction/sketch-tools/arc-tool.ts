// The arc tool (spec 10, "Nástroje a akce skicáře"): a centre, a start (both snapped) and an end
// projected onto the circle through the start → a counter-clockwise arc from start to end.

import type { Vec2 } from '@/core';
import type { SketchEditor } from '../sketch-editor';
import type { Tool } from '../tools';
import {
  MIN_LENGTH,
  arcPoints,
  ccwSweep,
  clearPreview,
  clickTool,
  distance,
  newEntityId,
  previewPairs,
  previewPolyline,
} from './common';
import { placePoint, samePoint, snapAt } from './snap';
import type { SnapTarget } from './snap';

export function createArcTool(sketches: SketchEditor): Tool {
  let center: SnapTarget | null = null;
  let start: SnapTarget | null = null;

  return clickTool(sketches, {
    reset() {
      center = null;
      start = null;
    },
    onMove(ctx, session, x, y) {
      if (center === null) return;
      const cursor = snapAt(ctx, session, x, y);
      if (cursor === null) return;
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
    onClick(ctx, session, x, y) {
      const target = snapAt(ctx, session, x, y);
      if (target === null) return;
      if (center === null) {
        center = target;
        return;
      }
      if (start === null) {
        if (samePoint(center, target) || distance(center.at, target.at) <= MIN_LENGTH) return;
        start = target;
        return;
      }
      // The end is always a new point: projecting an existing point would move it.
      const at = project(center.at, start.at, target.at);
      if (at === null || distance(at, start.at) <= MIN_LENGTH) return;
      const c = placePoint(ctx, center);
      const s = placePoint(ctx, start);
      const e = placePoint(ctx, { kind: 'free', at });
      center = null;
      start = null;
      clearPreview(ctx);
      void session.addGeometry({
        entities: [
          ...c.entities,
          ...s.entities,
          ...e.entities,
          { kind: 'arc', id: newEntityId(ctx), center: c.id, start: s.id, end: e.id },
        ],
        constraints: [...c.constraints, ...s.constraints],
      });
    },
  });
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
