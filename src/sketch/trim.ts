import { assert, assertNever } from '@/core';
import type { Vec2 } from '@/core';
import { nearestParam, paramRange, pointAt, samePoint } from './curve-param';
import { constraintTargets, curvePoints, removeItems } from './edit';
import { curve2, pointsById } from './geometry';
import type { Curve2 } from './geometry';
import type { CurveHit } from './geometry-port';
import type {
  SketchConstraint,
  SketchConstraintId,
  SketchCurve,
  SketchData,
  SketchEntity,
  SketchEntityId,
  SketchPoint,
} from './model';
import { TWO_PI, mod2pi } from './vec2';

// Trim, extend and split of sketch curves (spec 12 "Trim, extend, split (M33)"): pure functions
// that rearrange the entities and constraints of the sketch around the intersections the kernel
// computed (SketchGeometry). They call nothing asynchronous: the pieces of a spline come from
// SketchGeometry.segment in the request.

/** A place where other curves (or the curve itself) cut a curve. */
export interface CurveCut {
  /** The parameter on the cut curve (spec 12 "Port a parametr křivky"). */
  readonly t: number;
  readonly point: Vec2;
  /** The cutting curve; of several in one point the first in the order of entities. */
  readonly by: SketchEntityId;
  /** The existing point there when it is an end point of a cutting curve, else null. */
  readonly at: SketchEntityId | null;
}

/** A piece of a curve between two neighbouring cuts or a cut and an end of the curve. */
export interface CurvePiece {
  /** from < to; on a circle to may run past 2π (at most from + 2π). */
  readonly from: number;
  readonly to: number;
  /** The cut at `from`, or null when the piece starts at the start of the curve (a circle without cuts). */
  readonly start: CurveCut | null;
  /** The cut at `to`, or null when the piece ends at the end of the curve (a circle without cuts). */
  readonly end: CurveCut | null;
}

/** The source of new ids of an edit; the sketcher tools mint them from their ToolContext. */
export interface IdSource {
  entity(): SketchEntityId;
  constraint(): SketchConstraintId;
}

/** New data and the ids of the added constraints (for SketchSession.rewrite). */
export interface SketchEdit {
  readonly data: SketchData;
  readonly added: ReadonlySet<SketchConstraintId>;
  /** A dimension of the edit to open for editing after the write (M34: fillet and chamfer). */
  readonly edit?: SketchConstraintId;
}

export interface TrimRequest {
  readonly curve: SketchEntityId;
  /** The piece to remove: pieceAt(curve2 of the curve, cutsOf(…), nearestParam(cursor)). */
  readonly piece: CurvePiece;
  /**
   * A spline only: the kept pieces from SketchGeometry.segment in the order of t – [start of the
   * spline, piece.from] when piece.start is not null, [piece.to, end of the spline] when piece.end
   * is not null (the range of sketch splines is [0, 1]).
   */
  readonly pieces?: readonly Curve2[];
}

export interface ExtendRequest {
  /** A line or an arc. */
  readonly curve: SketchEntityId;
  /** The end that moves: p1 / start of an arc, or p2 / end of an arc. */
  readonly end: 'start' | 'end';
  /** The new end: the intersection of the extension with the target curve. */
  readonly point: Vec2;
  /** The target curve. */
  readonly by: SketchEntityId;
}

export interface SplitRequest {
  readonly curve: SketchEntityId;
  /** Where: a parameter of the curve, or a cut of cutsOf the tool snapped to. */
  readonly where: number | CurveCut;
  /** A spline only: the pieces [start, t] and [t, end] from SketchGeometry.segment. */
  readonly pieces?: readonly [Curve2, Curve2];
}

/**
 * The cuts of a curve: the parameters of its hits with other curves and with itself (a spline),
 * without its own end points, sorted by t, merged within the tolerance of points (a circle
 * cyclically). [] for an id that is not a curve of the data; hits of curves not in the data
 * (the __extend curve of the tool) are ignored.
 */
