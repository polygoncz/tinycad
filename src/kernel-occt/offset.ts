import type {
  BRepOffsetAPI_MakeOffset,
  Geom2d_BSplineCurve,
  TopoDS_Face,
  TopoDS_Shape,
} from 'replicad-opencascadejs';
import { bspline, type Plane, type Vec2, vec2 } from '@/core';
import {
  createKernelError,
  kernelErrorCode,
  type IdentifiedCurve,
  type OffsetCurve,
  type OffsetCurvesInput,
} from '@/kernel';
import { wireOf, type IdEdge } from './face';
import { coordinatesOf, splineCurve } from './geom2d';
import { mapSubShapes, type Occt } from './occt';
import { indexOfSame } from './shape-entry';

const { dist } = vec2;

// offsetCurves of the OCCT adapter (spec 06 "Stav po M35", prototype in M35): the chain as a
// wire on its own planar face (BRepBuilderAPI_MakeFace(gp_Pln, wire, true): from the wire alone
// even a single line fails), BRepOffsetAPI_MakeOffset with GeomAbs_Intersection (sharp corners)
// and isOpenResult = !closed. Its edges come in no particular order and orientation, so they are
// chained here by their ends and turned along the input; `source` comes from Generated of the
// input edges. Lines and circles stay exact; the pieces of a spline offset (Geom_OffsetCurve)
// are sampled, merged and fitted by Geom2dAPI_PointsToBSpline of degree 3. Where sharp corners
// next to a spline fail, the corners are round (GeomAbs_Arc). Internal to
// kernel-occt; the input is already checked (parseOffsetCurvesInput).

/** The sketch plane: sketch coordinates are the x, y of the world (z = 0). */
const SKETCH_PLANE: Plane = { origin: [0, 0, 0], xDir: [1, 0, 0], normal: [0, 0, 1] };
/** Ends of two output edges within this · the scale are one vertex of the offset. */
const JOIN_TOLERANCE = 1e-6;
/** Spec 06: a fitted spline keeps within this · the scale from the exact offset. */
const SPLINE_TOLERANCE = 1e-4;
/** The samples of each spline piece start at this count and double while the fit is too far… */
const FIRST_SAMPLES = 16;
/** …up to this count; still too far, the offset fails. */
const MAX_SAMPLES = 1024;

const TURN = 2 * Math.PI;

/**
 * An output edge as data, oriented as its own curve (not yet along the chain). A piece that is
 * neither a line nor a circle (the offset of a spline, a Geom_OffsetCurve) is `sampled`:
 * `sample(n)` evaluates n + 1 points from its `from` to its `to`.
 */
type Piece = { readonly source?: string } & (
  | { readonly kind: 'line'; readonly from: Vec2; readonly to: Vec2 }
  | {
      readonly kind: 'arc';
      readonly center: Vec2;
      readonly from: Vec2;
      readonly to: Vec2;
      readonly ccw: boolean;
    }
  | { readonly kind: 'circle'; readonly center: Vec2; readonly radius: number }
  | {
      readonly kind: 'sampled';
      readonly from: Vec2;
      readonly to: Vec2;
      readonly sample: (n: number) => readonly Vec2[];
    }
);

type OpenPiece = Exclude<Piece, { kind: 'circle' }>;
type Sampled = Extract<Piece, { kind: 'sampled' }>;

/**
 * The offset of the checked chain (spec 06 "Stav po M35"): the curves along the chain, joined,
 * a closed one starting with the offset of its first curve; 'operation-failed' when OCCT cannot
 * offset it or the result is not one chain. Every OCCT object made here is deleted before it
 * returns.
 */
export function offsetCurvesOf(oc: Occt, input: OffsetCurvesInput): readonly OffsetCurve[] {
  const { curves, closed, distance } = input;
  const scale = Math.max(1, Math.abs(distance), ...curves.flatMap(coordinatesOf).map(Math.abs));
  // A closed chain: OCCT takes > 0 outwards whatever its orientation.
  if (closed) return offsetOnce(oc, input, distance, scale);
  // An open one: OCCT takes the right side of its wire, which runs against the chain when it
  // starts with a clockwise arc (its edge runs counter-clockwise, face.ts), and a single arc it
  // offsets towards its center for > 0 either way. So the side is checked on the result, and
  // the other sign tried when it is wrong (or failed: it may have been the wrong side).
  const attempt = (d: number): readonly OffsetCurve[] | Error => {
    try {
      return offsetOnce(oc, input, d, scale);
    } catch (e) {
      if (e instanceof Error && kernelErrorCode(e) === 'operation-failed') return e;
      throw e;
    }
  };
  const wanted = distance > 0;
  const first = attempt(distance);
  if (!(first instanceof Error) && onRight(oc, first, curves) === wanted) return first;
  const second = attempt(-distance);
  if (!(second instanceof Error) && onRight(oc, second, curves) === wanted) return second;
  if (first instanceof Error) throw first;
  throw second instanceof Error ? second : failure('the offset has no side');
}

