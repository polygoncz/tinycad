// The drawing of a sketch (spec 10, "Kresba skici"): sketch data → a platform-neutral
// SketchDrawing that render tessellates and picks (ADR 0017). Pure functions; the SketchEditor
// draws the edited sketch with them and app the sketches of the last regeneration and the planes.

import { assert, assertNever, bspline, vec3 } from '@/core';
import type { Plane, Vec2, Vec3 } from '@/core';
import { SPLINE_TOLERANCE, computeRegions, curve2, isPattern, pointsById } from '@/sketch';
import type {
  Curve2,
  SketchCurve,
  SketchData,
  SketchEntity,
  SketchEntityId,
  SketchItemId,
  SketchPoint,
  SketchRegion,
} from '@/sketch';
import type {
  SketchDrawing,
  SketchDrawingCurve,
  SketchDrawingPoint,
  SketchDrawingRegion,
  SketchStyle,
} from '@/interaction';

/** The id of the origin point in the drawing of the edited sketch (snap onto the origin). */
export const ORIGIN_POINT_ID = '__origin';

const CONTROL_POLYGON_PREFIX = '__poles:';

/**
 * The id of the control polygon of the bspline `splineId` in the drawing of the edited sketch
 * (M29). Like ORIGIN_POINT_ID it relies on the ids from the id generator never starting with
 * '__': it is no entity id; the tools translate a pick of it to the spline
 * (splineOfControlPolygon).
 */
export function controlPolygonId(splineId: string): string {
  return `${CONTROL_POLYGON_PREFIX}${splineId}`;
}

/** The id of the spline whose control polygon has the drawing id `id`; null for any other id. */
export function splineOfControlPolygon(id: string): string | null {
  return id.startsWith(CONTROL_POLYGON_PREFIX) ? id.slice(CONTROL_POLYGON_PREFIX.length) : null;
}

/** Default size of the square of a plane drawing, in mm. */
const PLANE_SIZE = 100;

/** Default length of an axis drawing, in mm (M13). */
const AXIS_SIZE = 100;

const FULL_TURN = 2 * Math.PI;

/** The largest angle step of the polyline of an arc or a circle in a region (M13). */
const REGION_ARC_STEP = Math.PI / 36;

/** Below this |d_z| the normal of an axis drawing is d × +Z, otherwise d × +X (spec 10). */
const AXIS_Z_LIMIT = 0.9;

/**
 * All curves and points of the data with the style from `styleOf`, a spline as a polyline (M29);
 * after a bspline its control polygon (controlPolygonId) in the style 'construction' (the poles
 * are points of the sketch, the poles of a fitSpline are not drawn); `origin` adds the point
 * ORIGIN_POINT_ID at [0, 0] in the style 'normal' after the points of the sketch; `editing` marks
 * the drawing of the sketch edited in the sketcher (SketchDrawing.editing). Frozen.
 */
export function toSketchDrawing(
  plane: Plane,
  data: SketchData,
  styleOf: (id: SketchItemId) => SketchStyle,
  opts: { readonly origin?: boolean; readonly editing?: boolean } = {},
): SketchDrawing {
  const points = pointsById(data);
  const curves = data.entities.filter(isCurve).flatMap((c) => {
    const curve = drawingCurve(c.id, curve2(c, points), styleOf(c.id));
    return c.kind === 'bspline' ? [curve, controlPolygon(c.id, c.poles, points)] : [curve];
  });
  const drawn: SketchDrawingPoint[] = data.entities.flatMap((e) =>
    e.kind === 'point'
      ? [Object.freeze({ id: e.id, at: vec2(e.x, e.y), style: styleOf(e.id) })]
      : [],
  );
  if (opts.origin === true) {
    drawn.push(Object.freeze({ id: ORIGIN_POINT_ID, at: vec2(0, 0), style: 'normal' }));
  }
  const drawing = freezeDrawing(plane, curves, drawn);
  // Only the edited sketch carries the flag; the others stay without the property.
  return opts.editing === true ? Object.freeze({ ...drawing, editing: true }) : drawing;
}

/**
 * The curves of a regenerated sketch without points: non-construction ones in the style 'normal',
 * construction ones in the style 'construction' (M13, R74: a construction line can be the axis of
 * Revolve), and the regions of computeRegions as polygons named like the regions (M13). Frozen.
 */
