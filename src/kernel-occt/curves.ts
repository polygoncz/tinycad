import type { Geom2d_Curve, gp_Pnt2d } from 'replicad-opencascadejs';
import type { Vec2 } from '@/core';
import type { CurveIntersection, CurveSegmentInput, IdentifiedCurve, ProfileCurve } from '@/kernel';
import {
  boundedCurve,
  boxOf,
  circleCurve,
  coordinatesOf,
  counterClockwise,
  overlappingPairs,
  splineCurve,
} from './geom2d';
import type { Occt } from './occt';

// curveIntersections and curveSegment of the OCCT adapter (spec 06 "Stav po M33", spec 12
// "Port a parametr křivky"). Intersections from Geom2dAPI_InterCurveCurve over the pairs whose
// bounding boxes overlap (as the regions) and over each spline with itself; it gives no
// parameters, so Geom2dAPI_ProjectPointOnCurve finds them, converted to t of spec 12. Pieces of
// lines and arcs from the formulas, of a spline by Geom2d_BSplineCurve.Segment. Internal to
// kernel-occt; the inputs are already checked (parseProfileRegionsInput,
// parseCurveSegmentInput).

/** Precision::Confusion: the tolerance of the intersections, times the scale. */
const CONFUSION = 1e-7;
/** Spec 06: two points coincide within this · max(1, |coordinate|), per coordinate. */
const POINT_TOLERANCE = 1e-7;
/**
 * A spline passes through its own intersection point at every parameter whose projection is
 * nearer than this many tolerances (near tangencies lose precision).
 */
const SELF_MATCH_FACTOR = 1e3;
/** Two parameters of a self-intersection closer than this part of the range are one. */
const SELF_PARAM_GAP = 1e-6;

/**
 * A piece InterCurveCurve reports as shared is one when the curves are closer than this many
 * tolerances inside it; otherwise it is a tangency (see sharesPiece).
 */
const OVERLAP_GAP = 1e-2;
/** Steps of the golden-section search for a touching point: shrinks the piece by 0.618⁶⁰ ≈ 3e-13. */
const GOLDEN_STEPS = 60;

const TURN = 2 * Math.PI;

/** A curve of the call with its OCCT curve (an arc built counter-clockwise). */
interface Entry {
  readonly curve: IdentifiedCurve;
  readonly g: Geom2d_Curve;
}

/** A common point found for a pair, with the parameters t (spec 12) on both curves. */
interface Hit {
  readonly point: Vec2;
  readonly ta: number;
  readonly tb: number;
  readonly overlap: boolean;
}

/**
 * Every common point of each pair of `curves` (checked: ids present and unique, no curve of zero
 * length) and of each spline with itself, ordered by a, b, ta. Every OCCT object made here is
 * deleted before it returns.
 */
export function curveIntersectionsOf(
  oc: Occt,
  curves: readonly IdentifiedCurve[],
): readonly CurveIntersection[] {
  const scale = Math.max(1, ...curves.flatMap(coordinatesOf).map(Math.abs));
  const tol = CONFUSION * scale;
  const entries: Entry[] = [];
  try {
    for (const curve of curves) {
      const ccw = counterClockwise(curve);
      entries.push({
        curve,
        g: ccw.kind === 'circle' ? circleCurve(oc, ccw) : boundedCurve(oc, ccw),
      });
    }
    const out: CurveIntersection[][] = entries.map(() => []);
    entries.forEach((e, i) => {
      if (e.curve.kind === 'bspline') out[i]?.push(...finish(e, e, selfHits(oc, e, tol)));
    });
    const pairs = [...overlappingPairs(curves.map((c) => boxOf(c, tol)))].sort(
      (p, q) => p[0] - q[0] || p[1] - q[1],
    );
    for (const [i, j] of pairs) {
      const a = entries[i];
      const b = entries[j];
      if (a !== undefined && b !== undefined)
        out[i]?.push(...finish(a, b, pairHits(oc, a, b, tol)));
    }
    return Object.freeze(out.flat());
  } finally {
    for (const e of entries) e.g.delete();
  }
}