/**
 * The offset by `distance` as OCCT takes it (its sign not yet checked): sharp corners; when
 * those fail next to a spline, round corners (GeomAbs_Arc, a join without source; M35 decision).
 */
function offsetOnce(
  oc: Occt,
  input: OffsetCurvesInput,
  distance: number,
  scale: number,
): readonly OffsetCurve[] {
  const { Intersection, Arc } = JOINS;
  if (!input.curves.some((c) => c.kind === 'bspline')) {
    return offsetWith(oc, input, distance, scale, Intersection);
  }
  try {
    return offsetWith(oc, input, distance, scale, Intersection);
  } catch (e) {
    if (!(e instanceof Error && kernelErrorCode(e) === 'operation-failed')) throw e;
    return offsetWith(oc, input, distance, scale, Arc);
  }
}

const JOINS = { Intersection: 'GeomAbs_Intersection', Arc: 'GeomAbs_Arc' } as const;
type Join = (typeof JOINS)[keyof typeof JOINS];

/** The offset with the given corners (`Intersection` checked against `Arc` next to a spline). */
function offsetWith(
  oc: Occt,
  { curves, closed }: OffsetCurvesInput,
  distance: number,
  scale: number,
  join: Join,
): readonly OffsetCurve[] {
  const inputs: IdEdge[] = [];
  let outputs: readonly TopoDS_Shape[] = [];
  try {
    using wire = wireOf(oc, SKETCH_PLANE, curves, inputs);
    using origin = new oc.gp_Pnt(0, 0, 0);
    using normal = new oc.gp_Dir(0, 0, 1);
    using pln = new oc.gp_Pln(origin, normal);
    using faceMaker = new oc.BRepBuilderAPI_MakeFace(pln, wire, true);
    if (!faceMaker.IsDone()) throw failure('the chain gives no face');
    using face = faceMaker.Face();
    // A closed chain with isOpenResult = true gives half of the edges (prototype M35).
    using maker = new oc.BRepOffsetAPI_MakeOffset(face, oc.GeomAbs_JoinType[join], !closed);
    maker.Perform(distance, 0);
    if (!maker.IsDone()) throw failure('OCCT cannot offset the chain');
    using shape = maker.Shape();
    outputs = mapSubShapes(oc, shape, oc.TopAbs_ShapeEnum.TopAbs_EDGE);
    if (outputs.length === 0) throw failure('nothing is left of the chain');
    const sources = sourcesOf(maker, inputs, outputs);
    if (join === JOINS.Intersection && curves.some((c) => c.kind === 'bspline')) {
      // GeomAbs_Intersection cannot extend the offset of a spline into a sharp corner: it drops
      // curves (and returns IsDone) instead. With GeomAbs_Arc no curve vanishes that a sharp
      // corner would keep, so a curve missing here but kept there means a broken result.
      const kept = new Set(sources.values());
      const reference = arcJoinSources(oc, face, inputs, closed, distance);
      if ([...reference].some((id) => !kept.has(id))) {
        throw failure('OCCT cannot make a sharp corner next to the offset of a spline');
      }
    }
    const pieces = outputs.map((e, i) => pieceOf(oc, e, sources.get(i)));
    const [only] = pieces;
    if (only?.kind === 'circle') {
      if (pieces.length > 1) throw failure('the offset is not one chain');
      return [{ kind: 'circle', center: only.center, radius: only.radius, ...sourceOf(only) }];
    }
    const open = pieces.filter((p): p is OpenPiece => p.kind !== 'circle');
    if (open.length !== pieces.length) throw failure('the offset is not one chain');
    const chain = alongInput(oc, chained(open, closed, JOIN_TOLERANCE * scale), curves);
    return curvesOf(oc, closed ? fromFirst(chain, curves) : chain, closed, scale);
  } finally {
    for (const { edge } of inputs) edge.delete();
    for (const s of outputs) s.delete();
  }
}

