import type { Vec2 } from '@/core';
import { nearestParam, paramRange, pointAt, samePoint } from './curve-param';
import { curve2 } from './geometry';
import { pointsById } from './points';
import type { FilletArc } from './geometry-port';
import type {
  SketchArc,
  SketchConstraint,
  SketchConstraintId,
  SketchData,
  SketchEntity,
  SketchEntityId,
  SketchLine,
  SketchPoint,
} from './model';
import { coordinatesOf, endIds, findCurve, isCurveEntity, newPoints, rebuild } from './trim';
import type { IdSource, SketchEdit } from './trim';
import { dist, dot, sub } from './vec2';

// Fillet and chamfer between two sketch curves (spec 12 "Zaoblení a sražení ve skice (M34)"):
// pure functions over the data rules of trim (M33). The geometry comes in the request: the
// centre and the points of contact of a fillet from SketchGeometry.fillet, the points of a
// chamfer computed by the tool (through SketchGeometry.intersections on an arc).

/** Only lines and arcs are filleted and chamfered (the solver has no arc–spline tangency). */
type Edge = SketchLine | SketchArc;

/** The two curves of a corner, in the order of the entities. */
export interface Corner {
  readonly a: SketchEntityId;
  readonly b: SketchEntityId;
}

export interface FilletRequest {
  /** A line or an arc. */
  readonly a: SketchEntityId;
  /** A line or an arc, not a. */
  readonly b: SketchEntityId;
  /**
   * The corner the user clicked (cornerOf gives a, b): the end of each curve in it moves and the
   * corner stays as the virtual sharp corner. Absent for two picked curves: the end of each curve
   * nearer its point of contact moves, the old end goes by rule 2 of M33.
   */
  readonly corner?: SketchEntityId;
  /** > 0, the value of the radius dimension. */
  readonly radius: number;
  /** geometry.fillet(curve2 of a, curve2 of b, radius, near). */
  readonly arc: FilletArc;
}

export interface ChamferRequest {
  /** The corner (cornerOf gives a, b). */
  readonly corner: SketchEntityId;
  /** The reference curve (the first picked): pointA lies on it; a line for the variant with an angle. */
  readonly a: SketchEntityId;
  readonly b: SketchEntityId;
  /** The new end of a, strictly inside a. */
  readonly pointA: Vec2;
  /** The new end of b, strictly inside b. */
  readonly pointB: Vec2;
  /** > 0: distance(corner, pointA), and distance(corner, pointB) without `angle`. */
  readonly distance: number;
  /**
   * The variant with an angle: angle(chamfer, a) in (0, π) rad, at pointA between the chamfer and
   * a; without it the variant with two distances.
   */
  readonly angle?: number;
}

/**
 * The corner in the point: the two curves that use it as an end point, when there are exactly two
 * and both are lines or arcs; else null (a centre or an inner pole of a spline is no end).
 */
export function cornerOf(data: SketchData, point: SketchEntityId): Corner | null {
  if (data.entities.find((e) => e.id === point)?.kind !== 'point') return null;
  const using = data.entities.filter((e) => isCurveEntity(e) && endIds(e).includes(point));
  const [a, b] = using;
  if (using.length !== 2 || !isEdge(a) || !isEdge(b)) return null;
  return Object.freeze({ a: a.id, b: b.id });
}

/**
 * Rounds the corner of a and b (or the two curves): a new centre and an arc counter-clockwise
 * between the points of contact on the side where the curves continue smoothly into it, the
 * moved ends of the curves in the points of contact (new points shared with the arc), tangent
 * between the arc and each curve, a radius dimension (`edit`). A corner stays as a point on both
 * carriers. Null for a bad request, and when a curve would degenerate (a line shortened to
 * nothing, a contact in a corner outside its curve).
 */
