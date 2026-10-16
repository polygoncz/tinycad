import type { Geom2d_Curve, Geom2dAPI_InterCurveCurve } from 'replicad-opencascadejs';
import type { Vec2 } from '@/core';
import { createKernelError, type FilletArc, type FilletArcInput } from '@/kernel';
import { sharesPiece, touchingPoint } from './curves';
import { circleCurve, coordinatesOf, dist } from './geom2d';
import type { Occt } from './occt';
import { isWasmTrap } from './wasm-trap';

// filletArc of the OCCT adapter (spec 06 "Stav po M34"): the possible centers are the
// intersections (Geom2dAPI_InterCurveCurve) of the Geom2d_OffsetCurve of both carriers at
// ±radius, the one nearest `near` wins; the touching points and their parameters come from
// Geom2dAPI_ProjectPointOnCurve on the carriers, converted to t of spec 12. Internal to
// kernel-occt; the input is already checked (parseFilletArcInput).

/** Precision::Confusion: the tolerance of the intersections, times the scale. */
const CONFUSION = 1e-7;
/**
 * The carrier of a line is a Geom2d_Line trimmed to ± this · the scale around its `from`:
 * InterCurveCurve throws on the offset of an unbounded line. A center farther away (lines
 * nearly parallel) is not found.
 */
const LINE_REACH = 1e6;

const TURN = 2 * Math.PI;

type FilletCurve = FilletArcInput['a'];

/**
 * The fillet center of the checked input nearest `near`, with the touching points and their t
 * (spec 12); 'operation-failed' when there is none. Every OCCT object made here is deleted
 * before it returns.
 */
export function filletArcOf(oc: Occt, { a, b, radius, near }: FilletArcInput): FilletArc {
  const scale = Math.max(1, radius, ...[a, b].flatMap(coordinatesOf).map(Math.abs));
  const tol = CONFUSION * scale;
  const owned: Geom2d_Curve[] = [];
  const own = <T extends Geom2d_Curve>(g: T): T => {
    owned.push(g);
    return g;
  };
  try {
    const carrierA = own(carrierOf(oc, a, LINE_REACH * scale));
    const carrierB = own(carrierOf(oc, b, LINE_REACH * scale));
    const offsetsA = offsetsOf(a, radius, tol).map((d) =>
      own(new oc.Geom2d_OffsetCurve(carrierA, d, true)),
    );
    const offsetsB = offsetsOf(b, radius, tol).map((d) =>
      own(new oc.Geom2d_OffsetCurve(carrierB, d, true)),
    );
    let center: Vec2 | undefined;
    for (const oa of offsetsA) {
      for (const ob of offsetsB) {
        for (const c of commonPoints(oc, oa, ob, near, tol)) {
          if (center === undefined || dist(c, near) < dist(center, near)) center = c;
        }
      }
    }
    if (center === undefined) {
      throw createKernelError('operation-failed', 'filletArc: no center at that radius');
    }
    const [pointA, ta] = projection(oc, a, carrierA, center);
    const [pointB, tb] = projection(oc, b, carrierB, center);
    return { center, pointA, pointB, ta, tb };
  } finally {
    for (const g of owned) g.delete();
  }
}

/**
 * New carrier of a curve: a line as a Geom2d_Line through `from` along it (parameter = distance
 * from `from`), trimmed to ±reach; an arc as its whole counter-clockwise Geom2d_Circle
 * (parameter = angle from +x). The caller owns it.
 */
function carrierOf(oc: Occt, c: FilletCurve, reach: number): Geom2d_Curve {
  if (c.kind === 'arc') {
    return circleCurve(oc, { kind: 'circle', center: c.center, radius: dist(c.center, c.from) });
  }
  const length = dist(c.from, c.to);
  using from = new oc.gp_Pnt2d(c.from[0], c.from[1]);
  using direction = new oc.gp_Dir2d((c.to[0] - c.from[0]) / length, (c.to[1] - c.from[1]) / length);
  using line = new oc.Geom2d_Line(from, direction);
  return new oc.Geom2d_TrimmedCurve(line, -reach, reach, true, true);
}