/**
 * The piece of the checked curve between from < to: a line or an arc of the same kind and
 * direction from the formulas, a circle as a counter-clockwise arc, a spline by
 * Geom2d_BSplineCurve.Segment with its knots rescaled to [0, 1]. The id of the input stays.
 */
export function curveSegmentOf(oc: Occt, { curve, from, to }: CurveSegmentInput): ProfileCurve {
  const id = curve.id === undefined ? {} : { id: curve.id };
  switch (curve.kind) {
    case 'line': {
      const at = (t: number): Vec2 =>
        t === 0
          ? curve.from
          : t === 1
            ? curve.to
            : [
                curve.from[0] + (curve.to[0] - curve.from[0]) * t,
                curve.from[1] + (curve.to[1] - curve.from[1]) * t,
              ];
      return { kind: 'line', from: at(from), to: at(to), ...id };
    }
    case 'arc': {
      const r = Math.hypot(curve.from[0] - curve.center[0], curve.from[1] - curve.center[1]);
      const a0 = angleAround(curve.center, curve.from);
      const sweep = arcSweep(curve);
      const sign = curve.ccw ? 1 : -1;
      const at = (t: number): Vec2 =>
        t === 0 ? curve.from : t === sweep ? curve.to : onCircle(curve.center, r, a0 + sign * t);
      return {
        kind: 'arc',
        center: curve.center,
        from: at(from),
        to: at(to),
        ccw: curve.ccw,
        ...id,
      };
    }
    case 'circle':
      return {
        kind: 'arc',
        center: curve.center,
        from: onCircle(curve.center, curve.radius, from),
        to: onCircle(curve.center, curve.radius, to),
        ccw: true,
        ...id,
      };
    case 'bspline': {
      const g = splineCurve(oc, curve);
      try {
        g.Segment(from, to);
        return { ...splineOf(g, from, to), ...id };
      } finally {
        g.delete();
      }
    }
  }
}

// --- Intersections ----------------------------------------------------------------------------

/** Points of two different curves: crossing points, and both ends of each shared piece. */
function pairHits(oc: Occt, a: Entry, b: Entry, tol: number): readonly Hit[] {
  using inter = new oc.Geom2dAPI_InterCurveCurve(a.g, b.g, tol);
  const points: { readonly point: Vec2; readonly overlap: boolean }[] = [];
  for (let k = 1; k <= inter.NbPoints(); k++) {
    using p = inter.Point(k);
    points.push({ point: [p.X(), p.Y()], overlap: false });
  }
  for (let k = 1; k <= inter.NbSegments(); k++) {
    // The piece on the first curve; its ends are the ends of the shared piece.
    using segment = inter.Segment(k);
    const piece = segment.Curve1;
    const first = piece.FirstParameter();
    const last = piece.LastParameter();
    if (!sharesPiece(oc, piece, b.g, tol)) {
      // A tangency: the curves stay within the tolerance near the touching point only.
      points.push({ point: touchingPoint(oc, piece, b.g), overlap: false });
      continue;
    }
    using start = piece.Value(first);
    using end = piece.Value(last);
    points.push({ point: [start.X(), start.Y()], overlap: true });
    points.push({ point: [end.X(), end.Y()], overlap: true });
  }
  return points.map(({ point, overlap }) => {
    using p = new oc.gp_Pnt2d(point[0], point[1]);
    return {
      point,
      ta: paramOf(a, nearestParam(oc, a.g, p)),
      tb: paramOf(b, nearestParam(oc, b.g, p)),
      overlap,
    };
  });
}

/**
 * Whether a piece InterCurveCurve reports as shared really lies on the other curve: the gap at
 * its quarter points is far below the tolerance. Curves touching tangentially are reported as a
 * piece too, but their gap grows quadratically to the tolerance at its ends (a quarter of it at
 * the quarter points).
 */