export function filletEdit(data: SketchData, req: FilletRequest, ids: IdSource): SketchEdit | null {
  if (!(Number.isFinite(req.radius) && req.radius > 0)) return null;
  const pair = edgePair(data, req.a, req.b, req.corner);
  if (pair === null) return null;
  const [a, b] = pair;
  const { arc } = req;
  if (samePoint(arc.pointA, arc.pointB)) return null;
  const points = pointsById(data);
  const endA = movedEnd(a, arc.pointA, req.corner, points);
  const endB = movedEnd(b, arc.pointB, req.corner, points);
  if (endA === null || endB === null) return null;

  const moved = moveEnds(data, [a, endA, arc.pointA], [b, endB, arc.pointB], req.corner, ids);
  if (moved === null) return null;
  const center = newPoint(arc.center, ids);
  // Counter-clockwise from the contact on a when the arc leaves it the way a runs into it.
  const into = keptDirection(a, endA, arc.pointA, points);
  const leaving: Vec2 = [-(arc.pointA[1] - arc.center[1]), arc.pointA[0] - arc.center[0]];
  const fromA = dot(leaving, into) > 0;
  const fillet: SketchArc = Object.freeze({
    kind: 'arc',
    id: ids.entity(),
    center: center.id,
    start: fromA ? moved.pointA : moved.pointB,
    end: fromA ? moved.pointB : moved.pointA,
    ...construction(a, b),
  });

  const virtual = virtualCorner(req.corner, a, b, ids);
  const tangents: SketchConstraint[] = [a, b].map((curve) =>
    Object.freeze({ kind: 'tangent', id: ids.constraint(), a: fillet.id, b: curve.id }),
  );
  const radius: SketchConstraint = Object.freeze({
    kind: 'radius',
    id: ids.constraint(),
    curve: fillet.id,
    value: req.radius,
  });
  return finish(moved.edit, [center, fillet], [...virtual, ...tangents], [radius], radius.id);
}

/**
 * Cuts the corner of a and b with a line pointA → pointB: the ends of the curves in the corner
 * move to the points (new points shared with the chamfer line), the corner stays as a point on
 * both carriers, dimensions distance(corner, pointA) = distance (`edit`) and either
 * distance(corner, pointB) = distance or angle(chamfer, a) = angle. Null for a bad request, an
 * arc as the reference of an angle, and a point not strictly inside its curve.
 */
export function chamferEdit(
  data: SketchData,
  req: ChamferRequest,
  ids: IdSource,
): SketchEdit | null {
  if (!(Number.isFinite(req.distance) && req.distance > 0)) return null;
  const { angle } = req;
  if (angle !== undefined && !(Number.isFinite(angle) && angle > 0 && angle < Math.PI)) return null;
  const pair = edgePair(data, req.a, req.b, req.corner);
  if (pair === null) return null;
  const [a, b] = pair;
  if (angle !== undefined && a.kind !== 'line') return null;
  if (samePoint(req.pointA, req.pointB)) return null;
  const points = pointsById(data);
  const endA = movedEnd(a, req.pointA, req.corner, points);
  const endB = movedEnd(b, req.pointB, req.corner, points);
  if (endA === null || endB === null) return null;

  const moved = moveEnds(data, [a, endA, req.pointA], [b, endB, req.pointB], req.corner, ids);
  if (moved === null) return null;
  const chamfer: SketchLine = Object.freeze({
    kind: 'line',
    id: ids.entity(),
    p1: moved.pointA,
    p2: moved.pointB,
    ...construction(a, b),
  });

  const virtual = virtualCorner(req.corner, a, b, ids);
  const first: SketchConstraint = Object.freeze({
    kind: 'distance',
    id: ids.constraint(),
    a: req.corner,
    b: moved.pointA,
    value: req.distance,
  });
  // The angle at pointA between the chamfer (pointA → pointB) and a towards the corner: a runs
  // towards the corner when its corner end is p2, else it is reversed.
  const second: SketchConstraint =
    angle === undefined
      ? Object.freeze({
          kind: 'distance',
          id: ids.constraint(),
          a: req.corner,
          b: moved.pointB,
          value: req.distance,
        })
      : Object.freeze({
          kind: 'angle',
          id: ids.constraint(),
          a: chamfer.id,
          b: a.id,
          value: angle,
          ...(a.kind === 'line' && endA === a.p1 ? { reverseB: true as const } : {}),
        });
  return finish(moved.edit, [chamfer], virtual, [first, second], first.id);
}

function isEdge(e: SketchEntity | null | undefined): e is Edge {
  return e?.kind === 'line' || e?.kind === 'arc';
}

/** The curves of the request: two different lines or arcs; with a corner, its curves. */
function edgePair(
  data: SketchData,
  a: SketchEntityId,
  b: SketchEntityId,
  corner: SketchEntityId | undefined,
): readonly [Edge, Edge] | null {
  if (a === b) return null;
  const ca = findCurve(data, a);
  const cb = findCurve(data, b);
  if (!isEdge(ca) || !isEdge(cb)) return null;
  if (corner !== undefined) {
    const pair = cornerOf(data, corner);
    if (pair === null || ![a, b].every((id) => id === pair.a || id === pair.b)) return null;
  }
  return [ca, cb];
}

/**
 * The end of the curve that moves to p: the corner, or else the end nearer p. Null when the curve
 * would degenerate: p on the end that stays; in a corner p not strictly inside the curve.
 */