/** The ids of the input curves kept by the offset with round corners (none when it fails). */
function arcJoinSources(
  oc: Occt,
  face: TopoDS_Face,
  inputs: readonly IdEdge[],
  closed: boolean,
  distance: number,
): ReadonlySet<string> {
  using maker = new oc.BRepOffsetAPI_MakeOffset(face, oc.GeomAbs_JoinType.GeomAbs_Arc, !closed);
  maker.Perform(distance, 0);
  if (!maker.IsDone()) return new Set();
  using shape = maker.Shape();
  const outputs = mapSubShapes(oc, shape, oc.TopAbs_ShapeEnum.TopAbs_EDGE);
  try {
    return new Set(sourcesOf(maker, inputs, outputs).values());
  } finally {
    for (const s of outputs) s.delete();
  }
}

/** Output edge index → id of the input edge that Generated it (an edge of a join has none). */
function sourcesOf(
  maker: BRepOffsetAPI_MakeOffset,
  inputs: readonly IdEdge[],
  outputs: readonly TopoDS_Shape[],
): ReadonlyMap<number, string> {
  const sources = new Map<number, string>();
  for (const { edge, id } of inputs) {
    using list = maker.Generated(edge);
    while (!list.IsEmpty()) {
      using item = list.First();
      list.RemoveFirst();
      const index = indexOfSame(outputs, item);
      if (index >= 0) sources.set(index, id);
    }
  }
  return sources;
}

/** The output edge as a piece: a line, an arc or a circle exactly, anything else sampled. */
function pieceOf(oc: Occt, shape: TopoDS_Shape, source: string | undefined): Piece {
  const tag = source === undefined ? {} : { source };
  using edge = oc.TopoDS.Edge(shape);
  using curve = new oc.BRepAdaptor_Curve(edge);
  const u0 = curve.FirstParameter();
  const u1 = curve.LastParameter();
  const at = (u: number): Vec2 => {
    using p = curve.Value(u);
    return [p.X(), p.Y()];
  };
  const from = at(u0);
  const to = at(u1);
  switch (curve.GetType()) {
    case oc.GeomAbs_CurveType.GeomAbs_Line:
      return { kind: 'line', from, to, ...tag };
    case oc.GeomAbs_CurveType.GeomAbs_Circle: {
      using circle = curve.Circle();
      using location = circle.Location();
      using axis = circle.Axis();
      using direction = axis.Direction();
      const center: Vec2 = [location.X(), location.Y()];
      if (u1 - u0 >= TURN - 1e-9) {
        return { kind: 'circle', center, radius: circle.Radius(), ...tag };
      }
      // The circle runs counter-clockwise about its axis; the axis may point down.
      return { kind: 'arc', center, from, to, ccw: direction.Z() > 0, ...tag };
    }
    default: {
      const sample = (n: number): readonly Vec2[] => {
        using again = oc.TopoDS.Edge(shape);
        using adaptor = new oc.BRepAdaptor_Curve(again);
        return Array.from({ length: n + 1 }, (_, k) => {
          using p = adaptor.Value(u0 + ((u1 - u0) * k) / n);
          return [p.X(), p.Y()];
        });
      };
      return { kind: 'sampled', from, to, sample, ...tag };
    }
  }
}

/**
 * The pieces in one chain by their ends, each oriented along it: an open chain from a piece
 * with a free end. The direction of the chain is still arbitrary. Pieces left over (the offset
 * fell apart into several wires) fail.
 */