export function sharesPiece(
  oc: Occt,
  piece: Geom2d_Curve,
  other: Geom2d_Curve,
  tol: number,
): boolean {
  const first = piece.FirstParameter();
  const last = piece.LastParameter();
  return [0.25, 0.5, 0.75].every((s) => {
    using p = piece.Value(first + (last - first) * s);
    using projection = new oc.Geom2dAPI_ProjectPointOnCurve(p, other);
    return projection.NbPoints() > 0 && projection.LowerDistance() <= OVERLAP_GAP * tol;
  });
}

/**
 * The point of a tangency piece nearest to the other curve (golden-section search over the
 * piece). A piece split at the seam of a circle ends at the touching point in both halves, so
 * both give the same point.
 */
export function touchingPoint(oc: Occt, piece: Geom2d_Curve, other: Geom2d_Curve): Vec2 {
  const gap = (u: number): number => {
    using p = piece.Value(u);
    using projection = new oc.Geom2dAPI_ProjectPointOnCurve(p, other);
    return projection.NbPoints() > 0 ? projection.LowerDistance() : Number.POSITIVE_INFINITY;
  };
  let lo = piece.FirstParameter();
  let hi = piece.LastParameter();
  const ratio = (Math.sqrt(5) - 1) / 2;
  for (let i = 0; i < GOLDEN_STEPS; i++) {
    const u1 = hi - ratio * (hi - lo);
    const u2 = lo + ratio * (hi - lo);
    if (gap(u1) <= gap(u2)) hi = u2;
    else lo = u1;
  }
  using p = piece.Value((lo + hi) / 2);
  return [p.X(), p.Y()];
}

/**
 * A spline crossing itself: each point of Geom2dAPI_InterCurveCurve with every pair of distinct
 * parameters through it (the node of a closed spline too: its first and last parameter).
 * Pieces running over themselves are not reported.
 */
function selfHits(oc: Occt, e: Entry, tol: number): readonly Hit[] {
  using inter = new oc.Geom2dAPI_InterCurveCurve(e.g, tol);
  const hits: Hit[] = [];
  for (let k = 1; k <= inter.NbPoints(); k++) {
    using p = inter.Point(k);
    const params = paramsThrough(oc, e.g, p, SELF_MATCH_FACTOR * tol);
    for (let i = 0; i < params.length; i++) {
      for (let j = i + 1; j < params.length; j++) {
        hits.push({
          point: [p.X(), p.Y()],
          ta: params[i] ?? Number.NaN,
          tb: params[j] ?? Number.NaN,
          overlap: false,
        });
      }
    }
  }
  return hits;
}

/**
 * The parameter of `g` nearest to `p`: the orthogonal projections and both ends of the curve
 * (a projection need not find an end, where the distance has no extremum).
 */
function nearestParam(oc: Occt, g: Geom2d_Curve, p: gp_Pnt2d): number {
  let best = { u: g.FirstParameter(), d: Number.POSITIVE_INFINITY };
  for (const c of candidates(oc, g, p)) if (c.d < best.d) best = c;
  return best.u;
}

/** All parameters of `g` passing within `within` of `p`, ascending, without near duplicates. */
function paramsThrough(oc: Occt, g: Geom2d_Curve, p: gp_Pnt2d, within: number): number[] {
  const range = g.LastParameter() - g.FirstParameter();
  const params = candidates(oc, g, p)
    .filter((c) => c.d <= within)
    .map((c) => c.u)
    .sort((x, y) => x - y);
  return params.filter((u, i) => i === 0 || u - (params[i - 1] ?? u) > SELF_PARAM_GAP * range);
}

/** Parameters of `g` near `p` with their distance: the projections and both ends. */
function candidates(
  oc: Occt,
  g: Geom2d_Curve,
  p: gp_Pnt2d,
): readonly { readonly u: number; readonly d: number }[] {
  const found: { u: number; d: number }[] = [];
  using projection = new oc.Geom2dAPI_ProjectPointOnCurve(p, g);
  for (let i = 1; i <= projection.NbPoints(); i++) {
    found.push({ u: projection.Parameter(i), d: projection.Distance(i) });
  }
  for (const u of [g.FirstParameter(), g.LastParameter()]) {
    using q = g.Value(u);
    found.push({ u, d: q.Distance(p) });
  }
  return found;
}

