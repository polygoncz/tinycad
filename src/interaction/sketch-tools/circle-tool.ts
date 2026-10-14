// The circle tool (spec 10, "Nástroje a akce skicáře"): a centre (snapped) and a point on the rim
// → a circle with the radius > 0.

import type { SketchEditor } from '../sketch-editor';
import type { Tool } from '../tools';
import {
  MIN_LENGTH,
  circlePoints,
  clearPreview,
  clickTool,
  snapGrid,
  distance,
  newEntityId,
  previewPolyline,
} from './common';
import { placePoint, snapAt } from './snap';
import type { SnapTarget } from './snap';

export function createCircleTool(sketches: SketchEditor): Tool {
  let center: SnapTarget | null = null;

  return clickTool(sketches, {
    reset() {
      center = null;
    },
    onMove(ctx, session, x, y, mods) {
      if (center === null) return;
      const rim = snapAt(ctx, session, x, y, snapGrid(sketches, mods));
      if (rim === null) return;
      previewPolyline(ctx, session, circlePoints(center.at, distance(center.at, rim.at)));
    },
    onClick(ctx, session, x, y, mods) {
      const target = snapAt(ctx, session, x, y, snapGrid(sketches, mods));
      if (target === null) return;
      if (center === null) {
        center = target;
        return;
      }
      const radius = distance(center.at, target.at);
      if (radius <= MIN_LENGTH) return;
      const c = placePoint(ctx, center);
      center = null;
      clearPreview(ctx);
      void session.addGeometry({
        entities: [...c.entities, { kind: 'circle', id: newEntityId(ctx), center: c.id, radius }],
        constraints: c.constraints,
      });
    },
  });
}