export function cutsOf(
  data: SketchData,
  curve: SketchEntityId,
  hits: readonly CurveHit[],
): readonly CurveCut[] {
  const curves = new Map<string, { readonly curve: SketchCurve; readonly index: number }>();
  data.entities.forEach((e, index) => {
    if (e.kind !== 'point') curves.set(e.id, { curve: e, index });
  });
  const self = curves.get(curve)?.curve;
  if (self === undefined) return Object.freeze([]);
  const points = pointsById(data);
  const c = curve2(self, points);
  const ends = endIds(self).map((id) => coordinatesOf(points, id));

  interface Raw {
    readonly t: number;
    readonly point: Vec2;
    readonly by: SketchCurve;
    readonly index: number;
  }
  const raw: Raw[] = [];
  const push = (t: number, point: Vec2, other: string): void => {
    const by = curves.get(other);
    if (by !== undefined) raw.push({ t, point, by: by.curve, index: by.index });
  };
  for (const hit of hits) {
    if (hit.a === curve) push(hit.ta, hit.point, hit.b);
    if (hit.b === curve) push(hit.tb, hit.point, hit.a);
  }
  const sorted = raw
    .filter((r) => !ends.some((end) => samePoint(end, r.point)))
    .sort((x, y) => x.t - y.t || x.index - y.index);

  // Neighbours in one point (and the curve between them too, so the two parameters of a
  // self-intersection around a loop stay apart) are one cut.
  const together = (a: Raw, b: Raw, tb: number): boolean =>
    samePoint(a.point, b.point) && samePoint(pointAt(c, (a.t + tb) / 2), a.point);
  const groups: Raw[][] = [];
  for (const r of sorted) {
    const group = groups.at(-1);
    const head = group?.[0];
    if (group !== undefined && head !== undefined && together(head, r, r.t)) group.push(r);
    else groups.push([r]);
  }
  const first = groups[0]?.[0];
  const lastGroup = groups.at(-1);
  const lastHead = lastGroup?.[0];
  if (
    self.kind === 'circle' &&
    groups.length > 1 &&
    first !== undefined &&
    lastGroup !== undefined &&
    lastHead !== undefined &&
    together(lastHead, first, first.t + TWO_PI)
  ) {
    groups.pop();
    groups[0]?.push(...lastGroup);
  }

  return Object.freeze(
    groups.flatMap((group): CurveCut[] => {
      const head = group[0];
      if (head === undefined) return [];
      const byOrder = [...group].sort((x, y) => x.index - y.index);
      const by = byOrder[0]?.by.id ?? head.by.id;
      const at = byOrder.map((r) => endAt(r.by, head.point, points)).find((id) => id !== null);
      return [Object.freeze({ t: head.t, point: head.point, by, at: at ?? null })];
    }),
  );
}

/**
 * The crossing points (spec 12, "Průsečíky v session a body křížení", Q093): the hits of two
 * non-construction curves (or a self-intersection of a spline) that are not in an end point
 * shared by both curves, and the ends of overlaps (always); in plane coordinates. Hits of curves
 * not in the data are skipped. Frozen.
 */
export function crossingPoints(data: SketchData, hits: readonly CurveHit[]): readonly Vec2[] {
  const curves = new Map<string, SketchCurve>();
  for (const e of data.entities) if (e.kind !== 'point') curves.set(e.id, e);
  const points = pointsById(data);
  const endsOf = (c: SketchCurve): readonly Vec2[] =>
    endIds(c).map((id) => coordinatesOf(points, id));
  return Object.freeze(
    hits.flatMap((hit) => {
      const a = curves.get(hit.a);
      const b = curves.get(hit.b);
      if (a === undefined || b === undefined) return [];
      if (a.construction === true || b.construction === true) return [];
      if (hit.overlap === true) return [hit.point];
      const at = (end: Vec2): boolean => samePoint(end, hit.point);
      const endsA = endsOf(a);
      // A self-intersection in both ends of the spline is a closed spline meeting itself.
      const shared =
        hit.a === hit.b
          ? endsA.length === 2 && endsA.every(at)
          : endsA.some(at) && endsOf(b).some(at);
      return shared ? [] : [hit.point];
    }),
  );
}

