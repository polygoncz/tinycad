// The drawing of a sketch (spec 10, "Kresba skici"): sketch data → a platform-neutral
// SketchDrawing that render tessellates and picks (ADR 0017). Pure functions; the SketchEditor
// draws the edited sketch with them and app the sketches of the last regeneration and the planes.

import { assertNever } from '@/core';
import type { Plane, Vec2 } from '@/core';
import { curve2, pointsById } from '@/sketch';
import type { Curve2, SketchCurve, SketchData, SketchEntity, SketchItemId } from '@/sketch';
import type {
  SketchDrawing,
  SketchDrawingCurve,
  SketchDrawingPoint,
  SketchStyle,
} from './viewport-port';

/** The id of the origin point in the drawing of the edited sketch (snap onto the origin). */
export const ORIGIN_POINT_ID = '__origin';

/** Default size of the square of a plane drawing, in mm. */
const PLANE_SIZE = 100;

const FULL_TURN = 2 * Math.PI;

/**
 * All curves and points of the data with the style from `styleOf`; `origin` adds the point
 * ORIGIN_POINT_ID at [0, 0] in the style 'normal' after the points of the sketch. Frozen.
 */
export function toSketchDrawing(
  plane: Plane,
  data: SketchData,
  styleOf: (id: SketchItemId) => SketchStyle,
  opts: { readonly origin?: boolean } = {},
): SketchDrawing {
  const points = pointsById(data);
  const curves = data.entities
    .filter(isCurve)
    .map((c) => drawingCurve(c.id, curve2(c, points), styleOf(c.id)));
  const drawn: SketchDrawingPoint[] = data.entities.flatMap((e) =>
    e.kind === 'point'
      ? [Object.freeze({ id: e.id, at: vec2(e.x, e.y), style: styleOf(e.id) })]
      : [],
  );
  if (opts.origin === true) {
    drawn.push(Object.freeze({ id: ORIGIN_POINT_ID, at: vec2(0, 0), style: 'normal' }));
  }
  return freezeDrawing(plane, curves, drawn);
}

/** The non-construction curves of a regenerated sketch in the style 'normal', no points. Frozen. */
export function artifactDrawing(plane: Plane, entities: readonly SketchEntity[]): SketchDrawing {
  const points = pointsById({ entities, constraints: [] });
  const curves = entities
    .filter(isCurve)
    .filter((c) => c.construction !== true)
    .map((c) => drawingCurve(c.id, curve2(c, points), 'normal'));
  return freezeDrawing(plane, curves, []);
}

/**
 * A square size × size (default 100 mm) centred in the origin of the plane: four lines in the
 * style 'plane' with the ids 'edge0' … 'edge3' (counter-clockwise from the bottom edge). Frozen.
 */
export function planeDrawing(plane: Plane, size: number = PLANE_SIZE): SketchDrawing {
  const h = size / 2;
  const corners: readonly Vec2[] = [vec2(-h, -h), vec2(h, -h), vec2(h, h), vec2(-h, h)];
  const curves = corners.map((from, i): SketchDrawingCurve => {
    const to = corners[(i + 1) % corners.length] ?? from;
    return Object.freeze({ kind: 'line', id: `edge${String(i)}`, from, to, style: 'plane' });
  });
  return freezeDrawing(plane, curves, []);
}

const isCurve = (e: SketchEntity): e is SketchCurve => e.kind !== 'point';

function vec2(x: number, y: number): Vec2 {
  return Object.freeze([x, y] as const);
}

/** A line as it is; a circle as an arc 0 … 2π; an arc counter-clockwise with endAngle > startAngle. */
function drawingCurve(id: string, curve: Curve2, style: SketchStyle): SketchDrawingCurve {
  switch (curve.kind) {
    case 'line':
      return Object.freeze({
        kind: 'line',
        id,
        from: vec2(...curve.from),
        to: vec2(...curve.to),
        style,
      });
    case 'circle':
      return Object.freeze({
        kind: 'arc',
        id,
        center: vec2(...curve.center),
        radius: curve.radius,
        startAngle: 0,
        endAngle: FULL_TURN,
        style,
      });
    case 'arc': {
      const [cx, cy] = curve.center;
      const startAngle = Math.atan2(curve.from[1] - cy, curve.from[0] - cx);
      let endAngle = Math.atan2(curve.to[1] - cy, curve.to[0] - cx);
      while (endAngle <= startAngle) endAngle += FULL_TURN;
      return Object.freeze({
        kind: 'arc',
        id,
        center: vec2(cx, cy),
        radius: Math.hypot(curve.from[0] - cx, curve.from[1] - cy),
        startAngle,
        endAngle,
        style,
      });
    }
    default:
      return assertNever(curve);
  }
}

function freezeDrawing(
  plane: Plane,
  curves: readonly SketchDrawingCurve[],
  points: readonly SketchDrawingPoint[],
): SketchDrawing {
  return Object.freeze({ plane, curves: Object.freeze(curves), points: Object.freeze(points) });
}
