// The circle tool (spec 10, "Nástroje a akce skicáře"; spec 12, M26): a centre (snapped, with its
// inferred constraints) and a point on the rim (snapped only for its place) → a circle with the
// radius > 0, equal to the last circle or arc of the sketch when the radii differ by at most 2 %
// (inferRadius); Ctrl/Cmd turns the inference off.

import { inferRadius } from '@/sketch';
import type { SketchConstraint, SketchEntityId } from '@/sketch';
import type { Tool } from '@/interaction';
import type { SketchEditor } from '../sketch-editor';
import {
  MIN_LENGTH,
  circlePoints,
  clearPreview,
  clickTool,
  distance,
  lastRound,
  newConstraintId,
  newEntityId,
  previewPolyline,
  snapMode,
} from './common';
import { placePoint, sessionData, snapAt } from './snap';
import type { SnapTarget } from './snap';

export function createCircleTool(sketches: SketchEditor): Tool {
  let center: SnapTarget | null = null;

  return clickTool(sketches, {
    reset() {
      center = null;
    },
    onMove(ctx, session, x, y, mods) {
      if (center === null) return;
      const rim = snapAt(ctx, session, x, y, snapMode(sketches, mods));
      if (rim === null) return;
      previewPolyline(ctx, session, circlePoints(center.at, distance(center.at, rim.at)));
    },
    onClick(ctx, session, x, y, mods) {
      const mode = snapMode(sketches, mods);
      const target = snapAt(ctx, session, x, y, mode);
      if (target === null) return;
      if (center === null) {
        center = target;
        return;
      }
      const radius = distance(center.at, target.at);
      if (radius <= MIN_LENGTH) return;
      const data = sessionData(session, []);
      const equal = mode.infer ? inferRadius(radius, data, lastRound(data)) : null;
      const c = placePoint(ctx, center);
      center = null;
      clearPreview(ctx);
      const id: SketchEntityId = newEntityId(ctx);
      const constraints: readonly SketchConstraint[] =
        equal === null ? [] : [{ kind: 'equal', id: newConstraintId(ctx), a: id, b: equal }];
      void session.addGeometry({
        entities: [...c.entities, { kind: 'circle', id, center: c.id, radius }],
        constraints: [...c.constraints, ...constraints],
      });
    },
  });
}
