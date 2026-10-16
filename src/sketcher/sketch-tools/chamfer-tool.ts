// The chamfer tools (spec 12, "Zaoblení a sražení ve skice (M34)", "Sražení"): a click on a corner
// of two lines or arcs, or on two of them sharing a corner, cuts it with a line. The distance is
// the one last used in the session (the first time ¼ of the shorter curve). Two distances: both
// points the distance from the corner; distance and angle: the point on the reference line (the
// curve nearer the cursor, or the first picked; an arc gives way to a line) the distance from the
// corner, the point on the other curve where the ray under 45° meets it. The points on an arc and
// the end of the ray come from SketchGeometry.intersections, the data from chamferEdit of sketch;
// the first distance dimension opens for editing.

import type { Vec2 } from '@/core';
import { XLINE_EXTENT, chamferEdit, curve2, pointsById } from '@/sketch';
import type { Curve2, CurveHit, SketchEntityId, SketchPoint } from '@/sketch';
import type { Tool } from '@/interaction';
import type { SketchEditor } from '../sketch-editor';
import type { SketchSession } from '../sketch-session';
import { createCornerTool, directionFrom } from './corner-tool';
import type { CornerKey, Edge, PickedPair } from './corner-tool';

/** The variant: two distances (sketch.chamfer) or a distance and an angle (sketch.chamferAngle). */
export type ChamferVariant = 'distances' | 'angle';

/** The angle of a new chamfer with an angle (spec 12): 45°. */
const CHAMFER_ANGLE = Math.PI / 4;

/** The id of the temporary circle (corner, d) and of the ray in the intersection requests. */
const CHAMFER_ID = '__chamfer';

interface ChamferKey extends CornerKey {
  readonly corner: SketchEntityId;
}

interface ChamferPoints {
  readonly pointA: Vec2;
  readonly pointB: Vec2;
}

export function createChamferTool(sketches: SketchEditor, variant: ChamferVariant): Tool {
  return createCornerTool<ChamferKey, ChamferPoints>(sketches, {
    memory: 'chamfer',
    key(pair, distance) {
      // Only in a corner; the angle is dimensioned against a line only.
      const { corner } = pair;
      if (corner === null) return null;
      if (variant === 'distances' || pair.a.kind === 'line') {
        return { pair, value: distance, corner };
      }
      if (pair.b.kind !== 'line') return null;
      return { pair: { ...pair, a: pair.b, b: pair.a }, value: distance, corner };
    },
    sameRest: () => true,
    async answer(session, { pair, value, corner }) {
      const points = pointsById(pair.data);
      const at = points.get(corner);
      if (at === undefined) return null;
      const pointA = await pointAtDistance(session, pair.a, corner, at, value, points);
      if (pointA === null) return null;
      const pointB =
        variant === 'distances'
          ? await pointAtDistance(session, pair.b, corner, at, value, points)
          : await pointUnderAngle(session, pair, corner, at, pointA, points);
      return pointB === null ? null : { pointA, pointB };
    },
    edit({ pair, value, corner }, { pointA, pointB }, ids) {
      const angle = variant === 'angle' ? { angle: CHAMFER_ANGLE } : {};
      return chamferEdit(
        pair.data,
        { corner, a: pair.a.id, b: pair.b.id, pointA, pointB, distance: value, ...angle },
        ids,
      );
    },
  });
}

/**
 * The point of the curve at the chord `d` from its end `corner`: a line along it, an arc where the
 * circle (corner, d) meets it nearest the corner along the arc. Null beyond the curve.
 */
async function pointAtDistance(
  session: SketchSession,
  e: Edge,
  corner: SketchEntityId,
  at: SketchPoint,
  d: number,
  points: ReadonlyMap<SketchEntityId, SketchPoint>,
): Promise<Vec2 | null> {
  const curve = curve2(e, points);
  if (curve.kind === 'line') {
    const direction = directionFrom(e, corner, at, points);
    const length = Math.hypot(curve.to[0] - curve.from[0], curve.to[1] - curve.from[1]);
    if (direction === null || d >= length) return null;
    return [at.x + d * direction[0], at.y + d * direction[1]];
  }
  const circle: Curve2 = { kind: 'circle', center: [at.x, at.y], radius: d, id: CHAMFER_ID };
  const hits = await session.geometry.intersections([circle, curve]);
  const ts = paramsOn(hits, e.id);
  if (ts.length === 0) return null;
  // Nearest the corner along the arc: from its start the smallest t, from its end the largest.
  const fromStart = e.kind === 'arc' && e.start === corner;
  const best = fromStart ? Math.min(...ts) : Math.max(...ts);
  const hit = hits.find((h) => ownParam(h, e.id) === best);
  return hit?.point ?? null;
}

/**
 * The point of b where the ray from pointA meets it: the ray leaves pointA at CHAMFER_ANGLE to the
 * reference line a (towards the corner), turned to the side of b. Null without a meeting.
 */
async function pointUnderAngle(
  session: SketchSession,
  pair: PickedPair,
  corner: SketchEntityId,
  at: SketchPoint,
  pointA: Vec2,
  points: ReadonlyMap<SketchEntityId, SketchPoint>,
): Promise<Vec2 | null> {
  const towards: Vec2 = [at.x - pointA[0], at.y - pointA[1]];
  const length = Math.hypot(towards[0], towards[1]);
  const intoB = directionFrom(pair.b, corner, at, points);
  if (length === 0 || intoB === null) return null;
  const u: Vec2 = [towards[0] / length, towards[1] / length];
  const side = u[0] * intoB[1] - u[1] * intoB[0];
  if (Math.abs(side) < 1e-9) return null;
  const angle = Math.sign(side) * CHAMFER_ANGLE;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dir: Vec2 = [u[0] * cos - u[1] * sin, u[0] * sin + u[1] * cos];
  const ray: Curve2 = {
    kind: 'line',
    from: pointA,
    to: [pointA[0] + dir[0] * XLINE_EXTENT, pointA[1] + dir[1] * XLINE_EXTENT],
    id: CHAMFER_ID,
  };
  const hits = await session.geometry.intersections([ray, curve2(pair.b, points)]);
  // Nearest pointA along the ray (its own parameter, not the one on b).
  let best: CurveHit | null = null;
  for (const hit of hits) {
    const t = ownParam(hit, CHAMFER_ID);
    if (t === null || t <= 0) continue;
    if (best === null || t < (ownParam(best, CHAMFER_ID) ?? Infinity)) best = hit;
  }
  return best?.point ?? null;
}

/** The parameters on the curve `id` of the hits between it and the temporary curve. */
function paramsOn(hits: readonly CurveHit[], id: string): readonly number[] {
  return hits.flatMap((h) => {
    const t = ownParam(h, id);
    return t === null || (h.a !== CHAMFER_ID && h.b !== CHAMFER_ID) ? [] : [t];
  });
}

/** The parameter of the hit on the curve `id`, or null when it is not one of the two. */
function ownParam(hit: CurveHit, id: string): number | null {
  if (hit.a === id && hit.b !== id) return hit.ta;
  if (hit.b === id && hit.a !== id) return hit.tb;
  return null;
}