/**
 * The piece of the curve around the parameter t: between the neighbouring cuts, at the ends of
 * the curve up to the end point; on a circle cyclically (without cuts the whole turn, with one
 * cut from it round to it).
 */
export function pieceAt(curve: Curve2, cuts: readonly CurveCut[], t: number): CurvePiece {
  if (curve.kind === 'circle') {
    const first = cuts[0];
    const last = cuts.at(-1);
    if (first === undefined || last === undefined) {
      return Object.freeze({ from: 0, to: TWO_PI, start: null, end: null });
    }
    const turn = mod2pi(t);
    const i = cuts.findLastIndex((k) => k.t <= turn);
    const start = i === -1 ? last : (cuts[i] ?? last);
    const end = i === -1 ? first : (cuts[i + 1] ?? first);
    const to = end.t > start.t ? end.t : end.t + TWO_PI;
    return Object.freeze({ from: start.t, to, start, end });
  }
  const [lo, hi] = paramRange(curve);
  const start = cuts.findLast((k) => k.t <= t) ?? null;
  const end = cuts.find((k) => k.t > t) ?? null;
  return Object.freeze({ from: start?.t ?? lo, to: end?.t ?? hi, start, end });
}

/**
 * Removes the piece of the request: without cuts (a circle with fewer than two) the curve goes
 * (removeItems); a piece at an end shortens the curve, one in the middle leaves two curves; a
 * circle becomes an arc from the cut after the piece round to the cut before it. Null when the
 * id is not a curve.
 */
export function trimEdit(data: SketchData, req: TrimRequest, ids: IdSource): SketchEdit | null {
  const curve = findCurve(data, req.curve);
  if (curve === null) return null;
  const { piece } = req;
  const original = curve2(curve, pointsById(data));
  const made = newPoints(curve.id, ids);
  if (curve.kind === 'circle') {
    if (piece.start === null || piece.end === null || piece.start === piece.end) {
      return removed(data, curve.id);
    }
    const start = made.cutPoint(piece.end);
    const end = made.cutPoint(piece.start);
    const arc = { from: piece.to, to: piece.from + TWO_PI, start, end };
    return rebuild(data, curve, original, [arc], made, ids);
  }
  if (piece.start === null && piece.end === null) return removed(data, curve.id);
  const [lo, hi] = paramRange(original);
  const [first, last] = endIds(curve);
  assert(first !== undefined && last !== undefined, `trimEdit: '${curve.id}' has no ends`);
  const kept: PieceSpec[] = [];
  if (piece.start !== null) {
    kept.push({ from: lo, to: piece.from, start: first, end: made.cutPoint(piece.start) });
  }
  if (piece.end !== null) {
    kept.push({ from: piece.to, to: hi, start: made.cutPoint(piece.end), end: last });
  }
  return rebuild(data, curve, original, withSplines(curve, kept, req.pieces), made, ids);
}

/**
 * Moves an end of a line or an arc to the point on the target curve: the existing end point of
 * the target there, or a new point with pointOnCurve to it. Null for another kind of curve, an
 * unknown target, the curve itself as the target, or a new end on the other end.
 */