export function artifactDrawing(plane: Plane, entities: readonly SketchEntity[]): SketchDrawing {
  const data: SketchData = { entities, constraints: [] };
  const points = pointsById(data);
  const curves = entities
    .filter(isCurve)
    .map((c) =>
      drawingCurve(c.id, curve2(c, points), c.construction === true ? 'construction' : 'normal'),
    );
  const regions = computeRegions(data).regions.map(drawingRegion);
  return Object.freeze({
    plane,
    curves: Object.freeze(curves),
    points: Object.freeze([]),
    regions: Object.freeze(regions),
  });
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

/**
 * An axis as a drawing (M13): one line 'axis' of length size (default 100 mm) centred in
 * axis.origin, in the style 'plane'; the plane of the drawing has xDir = d̂ and
 * normal = unit(d̂ × (|d̂_z| < 0.9 ? +Z : +X)). No points, no regions. Frozen.
 */
export function axisDrawing(
  axis: { readonly origin: Vec3; readonly direction: Vec3 },
  size: number = AXIS_SIZE,
): SketchDrawing {
  const xDir = vec3.normalize(axis.direction);
  const helper: Vec3 = Math.abs(xDir[2]) < AXIS_Z_LIMIT ? [0, 0, 1] : [1, 0, 0];
  const normal = vec3.normalize(vec3.cross(xDir, helper));
  const frame: Plane = Object.freeze({ origin: axis.origin, xDir, normal });
  const h = size / 2;
  const line: SketchDrawingCurve = Object.freeze({
    kind: 'line',
    id: 'axis',
    from: vec2(-h, 0),
    to: vec2(h, 0),
    style: 'plane',
  });
  return freezeDrawing(frame, [line], []);
}

const isCurve = (e: SketchEntity): e is SketchCurve => e.kind !== 'point' && !isPattern(e);

/** The polyline through the pole points of a bspline, in the style 'construction' (M29). */
function controlPolygon(
  splineId: string,
  poles: readonly SketchEntityId[],
  points: ReadonlyMap<SketchEntityId, SketchPoint>,
): SketchDrawingCurve {
  const at = poles.map((id) => {
    const p = points.get(id);
    assert(
      p !== undefined,
      `controlPolygon: spline '${splineId}' refers to a missing point '${id}'`,
    );
    return vec2(p.x, p.y);
  });
  return Object.freeze({
    kind: 'polyline',
    id: controlPolygonId(splineId),
    points: Object.freeze(at),
    style: 'construction',
  });
}

/** The points of a spline at the tolerance of SPLINE_TOLERANCE, frozen. */
function splinePoints(curve: Extract<Curve2, { kind: 'bspline' }>): Vec2[] {
  const size = Math.max(1, ...curve.poles.flatMap(([x, y]) => [Math.abs(x), Math.abs(y)]));
  return bspline.tessellate(curve, SPLINE_TOLERANCE * size).map(([x, y]) => vec2(x, y));
}

/** A region as polygons: the outer loop counter-clockwise, the holes as computeRegions gives them. */
function drawingRegion(region: SketchRegion): SketchDrawingRegion {
  return Object.freeze({
    id: region.name,
    outer: loopPolygon(region.outer),
    holes: Object.freeze(region.holes.map(loopPolygon)),
  });
}

/**
 * A closed loop of curves (each one from → to along the loop) as a polygon: every curve adds its
 * start and, for an arc or a circle, the points in between at steps of at most REGION_ARC_STEP.
 * The last point is not the first one again.
 */
function loopPolygon(loop: readonly Curve2[]): readonly Vec2[] {
  return Object.freeze(loop.flatMap(curvePoints));
}

/** The points of one curve of a loop, without its end (the start of the next curve). */
function curvePoints(curve: Curve2): Vec2[] {
  switch (curve.kind) {
    case 'line':
      return [vec2(...curve.from)];
    case 'circle':
      return arcPoints(curve.center, curve.radius, 0, FULL_TURN);
    case 'arc': {
      const [cx, cy] = curve.center;
      const a0 = Math.atan2(curve.from[1] - cy, curve.from[0] - cx);
      const a1 = Math.atan2(curve.to[1] - cy, curve.to[0] - cx);
      const ccwSweep = positiveAngle(a1 - a0);
      // A clockwise arc of a loop (the reverse half-edge) turns the other way.
      const sweep = curve.ccw ? ccwSweep : -positiveAngle(a0 - a1);
      const radius = Math.hypot(curve.from[0] - cx, curve.from[1] - cy);
      return arcPoints(curve.center, radius, a0, sweep);
    }
    case 'bspline':
      // The spline runs from → to along the loop, its end starts the next curve.
      return splinePoints(curve).slice(0, -1);
    default:
      return assertNever(curve);
  }
}

/** The start and the inner points of an arc of `sweep` radians (negative = clockwise) from a0. */
function arcPoints(center: Vec2, radius: number, a0: number, sweep: number): Vec2[] {
  // The small slack keeps a whole number of steps (2π / (π/36)) from rounding up to one more.
  const n = Math.max(1, Math.ceil(Math.abs(sweep) / REGION_ARC_STEP - 1e-9));
  return Array.from({ length: n }, (_, i) => {
    const a = a0 + (sweep * i) / n;
    return vec2(center[0] + radius * Math.cos(a), center[1] + radius * Math.sin(a));
  });
}

/** The angle in (0, 2π]: an arc with equal ends is a full turn. */
function positiveAngle(a: number): number {
  const r = a % FULL_TURN;
  return r <= 0 ? r + FULL_TURN : r;
}

function vec2(x: number, y: number): Vec2 {
  return Object.freeze([x, y] as const);
}

/**
 * A line as it is; a circle as an arc 0 … 2π; an arc counter-clockwise with endAngle > startAngle;
 * a spline as the polyline of its tessellation (M29).
 */
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
    case 'bspline':
      return Object.freeze({
        kind: 'polyline',
        id,
        points: Object.freeze(splinePoints(curve)),
        style,
      });
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
