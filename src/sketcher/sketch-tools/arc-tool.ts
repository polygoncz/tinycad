// The arc tool (spec 10, "Nástroje a akce skicáře"; spec 12, M26): a centre, a start (both
// snapped, with their inferred constraints) and an end (snapped, then projected onto the circle
// through the start) → a counter-clockwise arc from start to end, equal to the last circle or arc
// of the sketch when the radii differ by at most 2 % (inferRadius); Ctrl/Cmd turns the inference
// off.

import type { Vec2 } from '@/core';
import { inferRadius } from '@/sketch';
import type { SketchConstraint, SketchEntityId } from '@/sketch';
import type { Tool } from '@/interaction';
import type { SketchEditor } from '../sketch-editor';
import {
  MIN_LENGTH,
  arcPoints,
  clearPreview,
  clickTool,
  distance,
  lastRound,
  newConstraintId,
  newEntityId,
  previewPairs,
  previewPolyline,
  snapMode,
} from './common';
import { ccwSweep } from '../sketch-angles';
import { placePoint, samePoint, sessionData, snapAt } from './snap';
import type { SnapTarget } from './snap';

export function createArcTool(sketches: SketchEditor): Tool {
  let center: SnapTarget | null = null;
  let start: SnapTarget | null = null;

  return clickTool(sketches, {
    reset() {
      center = null;
      start = null;
    },
    onMove(ctx, session, x, y, mods) {
      if (center === null) return;
      const cursor = snapAt(ctx, session, x, y, snapMode(sketches, mods));
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
    onClick(ctx, session, x, y, mods) {
      const mode = snapMode(sketches, mods);
      const target = snapAt(ctx, session, x, y, mode);
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
      const radius = distance(center.at, start.at);
      const data = sessionData(session, []);
      const equal = mode.infer ? inferRadius(radius, data, lastRound(data)) : null;
      const c = placePoint(ctx, center);
      const s = placePoint(ctx, start);
      // The constraints the snap inferred for the end, except fix: the projected end is not at
      // the origin.
      const e = placePoint(ctx, {
        ...target,
        at,
        point: null,
        inferred: target.inferred.filter((i) => i.kind !== 'fix'),
      });
      center = null;
      start = null;
      clearPreview(ctx);
      const id: SketchEntityId = newEntityId(ctx);
      const constraints: readonly SketchConstraint[] =
        equal === null ? [] : [{ kind: 'equal', id: newConstraintId(ctx), a: id, b: equal }];
      void session.addGeometry({
        entities: [
          ...c.entities,
          ...s.entities,
          ...e.entities,
          { kind: 'arc', id, center: c.id, start: s.id, end: e.id },
        ],
        constraints: [...c.constraints, ...s.constraints, ...e.constraints, ...constraints],
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