function chained(pieces: readonly OpenPiece[], closed: boolean, tol: number): OpenPiece[] {
  const left = [...pieces];
  const touches = (p: Vec2, self: OpenPiece): boolean =>
    left.some((q) => q !== self && (dist(p, q.from) <= tol || dist(p, q.to) <= tol));
  let first: OpenPiece | undefined;
  if (!closed) {
    for (const p of left) {
      if (!touches(p.from, p)) first = p;
      else if (!touches(p.to, p)) first = reversed(p);
      if (first !== undefined) {
        left.splice(left.indexOf(p), 1);
        break;
      }
    }
  }
  first ??= left.shift();
  if (first === undefined) throw failure('nothing is left of the chain');
  const chain = [first];
  for (;;) {
    const tail = chain[chain.length - 1]?.to ?? first.to;
    const next = left.findIndex((q) => dist(tail, q.from) <= tol || dist(tail, q.to) <= tol);
    if (next < 0) break;
    const [q] = left.splice(next, 1);
    if (q !== undefined) chain.push(dist(tail, q.from) <= tol ? q : reversed(q));
  }
  if (left.length > 0) throw failure('the offset is not one chain');
  const end = chain[chain.length - 1]?.to ?? first.to;
  if (closed && dist(end, first.from) > tol) throw failure('the offset of a closed chain is open');
  return chain;
}

/** The chain turned to run as the input does: a piece with a source runs along its curve. */
function alongInput(
  oc: Occt,
  chain: readonly OpenPiece[],
  curves: readonly IdentifiedCurve[],
): OpenPiece[] {
  for (const piece of chain) {
    const curve = curves.find((c) => c.id === piece.source);
    if (curve === undefined) continue;
    const [m, tangent] = middleOf(piece);
    const along = tangentOf(oc, curve, m);
    return along[0] * tangent[0] + along[1] * tangent[1] >= 0
      ? [...chain]
      : [...chain].reverse().map(reversed);
  }
  return [...chain];
}

/**
 * A closed chain started with the first piece of the earliest input curve (after a piece of
 * another curve, so that the pieces of one spline stay together).
 */
function fromFirst(chain: readonly OpenPiece[], curves: readonly IdentifiedCurve[]): OpenPiece[] {
  const rank = (p: OpenPiece | undefined): number => {
    const i = curves.findIndex((c) => c.id === p?.source);
    return i < 0 ? curves.length : i;
  };
  let start: number | undefined;
  chain.forEach((p, i) => {
    const opens = chain[(i + chain.length - 1) % chain.length]?.source !== p.source;
    if (opens && (start === undefined || rank(p) < rank(chain[start]))) start = i;
  });
  // No piece opens a curve: the whole chain is the offset of one closed spline.
  start ??= 0;
  return [...chain.slice(start), ...chain.slice(0, start)];
}

/**
 * The curves of the chain: each piece joined exactly to the previous one (its start is the end
 * of the previous, the first of a closed chain the end of the last), the sampled pieces of one
 * spline merged into one fitted cubic B-spline.
 */
function curvesOf(
  oc: Occt,
  chain: readonly OpenPiece[],
  closed: boolean,
  scale: number,
): OffsetCurve[] {
  const groups: OpenPiece[][] = [];
  for (const p of chain) {
    const last = groups[groups.length - 1];
    const previous = last?.[last.length - 1];
    if (
      last !== undefined &&
      p.kind === 'sampled' &&
      previous?.kind === 'sampled' &&
      p.source !== undefined &&
      previous.source === p.source
    ) {
      last.push(p);
    } else {
      groups.push([p]);
    }
  }
  const ends = groups.map((g): Vec2 | undefined => g[g.length - 1]?.to);
  return groups.map((group, i): OffsetCurve => {
    const [head] = group;
    if (head === undefined) throw failure('an empty piece of the chain');
    const previous = i > 0 ? ends[i - 1] : closed ? ends[ends.length - 1] : undefined;
    const from = previous ?? head.from;
    const to = ends[i] ?? head.to;
    const tag = sourceOf(head);
    switch (head.kind) {
      case 'line':
        return { kind: 'line', from, to, ...tag };
      case 'arc':
        return { kind: 'arc', center: head.center, from, to, ccw: head.ccw, ...tag };
      case 'sampled':
        return {
          ...fitted(oc, group.filter(isSampled), from, to, SPLINE_TOLERANCE * scale),
          ...tag,
        };
    }
  });
}

/**
 * A cubic B-spline through the samples of the pieces (Geom2dAPI_PointsToBSpline, degree 3,
 * C2), with `from` and `to` as its end poles and its knots in [0, 1]. The samples double until
 * the curve keeps within `tol` of the points halfway between them.
 */