function movedEnd(
  curve: Edge,
  p: Vec2,
  corner: SketchEntityId | undefined,
  points: ReadonlyMap<SketchEntityId, SketchPoint>,
): SketchEntityId | null {
  const [first, last] = endIds(curve);
  if (first === undefined || last === undefined) return null;
  const moving =
    corner ??
    (dist(coordinatesOf(points, first), p) <= dist(coordinatesOf(points, last), p) ? first : last);
  const staying = moving === first ? last : first;
  if (samePoint(coordinatesOf(points, staying), p)) return null;
  if (corner !== undefined) {
    // Strictly inside the curve: on it, and not in the corner either.
    const c = curve2(curve, points);
    if (!samePoint(pointAt(c, nearestParam(c, p)), p)) return null;
    if (samePoint(coordinatesOf(points, corner), p)) return null;
  }
  return moving;
}

interface MovedEnds {
  readonly edit: SketchEdit;
  readonly pointA: SketchEntityId;
  readonly pointB: SketchEntityId;
}

/**
 * The data with the moved end of each curve in its new point (a new point before the curve), by
 * the rules of trim: the old end goes when nothing uses it any more, but the corner stays.
 */
function moveEnds(
  data: SketchData,
  a: readonly [Edge, SketchEntityId, Vec2],
  b: readonly [Edge, SketchEntityId, Vec2],
  corner: SketchEntityId | undefined,
  ids: IdSource,
): MovedEnds | null {
  const keep = corner === undefined ? {} : { keep: corner };
  const move = (from: SketchData, [curve, end, p]: readonly [Edge, SketchEntityId, Vec2]) => {
    // The curve as it is in `from` (its points are the same as in data).
    const made = newPoints(curve.id, ids);
    const point = made.newPoint(p);
    const original = curve2(curve, pointsById(from));
    const [lo, hi] = paramRange(original);
    const [first, last] = endIds(curve);
    if (first === undefined || last === undefined) return null;
    const piece =
      end === first
        ? { from: lo, to: hi, start: point, end: last }
        : { from: lo, to: hi, start: first, end: point };
    return { edit: rebuild(from, curve, original, [piece], made, ids, keep), point };
  };
  const movedA = move(data, a);
  if (movedA === null) return null;
  const movedB = move(movedA.edit.data, b);
  if (movedB === null) return null;
  return {
    edit: Object.freeze({
      data: movedB.edit.data,
      added: new Set([...movedA.edit.added, ...movedB.edit.added]),
    }),
    pointA: movedA.point,
    pointB: movedB.point,
  };
}

/**
 * The direction in which the curve runs into its new end p (where it meets the fillet arc): a
 * line from its staying end, an arc counter-clockwise into its end, clockwise into its start.
 */
function keptDirection(
  curve: Edge,
  moved: SketchEntityId,
  p: Vec2,
  points: ReadonlyMap<SketchEntityId, SketchPoint>,
): Vec2 {
  if (curve.kind === 'line') {
    const staying = moved === curve.p1 ? curve.p2 : curve.p1;
    return sub(p, coordinatesOf(points, staying));
  }
  const r = sub(p, coordinatesOf(points, curve.center));
  const ccw: Vec2 = [-r[1], r[0]];
  return moved === curve.end ? ccw : [-ccw[0], -ccw[1]];
}

function newPoint(p: Vec2, ids: IdSource): SketchPoint {
  return Object.freeze({ kind: 'point', id: ids.entity(), x: p[0], y: p[1] });
}

/** A new curve is construction when both curves are. */
function construction(a: Edge, b: Edge): { readonly construction?: true } {
  return a.construction === true && b.construction === true ? { construction: true } : {};
}

/** The virtual sharp corner: pointOnCurve of the corner to both curves (none without a corner). */
function virtualCorner(
  corner: SketchEntityId | undefined,
  a: Edge,
  b: Edge,
  ids: IdSource,
): readonly SketchConstraint[] {
  if (corner === undefined) return [];
  return [a, b].map((curve) =>
    Object.freeze({ kind: 'pointOnCurve', id: ids.constraint(), point: corner, curve: curve.id }),
  );
}

/**
 * The edit with the new entities appended (their points are already in it) and the new
 * constraints: the geometric ones added (rewrite may drop them on a conflict), the dimensions not
 * (so the dimension to open stays).
 */
function finish(
  moved: SketchEdit,
  entities: readonly SketchEntity[],
  geometric: readonly SketchConstraint[],
  dimensions: readonly SketchConstraint[],
  edit: SketchConstraintId,
): SketchEdit {
  return Object.freeze({
    data: Object.freeze({
      entities: Object.freeze([...moved.data.entities, ...entities]),
      constraints: Object.freeze([...moved.data.constraints, ...geometric, ...dimensions]),
    }),
    added: new Set([...moved.added, ...geometric.map((c) => c.id)]),
    edit,
  });
}