/** The offset distances ±radius; a circle shrunk to (nearly) its center is left out. */
function offsetsOf(c: FilletCurve, radius: number, tol: number): readonly number[] {
  if (c.kind === 'line') return [radius, -radius];
  return Math.abs(dist(c.center, c.from) - radius) > tol ? [radius, -radius] : [radius];
}

/**
 * The common points of two offset curves: their crossing points; of a piece InterCurveCurve
 * reports as shared, the point nearest `near` when the curves coincide there, otherwise the
 * touching point (a tangency, as in curves.ts).
 */
function commonPoints(
  oc: Occt,
  a: Geom2d_Curve,
  b: Geom2d_Curve,
  near: Vec2,
  tol: number,
): readonly Vec2[] {
  using inter = new oc.Geom2dAPI_InterCurveCurve(a, b, tol);
  const points: Vec2[] = [];
  for (let k = 1; k <= inter.NbPoints(); k++) {
    using p = inter.Point(k);
    points.push([p.X(), p.Y()]);
  }
  for (let k = 1; k <= inter.NbSegments(); k++) {
    const piece = sharedPiece(inter, k);
    if (piece === undefined) {
      // The whole of a closed curve: coincident circles.
      points.push(nearestOn(oc, a, near));
      continue;
    }
    using segment = piece;
    points.push(
      sharesPiece(oc, segment.Curve1, b, tol)
        ? nearestOn(oc, segment.Curve1, near)
        : touchingPoint(oc, segment.Curve1, b),
    );
  }
  return points;
}

/**
 * The k-th shared piece of InterCurveCurve, or undefined when it is a whole closed curve:
 * Segment then cannot trim it (Standard_ConstructionError "U1 == U2").
 */
function sharedPiece(
  inter: Geom2dAPI_InterCurveCurve,
  k: number,
): ReturnType<Geom2dAPI_InterCurveCurve['Segment']> | undefined {
  try {
    return inter.Segment(k);
  } catch (e) {
    // A trap leaves the module unusable: never swallow it (spec 06, Chyby).
    if (isWasmTrap(e)) throw e;
    return undefined;
  }
}

/** The point of the bounded curve `g` nearest `p`: the projections and both ends. */
function nearestOn(oc: Occt, g: Geom2d_Curve, p: Vec2): Vec2 {
  using target = new oc.gp_Pnt2d(p[0], p[1]);
  const found: Vec2[] = [];
  using projection = new oc.Geom2dAPI_ProjectPointOnCurve(target, g);
  for (let i = 1; i <= projection.NbPoints(); i++) {
    using q = projection.Point(i);
    found.push([q.X(), q.Y()]);
  }
  for (const u of [g.FirstParameter(), g.LastParameter()]) {
    using q = g.Value(u);
    found.push([q.X(), q.Y()]);
  }
  let best = found[0] ?? p;
  for (const q of found) if (dist(q, p) < dist(best, p)) best = q;
  return best;
}

/**
 * The projection of `center` on the carrier of `c` and its t (spec 12): a line [0, 1] from
 * `from` to `to`, also outside; an arc the angle from `from` in its direction, in [0, 2π) also
 * beyond its end.
 */
function projection(
  oc: Occt,
  c: FilletCurve,
  carrier: Geom2d_Curve,
  center: Vec2,
): readonly [Vec2, number] {
  using p = new oc.gp_Pnt2d(center[0], center[1]);
  using projected = new oc.Geom2dAPI_ProjectPointOnCurve(p, carrier);
  if (projected.NbPoints() === 0) {
    throw createKernelError('operation-failed', 'filletArc: the center does not project');
  }
  using nearest = projected.NearestPoint();
  const u = projected.LowerDistanceParameter();
  const point: Vec2 = [nearest.X(), nearest.Y()];
  if (c.kind === 'line') return [point, u / dist(c.from, c.to)];
  const a0 = Math.atan2(c.from[1] - c.center[1], c.from[0] - c.center[0]);
  const t = (((c.ccw ? u - a0 : a0 - u) % TURN) + TURN) % TURN;
  return [point, t >= TURN ? 0 : t];
}