export function extendEdit(data: SketchData, req: ExtendRequest, ids: IdSource): SketchEdit | null {
  const curve = findCurve(data, req.curve);
  const by = findCurve(data, req.by);
  if (curve === null || by === null || by.id === curve.id) return null;
  if (curve.kind !== 'line' && curve.kind !== 'arc') return null;
  const points = pointsById(data);
  const [first, last] = endIds(curve);
  assert(first !== undefined && last !== undefined, `extendEdit: '${curve.id}' has no ends`);
  const fixed = req.end === 'start' ? last : first;
  const at = endAt(by, req.point, points);
  if (at === fixed || samePoint(coordinatesOf(points, fixed), req.point)) return null;
  const original = curve2(curve, points);
  const [lo, hi] = paramRange(original);
  const made = newPoints(curve.id, ids);
  const moved = made.cutPoint({ t: 0, point: req.point, by: by.id, at });
  const piece: PieceSpec =
    req.end === 'start'
      ? { from: lo, to: hi, start: moved, end: last }
      : { from: lo, to: hi, start: first, end: moved };
  return rebuild(data, curve, original, [piece], made, ids);
}

/**
 * Splits the curve in a point: a line, an arc, a spline into two pieces sharing the point (a
 * line with parallel between them); a circle into two arcs in the point and in the opposite one
 * (t + π). Null for an id that is not a curve and for a point at an end of the curve.
 */
export function splitEdit(data: SketchData, req: SplitRequest, ids: IdSource): SketchEdit | null {
  const curve = findCurve(data, req.curve);
  if (curve === null) return null;
  const original = curve2(curve, pointsById(data));
  const cut = typeof req.where === 'number' ? null : req.where;
  const t = typeof req.where === 'number' ? req.where : req.where.t;
  const point = cut?.point ?? pointAt(original, t);
  const made = newPoints(curve.id, ids);
  if (curve.kind === 'circle') {
    const here = cut === null ? made.newPoint(point) : made.cutPoint(cut);
    const opposite = made.newPoint(pointAt(original, t + Math.PI));
    const a = mod2pi(t);
    const b = mod2pi(t + Math.PI);
    const arcs: PieceSpec[] = [
      { from: a, to: a + Math.PI, start: here, end: opposite },
      { from: b, to: b + Math.PI, start: opposite, end: here },
    ];
    // The arc starting at the smaller t keeps the id (rule 1).
    return rebuild(data, curve, original, a < b ? arcs : arcs.reverse(), made, ids);
  }
  const [lo, hi] = paramRange(original);
  if (t <= lo || t >= hi) return null;
  if ([pointAt(original, lo), pointAt(original, hi)].some((end) => samePoint(end, point))) {
    return null;
  }
  const [first, last] = endIds(curve);
  assert(first !== undefined && last !== undefined, `splitEdit: '${curve.id}' has no ends`);
  const here = cut === null ? made.newPoint(point) : made.cutPoint(cut);
  const pieces: PieceSpec[] = [
    { from: lo, to: t, start: first, end: here },
    { from: t, to: hi, start: here, end: last },
  ];
  return rebuild(data, curve, original, withSplines(curve, pieces, req.pieces), made, ids, {
    parallel: curve.kind === 'line',
  });
}

/** A kept piece of the edited curve with the ids of its end points. */
export interface PieceSpec {
  readonly from: number;
  readonly to: number;
  readonly start: SketchEntityId;
  readonly end: SketchEntityId;
  /** A spline: the piece from SketchGeometry.segment. */
  readonly spline?: Curve2;
}

/** The new points of an edit and their pointOnCurve constraints, in the order they were minted. */
export interface NewPoints {
  readonly points: readonly SketchPoint[];
  readonly added: readonly SketchConstraint[];
  newPoint(p: Vec2): SketchEntityId;
  /** The point of an end in a cut: `at`, or a new point on the cutting curve (not on the curve itself). */
  cutPoint(cut: CurveCut): SketchEntityId;
}