function fitted(
  oc: Occt,
  pieces: readonly Sampled[],
  from: Vec2,
  to: Vec2,
  tol: number,
): Extract<OffsetCurve, { kind: 'bspline' }> {
  for (let n = FIRST_SAMPLES; n <= MAX_SAMPLES; n *= 2) {
    const points = pieces.flatMap((p, i) => p.sample(n).slice(i === 0 ? 0 : 1));
    const halfway = pieces.flatMap((p) => p.sample(2 * n).filter((_, k) => k % 2 === 1));
    using array = new oc.NCollection_Array1_gp_Pnt2d(points.length);
    points.forEach((q, k) => {
      using p = new oc.gp_Pnt2d(q[0], q[1]);
      array.SetValue(k, p);
    });
    using fit = new oc.Geom2dAPI_PointsToBSpline();
    fit.Init(array, 3, 3, oc.GeomAbs_Shape.GeomAbs_C2, tol / 2);
    if (!fit.IsDone()) continue;
    using curve = fit.Curve();
    if (curve.Degree() !== 3)
      throw failure(`the fitted spline is not cubic: ${String(curve.Degree())}`);
    if (halfway.every((q) => distanceTo(oc, curve, q) <= tol)) return splineOf(curve, from, to);
  }
  throw failure('the offset of a spline does not fit a cubic B-spline');
}

/** The distance of `q` from the curve: its projections and both ends. */
function distanceTo(oc: Occt, curve: Geom2d_BSplineCurve, q: Vec2): number {
  using p = new oc.gp_Pnt2d(q[0], q[1]);
  using projection = new oc.Geom2dAPI_ProjectPointOnCurve(p, curve);
  let best = Number.POSITIVE_INFINITY;
  for (let i = 1; i <= projection.NbPoints(); i++) best = Math.min(best, projection.Distance(i));
  for (const u of [curve.FirstParameter(), curve.LastParameter()]) {
    using end = curve.Value(u);
    best = Math.min(best, end.Distance(p));
  }
  return best;
}

/** The spline of a fitted curve: its end poles moved onto `from` and `to`, knots in [0, 1]. */
function splineOf(
  g: Geom2d_BSplineCurve,
  from: Vec2,
  to: Vec2,
): Extract<OffsetCurve, { kind: 'bspline' }> {
  using poleArray = g.Poles();
  using knotArray = g.Knots();
  using multArray = g.Multiplicities();
  const poles: Vec2[] = [];
  for (let i = poleArray.Lower(); i <= poleArray.Upper(); i++) {
    using pole = poleArray.Value(i);
    poles.push([pole.X(), pole.Y()]);
  }
  poles[0] = from;
  poles[poles.length - 1] = to;
  const lower = knotArray.Lower();
  const upper = knotArray.Upper();
  const k0 = knotArray.Value(lower);
  const k1 = knotArray.Value(upper);
  const knots: number[] = [];
  for (let i = lower; i <= upper; i++) {
    const k = i === lower ? 0 : i === upper ? 1 : (knotArray.Value(i) - k0) / (k1 - k0);
    for (let m = 0; m < multArray.Value(i); m++) knots.push(k);
  }
  return { kind: 'bspline', degree: g.Degree(), poles, knots };
}

/** A point in the middle of the piece and its direction there. */
function middleOf(piece: OpenPiece): readonly [Vec2, Vec2] {
  switch (piece.kind) {
    case 'line':
      return [
        [(piece.from[0] + piece.to[0]) / 2, (piece.from[1] + piece.to[1]) / 2],
        [piece.to[0] - piece.from[0], piece.to[1] - piece.from[1]],
      ];
    case 'arc': {
      const a0 = Math.atan2(piece.from[1] - piece.center[1], piece.from[0] - piece.center[0]);
      const a1 = Math.atan2(piece.to[1] - piece.center[1], piece.to[0] - piece.center[0]);
      const sweep = (((piece.ccw ? a1 - a0 : a0 - a1) % TURN) + TURN) % TURN || TURN;
      const angle = a0 + ((piece.ccw ? 1 : -1) * sweep) / 2;
      const r = dist(piece.center, piece.from);
      const m: Vec2 = [
        piece.center[0] + r * Math.cos(angle),
        piece.center[1] + r * Math.sin(angle),
      ];
      const sense = piece.ccw ? 1 : -1;
      return [m, [-sense * Math.sin(angle), sense * Math.cos(angle)]];
    }
    case 'sampled': {
      const [before, m, after] = piece.sample(8).slice(3, 6);
      if (before === undefined || m === undefined || after === undefined) {
        throw failure('a piece without samples');
      }
      return [m, [after[0] - before[0], after[1] - before[1]]];
    }
  }
}

