// The fillet tool (spec 12, "Zaoblení a sražení ve skice (M34)", "Zaoblení"): a click on a corner
// of two lines or arcs, or on two of them one after another, rounds them with an arc of the radius
// last used in the session (the first time ¼ of the shorter curve). The centre and the points of
// contact come from SketchGeometry.fillet, the data from filletEdit of sketch; the radius
// dimension opens for editing.

import type { Vec2 } from '@/core';
import { curve2, directionFromEnd, filletEdit, pointsById } from '@/sketch';
import type { FilletArc } from '@/sketch';
import type { Tool } from '@/interaction';
import type { SketchEditor } from '../sketch-editor';
import { createCornerTool } from './corner-tool';
import type { CornerKey, PickedPair } from './corner-tool';

interface FilletKey extends CornerKey {
  /** Of the possible centres the one nearest to it (SketchGeometry.fillet). */
  readonly near: Vec2;
}

export function createFilletTool(sketches: SketchEditor): Tool {
  return createCornerTool<FilletKey, FilletArc>(sketches, {
    memory: 'fillet',
    key(pair, radius) {
      const near = pair.clickedCorner ? insideCorner(pair, radius) : pair.near;
      return near === null ? null : { pair, value: radius, near };
    },
    sameRest: (a, b) => a.near[0] === b.near[0] && a.near[1] === b.near[1],
    answer(geometry, { pair, value, near }) {
      const points = pointsById(pair.data);
      return geometry.fillet(curve2(pair.a, points), curve2(pair.b, points), value, near);
    },
    edit({ pair, value }, arc, ids) {
      const corner = pair.corner === null ? {} : { corner: pair.corner };
      return filletEdit(
        pair.data,
        { a: pair.a.id, b: pair.b.id, ...corner, radius: value, arc },
        ids,
      );
    },
  });
}

/**
 * The near point of a clicked corner (spec 12): the corner + r · the unit sum of the directions of
 * both curves from it; null for curves going on in opposite directions (nothing to round).
 */
function insideCorner(pair: PickedPair, radius: number): Vec2 | null {
  const { corner } = pair;
  if (corner === null) return null;
  const at = pointsById(pair.data).get(corner);
  if (at === undefined) return null;
  const da = directionFromEnd(pair.data, pair.a, corner);
  const db = directionFromEnd(pair.data, pair.b, corner);
  if (da === null || db === null) return null;
  const sum: Vec2 = [da[0] + db[0], da[1] + db[1]];
  const length = Math.hypot(sum[0], sum[1]);
  if (length < 1e-9) return null;
  return [at.x + (radius * sum[0]) / length, at.y + (radius * sum[1]) / length];
}