export function newPoints(curve: SketchEntityId, ids: IdSource): NewPoints {
  const points: SketchPoint[] = [];
  const added: SketchConstraint[] = [];
  const newPoint = (p: Vec2): SketchEntityId => {
    const id = ids.entity();
    points.push(Object.freeze({ kind: 'point', id, x: p[0], y: p[1] }));
    return id;
  };
  return {
    points,
    added,
    newPoint,
    cutPoint(cut) {
      if (cut.at !== null) return cut.at;
      // Cuts in one place give one point: both ends of a removed loop of a spline meet there.
      const existing = points.find((p) => samePoint([p.x, p.y], cut.point));
      if (existing !== undefined) return existing.id;
      const point = newPoint(cut.point);
      // On a self-intersection the point would end up on its own spline piece: no constraint.
      if (cut.by !== curve) {
        added.push(
          Object.freeze({ kind: 'pointOnCurve', id: ids.constraint(), point, curve: cut.by }),
        );
      }
      return point;
    },
  };
}

/** Attaches the spline pieces of the request to the kept pieces of a spline (a caller bug if they do not fit). */
function withSplines(
  curve: SketchCurve,
  kept: readonly PieceSpec[],
  pieces: readonly Curve2[] | undefined,
): readonly PieceSpec[] {
  if (curve.kind !== 'bspline' && curve.kind !== 'fitSpline') return kept;
  assert(
    pieces?.length === kept.length,
    `trim: spline '${curve.id}' needs ${String(kept.length)} pieces from segment`,
  );
  return kept.map((spec, i) => {
    const spline = pieces[i];
    assert(spline !== undefined, `trim: missing piece ${String(i)} of spline '${curve.id}'`);
    return { ...spec, spline };
  });
}

/**
 * The data with the curve replaced by its pieces (pieces[0] keeps the id, the others get new
 * ids), the new points before the pieces (the planegcs solver needs the points of a line or
 * an arc before it), the original defining points no entity uses any more removed (but `keep`:
 * the virtual sharp corner of a fillet, M34), and the constraints carried over by rule 3 of
 * spec 12.
 */
export function rebuild(
  data: SketchData,
  curve: SketchCurve,
  original: Curve2,
  pieces: readonly PieceSpec[],
  made: NewPoints,
  ids: IdSource,
  opts: { readonly parallel?: boolean; readonly keep?: SketchEntityId } = {},
): SketchEdit {
  const pieceIds = pieces.map((_, i) => (i === 0 ? curve.id : ids.entity()));
  const interior: SketchPoint[] = [];
  const entities = pieces.map((spec, i) =>
    pieceEntity(curve, spec, pieceIds[i] ?? curve.id, ids, interior),
  );
  const added = [...made.added];
  const [firstId, secondId] = pieceIds;
  if (opts.parallel === true && firstId !== undefined && secondId !== undefined) {
    added.push(Object.freeze({ kind: 'parallel', id: ids.constraint(), a: firstId, b: secondId }));
  }

  const [first, ...rest] = entities;
  assert(first !== undefined, 'rebuild: no piece');
  const replaced = data.entities.flatMap((e): SketchEntity[] =>
    e.id === curve.id ? [...made.points, ...interior, first, ...rest] : [e],
  );
  const used = new Set(replaced.flatMap((e) => (e.kind === 'point' ? [] : curvePoints(e))));
  const dropped = new Set<string>(
    curvePoints(curve).filter((p) => !used.has(p) && p !== opts.keep),
  );
  const kept = replaced.filter((e) => !dropped.has(e.id));

  const points = pointsById(data);
  const ranges = pieces.map((spec, i) => ({ ...spec, id: pieceIds[i] ?? curve.id }));
  const before = new Map<string, SketchEntity>(data.entities.map((e) => [e.id, e]));
  const carried = data.constraints.flatMap((c) =>
    carry(c, curve, original, ranges, dropped, points, before),
  );
  const byId = new Map<string, SketchEntity>(kept.map((e) => [e.id, e]));
  const constraints = [...carried, ...added].filter((c) => stillValid(c, byId));
  const addedIds = new Set(added.map((c) => c.id));
  return Object.freeze({
    data: Object.freeze({
      entities: Object.freeze(kept),
      constraints: Object.freeze(constraints),
    }),
    added: new Set(constraints.filter((c) => addedIds.has(c.id)).map((c) => c.id)),
  });
}