/**
 * The parameter t of spec 12 from the parameter u of the OCCT curve: a line (u from 0 to its
 * length) scaled to [0, 1]; an arc (built counter-clockwise) the angle from its `from`, so a
 * clockwise arc counts from the other end; a circle the angle in [0, 2π); a spline u itself.
 */
function paramOf(e: Entry, u: number): number {
  const first = e.g.FirstParameter();
  const last = e.g.LastParameter();
  const clamped = Math.min(Math.max(u, first), last);
  switch (e.curve.kind) {
    case 'line':
      return (clamped - first) / (last - first);
    case 'arc':
      return e.curve.ccw ? clamped - first : last - clamped;
    case 'circle': {
      const t = ((u % TURN) + TURN) % TURN;
      return t >= TURN ? 0 : t;
    }
    case 'bspline':
      return clamped;
  }
}

/**
 * The hits of a pair as CurveIntersection: points merged within the contract tolerance (an
 * overlap end wins), sorted by ta.
 */
function finish(a: Entry, b: Entry, hits: readonly Hit[]): readonly CurveIntersection[] {
  const merged: Hit[] = [];
  for (const h of hits) {
    const same = merged.findIndex((m) => samePoint(m.point, h.point));
    if (same === -1) merged.push(h);
    else if (h.overlap) merged[same] = { ...(merged[same] ?? h), overlap: true };
  }
  return merged
    .map((h): CurveIntersection => ({
      a: a.curve.id,
      b: b.curve.id,
      point: h.point,
      ta: h.ta,
      tb: h.tb,
      ...(h.overlap ? { overlap: true as const } : {}),
    }))
    .sort((x, y) => x.ta - y.ta);
}

// --- Pieces -----------------------------------------------------------------------------------

/** The spline of a segmented Geom2d_BSplineCurve with its knots rescaled from [from, to] to [0, 1]. */
function splineOf(
  g: ReturnType<typeof splineCurve>,
  from: number,
  to: number,
): Extract<ProfileCurve, { kind: 'bspline' }> {
  using poleArray = g.Poles();
  using knotArray = g.Knots();
  using multArray = g.Multiplicities();
  const poles: Vec2[] = [];
  for (let i = poleArray.Lower(); i <= poleArray.Upper(); i++) {
    using pole = poleArray.Value(i);
    poles.push([pole.X(), pole.Y()]);
  }
  const knots: number[] = [];
  const lower = knotArray.Lower();
  const upper = knotArray.Upper();
  for (let i = lower; i <= upper; i++) {
    const k = i === lower ? 0 : i === upper ? 1 : (knotArray.Value(i) - from) / (to - from);
    for (let m = 0; m < multArray.Value(i); m++) knots.push(k);
  }
  return { kind: 'bspline', degree: g.Degree(), poles, knots };
}

// --- Helpers ----------------------------------------------------------------------------------

function angleAround(center: Vec2, p: Vec2): number {
  return Math.atan2(p[1] - center[1], p[0] - center[0]);
}

/** The sweep of an arc in its own direction, (0, 2π). */
function arcSweep(c: Extract<ProfileCurve, { kind: 'arc' }>): number {
  const a0 = angleAround(c.center, c.from);
  const a1 = angleAround(c.center, c.to);
  const d = c.ccw ? a1 - a0 : a0 - a1;
  return ((d % TURN) + TURN) % TURN;
}

function onCircle(center: Vec2, r: number, angle: number): Vec2 {
  return [center[0] + r * Math.cos(angle), center[1] + r * Math.sin(angle)];
}

/** Spec 06: coordinates agree within POINT_TOLERANCE · max(1, |coordinate|). */
function samePoint(a: Vec2, b: Vec2): boolean {
  const near = (u: number, v: number): boolean =>
    Math.abs(u - v) <= POINT_TOLERANCE * Math.max(1, Math.abs(u), Math.abs(v));
  return near(a[0], b[0]) && near(a[1], b[1]);
}