/**
 * Whether the result lies to the right of the chain: the middle of its first curve with a
 * source against the direction of that input curve at its nearest point.
 */
function onRight(
  oc: Occt,
  result: readonly OffsetCurve[],
  curves: readonly IdentifiedCurve[],
): boolean {
  for (const r of result) {
    const curve = curves.find((c) => c.id === r.source);
    if (curve === undefined || r.kind === 'circle') continue;
    const m = middleOfCurve(r);
    const foot = footOf(oc, curve, m);
    const t = tangentOf(oc, curve, foot);
    return t[0] * (m[1] - foot[1]) - t[1] * (m[0] - foot[0]) < 0;
  }
  throw failure('the offset has no curve from the chain');
}

/** A point in the middle of an offset curve (a spline at the middle of its knots). */
function middleOfCurve(c: Exclude<OffsetCurve, { kind: 'circle' }>): Vec2 {
  switch (c.kind) {
    case 'line':
      return middleOf({ kind: 'line', from: c.from, to: c.to })[0];
    case 'arc':
      return middleOf({ kind: 'arc', center: c.center, from: c.from, to: c.to, ccw: c.ccw })[0];
    case 'bspline': {
      const first = c.knots[0] ?? 0;
      const last = c.knots[c.knots.length - 1] ?? 1;
      return bspline.evaluate(c, (first + last) / 2);
    }
  }
}

/** The point of the input curve nearest `m` (a line and an arc by their carriers). */
function footOf(oc: Occt, c: IdentifiedCurve, m: Vec2): Vec2 {
  switch (c.kind) {
    case 'line': {
      const d: Vec2 = [c.to[0] - c.from[0], c.to[1] - c.from[1]];
      const t = ((m[0] - c.from[0]) * d[0] + (m[1] - c.from[1]) * d[1]) / (d[0] ** 2 + d[1] ** 2);
      return [c.from[0] + t * d[0], c.from[1] + t * d[1]];
    }
    case 'arc':
    case 'circle': {
      const r = c.kind === 'arc' ? dist(c.center, c.from) : c.radius;
      const away = dist(c.center, m);
      return [
        c.center[0] + ((m[0] - c.center[0]) * r) / away,
        c.center[1] + ((m[1] - c.center[1]) * r) / away,
      ];
    }
    case 'bspline':
      return bspline.evaluate(c, projectedParameter(oc, c, m));
  }
}

/** The parameter of the point of the spline nearest `m`. */
function projectedParameter(
  oc: Occt,
  c: Extract<IdentifiedCurve, { kind: 'bspline' }>,
  m: Vec2,
): number {
  using g = splineCurve(oc, c);
  using p = new oc.gp_Pnt2d(m[0], m[1]);
  using projection = new oc.Geom2dAPI_ProjectPointOnCurve(p, g);
  if (projection.NbPoints() === 0) throw failure('a point does not project on the spline');
  return projection.LowerDistanceParameter();
}

/** The direction of the input curve at its point nearest `m`. */
function tangentOf(oc: Occt, c: IdentifiedCurve, m: Vec2): Vec2 {
  switch (c.kind) {
    case 'line':
      return [c.to[0] - c.from[0], c.to[1] - c.from[1]];
    case 'arc':
    case 'circle': {
      const sense = c.kind === 'arc' && !c.ccw ? -1 : 1;
      return [-sense * (m[1] - c.center[1]), sense * (m[0] - c.center[0])];
    }
    case 'bspline':
      return bspline.derivative(c, projectedParameter(oc, c, m));
  }
}

function reversed(p: OpenPiece): OpenPiece {
  switch (p.kind) {
    case 'line':
      return { ...p, from: p.to, to: p.from };
    case 'arc':
      return { ...p, from: p.to, to: p.from, ccw: !p.ccw };
    case 'sampled':
      return { ...p, from: p.to, to: p.from, sample: (n) => [...p.sample(n)].reverse() };
  }
}

function isSampled(p: OpenPiece): p is Sampled {
  return p.kind === 'sampled';
}

function sourceOf(p: Piece): { readonly source?: string } {
  return p.source === undefined ? {} : { source: p.source };
}

function failure(reason: string): Error {
  return createKernelError('operation-failed', `offsetCurves: ${reason}`);
}