/** The entity of a kept piece: the kind of the curve (a circle gives an arc, a spline a bspline). */
function pieceEntity(
  curve: SketchCurve,
  spec: PieceSpec,
  id: SketchEntityId,
  ids: IdSource,
  interior: SketchPoint[],
): SketchCurve {
  const construction = curve.construction === true ? { construction: true as const } : {};
  switch (curve.kind) {
    case 'line':
      return Object.freeze({ kind: 'line', id, p1: spec.start, p2: spec.end, ...construction });
    case 'arc':
    case 'circle':
      return Object.freeze({
        kind: 'arc',
        id,
        center: curve.center,
        start: spec.start,
        end: spec.end,
        ...construction,
      });
    case 'bspline':
    case 'fitSpline': {
      const piece = spec.spline;
      assert(piece?.kind === 'bspline', `trim: the piece of spline '${curve.id}' is not a bspline`);
      const n = piece.poles.length;
      const degree = splineDegree(n);
      assert(
        degree === piece.degree && piece.knots.length === n + degree + 1,
        `trim: a malformed piece of spline '${curve.id}'`,
      );
      const inner = piece.poles.slice(1, -1).map((p) => {
        const pole = Object.freeze({ kind: 'point' as const, id: ids.entity(), x: p[0], y: p[1] });
        interior.push(pole);
        return pole.id;
      });
      // The ends of the knots exactly 0 and 1 (a rescaled piece may be off by rounding).
      const knots = piece.knots.map((k, i) => (i <= degree ? 0 : i >= n ? 1 : k));
      return Object.freeze({
        kind: 'bspline',
        id,
        degree,
        poles: Object.freeze([spec.start, ...inner, spec.end]),
        knots: Object.freeze(knots),
        ...construction,
      });
    }
    case 'xline':
      // findCurve never gives an infinite line: it has no ends to trim, extend or split.
      throw new Error(`trim: the infinite line '${curve.id}' has no pieces`);
    default:
      return assertNever(curve);
  }
}

/**
 * A constraint after the edit (rule 3): gone with a dropped point; equal of two lines and
 * midpoint of the edited line gone (the length changed); pointOnCurve on a spline moved to the
 * piece the point lies on, a tangent of a line and a spline to the piece holding the shared end,
 * or gone; the rest stays with the piece keeping the id.
 */
function carry(
  c: SketchConstraint,
  curve: SketchCurve,
  original: Curve2,
  pieces: readonly (PieceSpec & { readonly id: SketchEntityId })[],
  dropped: ReadonlySet<string>,
  points: ReadonlyMap<SketchEntityId, SketchPoint>,
  entities: ReadonlyMap<string, SketchEntity>,
): SketchConstraint[] {
  const targets = constraintTargets(c);
  if (targets.some((t) => dropped.has(t))) return [];
  if (!targets.includes(curve.id)) return [c];
  if (c.kind === 'midpoint' || (c.kind === 'equal' && curve.kind === 'line')) return [];
  if (c.kind === 'pointOnCurve' && (curve.kind === 'bspline' || curve.kind === 'fitSpline')) {
    const t = nearestParam(original, coordinatesOf(points, c.point));
    const piece = pieces.find((p) => t >= p.from - PARAM_SLACK && t <= p.to + PARAM_SLACK);
    return piece === undefined ? [] : [Object.freeze({ ...c, curve: piece.id })];
  }
  if (c.kind === 'tangent' && (curve.kind === 'bspline' || curve.kind === 'fitSpline')) {
    // A line tangent at an end of the spline: to the piece that holds the shared end, or gone.
    const other = c.a === curve.id ? c.b : c.a;
    const line = entities.get(other);
    if (line?.kind !== 'line') return [c];
    const piece = pieces.find((p) => [p.start, p.end].some((e) => e === line.p1 || e === line.p2));
    if (piece === undefined) return [];
    return [Object.freeze(c.a === curve.id ? { ...c, a: piece.id } : { ...c, b: piece.id })];
  }
  return [c];
}

/** Slack of the parameter of a point at the end of a spline piece. */
const PARAM_SLACK = 1e-9;

/**
 * Whether a constraint still fits the edited entities (the checks of parseSketchData an edit can
 * break): its entities exist; a point on, in the middle of or at a distance from a curve does not
 * define it; a tangent of a line and a spline still shares an end of the spline.
 */
function stillValid(c: SketchConstraint, byId: ReadonlyMap<string, SketchEntity>): boolean {
  if (!constraintTargets(c).every((t) => byId.has(t))) return false;
  switch (c.kind) {
    case 'pointOnCurve':
      return !defines(byId.get(c.curve), c.point);
    case 'midpoint':
    case 'pointLineDistance':
      return !defines(byId.get(c.line), c.point);
    case 'tangent': {
      const a = byId.get(c.a);
      const b = byId.get(c.b);
      const line = a?.kind === 'line' ? a : b?.kind === 'line' ? b : undefined;
      const spline = [a, b].find(isSpline);
      if (line === undefined || spline === undefined) return true;
      const ends = endIds(spline);
      return ends.includes(line.p1) || ends.includes(line.p2);
    }
    default:
      return true;
  }
}

function isSpline(
  e: SketchEntity | undefined,
): e is Extract<SketchCurve, { kind: 'bspline' | 'fitSpline' }> {
  return e?.kind === 'bspline' || e?.kind === 'fitSpline';
}

function defines(curve: SketchEntity | undefined, point: SketchEntityId): boolean {
  return curve !== undefined && curve.kind !== 'point' && curvePoints(curve).includes(point);
}

/** The edit that removes the whole curve (no cut to trim at). */
function removed(data: SketchData, curve: SketchEntityId): SketchEdit {
  return Object.freeze({ data: removeItems(data, [curve]), added: new Set<SketchConstraintId>() });
}

export function findCurve(data: SketchData, id: SketchEntityId): SketchCurve | null {
  const e = data.entities.find((x) => x.id === id);
  // An infinite line (M31) only cuts other curves: it has no ends to trim, extend or split.
  return e === undefined || e.kind === 'point' || e.kind === 'xline' ? null : e;
}

/** The points at the start and the end of the curve ([] for a circle). */
export function endIds(curve: SketchCurve): readonly SketchEntityId[] {
  switch (curve.kind) {
    case 'line':
      return [curve.p1, curve.p2];
    case 'arc':
      return [curve.start, curve.end];
    case 'circle':
    case 'xline':
      return [];
    case 'bspline':
      return firstAndLast(curve.poles);
    case 'fitSpline':
      return firstAndLast(curve.fit);
    default:
      return assertNever(curve);
  }
}

function firstAndLast(ids: readonly SketchEntityId[]): readonly SketchEntityId[] {
  const first = ids[0];
  const last = ids.at(-1);
  return first === undefined || last === undefined ? [] : [first, last];
}

/** The end point of the curve lying at p, or null. */
function endAt(
  curve: SketchCurve,
  p: Vec2,
  points: ReadonlyMap<SketchEntityId, SketchPoint>,
): SketchEntityId | null {
  return endIds(curve).find((id) => samePoint(coordinatesOf(points, id), p)) ?? null;
}

export function coordinatesOf(
  points: ReadonlyMap<SketchEntityId, SketchPoint>,
  id: SketchEntityId,
): Vec2 {
  const p = points.get(id);
  assert(p !== undefined, `trim: missing point '${id}'`);
  return [p.x, p.y];
}

/** The degree of a sketch spline with n poles: min(3, n − 1). */
function splineDegree(n: number): 1 | 2 | 3 {
  const degree = Math.min(3, n - 1);
  if (degree === 1 || degree === 2 || degree === 3) return degree;
  throw new Error(`trim: a spline piece needs at least 2 poles, got ${String(n)}`);
}
