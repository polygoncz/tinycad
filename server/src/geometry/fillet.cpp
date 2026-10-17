// filletArc (port of src/kernel-occt/fillet.ts, spec 06 "Stav po M34"): the possible centers are
// the intersections (Geom2dAPI_InterCurveCurve) of the Geom2d_OffsetCurve of both carriers at
// ±radius, the one nearest `near` wins; the touching points and their parameters come from
// Geom2dAPI_ProjectPointOnCurve on the carriers, converted to t of spec 12.

#include <Geom2dAPI_InterCurveCurve.hxx>
#include <Geom2dAPI_ProjectPointOnCurve.hxx>
#include <Geom2d_Line.hxx>
#include <Geom2d_OffsetCurve.hxx>
#include <Geom2d_TrimmedCurve.hxx>
#include <Standard_Failure.hxx>
#include <gp_Dir2d.hxx>
#include <gp_Pnt2d.hxx>

#include <array>
#include <cmath>
#include <optional>

#include "tinycad/occt2d/curves.hpp"

#include "algorithms.hpp"
#include "failure.hpp"
#include "touching.hpp"

namespace tinycad::geometry::detail {

using occt2d::circleCurve;
using occt2d::dist;
using occt2d::Kind;
using occt2d::kTurn;
using occt2d::scaleOf;
using occt2d::wrap;

namespace {

/**
 * The carrier of a line is a Geom2d_Line trimmed to ± this · the scale around its `from`:
 * InterCurveCurve throws on the offset of an unbounded line. A center farther away (lines
 * nearly parallel) is not found.
 */
constexpr double kLineReach = 1e6;

/**
 * The carrier of a curve: a line as a Geom2d_Line through `from` along it (parameter = distance
 * from `from`), trimmed to ±reach; an arc as its whole counter-clockwise Geom2d_Circle.
 */
Handle(Geom2d_Curve) carrierOf(const Curve2& c, double reach) {
  if (c.kind == Kind::Arc) return circleCurve(c.center, dist(c.center, c.from));
  const double length = dist(c.from, c.to);
  const Handle(Geom2d_Line) line =
      new Geom2d_Line(gp_Pnt2d(c.from[0], c.from[1]),
                      gp_Dir2d((c.to[0] - c.from[0]) / length, (c.to[1] - c.from[1]) / length));
  return new Geom2d_TrimmedCurve(line, -reach, reach, true, true);
}

/** The offset distances ±radius; a circle shrunk to (nearly) its center is left out. */
std::vector<double> offsetsOf(const Curve2& c, double radius, double tol) {
  if (c.kind == Kind::Line) return {radius, -radius};
  if (std::abs(dist(c.center, c.from) - radius) > tol) return {radius, -radius};
  return {radius};
}

/** The point of the bounded curve `g` nearest `p`: the projections and both ends. */
Vec2 nearestOn(const Handle(Geom2d_Curve) & g, Vec2 p) {
  std::vector<Vec2> found;
  Geom2dAPI_ProjectPointOnCurve projection(gp_Pnt2d(p[0], p[1]), g);
  for (int i = 1; i <= projection.NbPoints(); ++i) {
    const gp_Pnt2d q = projection.Point(i);
    found.push_back({q.X(), q.Y()});
  }
  for (double u : {g->FirstParameter(), g->LastParameter()}) {
    const gp_Pnt2d q = g->Value(u);
    found.push_back({q.X(), q.Y()});
  }
  Vec2 best = found.front();
  for (const Vec2& q : found) {
    if (dist(q, p) < dist(best, p)) best = q;
  }
  return best;
}

/**
 * The common points of two offset curves: their crossing points; of a piece InterCurveCurve
 * reports as shared, the point nearest `near` when the curves coincide there, otherwise the
 * touching point (a tangency).
 */
std::vector<Vec2> commonPoints(const Handle(Geom2d_Curve) & a, const Handle(Geom2d_Curve) & b,
                               Vec2 near, double tol) {
  Geom2dAPI_InterCurveCurve inter(a, b, tol);
  std::vector<Vec2> points;
  for (int k = 1; k <= inter.NbPoints(); ++k) {
    const gp_Pnt2d p = inter.Point(k);
    points.push_back({p.X(), p.Y()});
  }
  for (int k = 1; k <= inter.NbSegments(); ++k) {
    Handle(Geom2d_Curve) piece;
    Handle(Geom2d_Curve) onOther;
    try {
      inter.Segment(k, piece, onOther);
    } catch (const Standard_Failure&) {
      // The whole of a closed curve (coincident circles): Segment cannot trim it
      // (Standard_ConstructionError "U1 == U2").
      points.push_back(nearestOn(a, near));
      continue;
    }
    points.push_back(sharesPiece(piece, b, tol) ? nearestOn(piece, near)
                                                : touchingPoint(piece, b));
  }
  return points;
}

/** A touching point on a carrier and its parameter t. */
struct Touch {
  Vec2 point;
  double t;
};

/**
 * The projection of `center` on the carrier of `c` and its t (spec 12): a line [0, 1] from
 * `from` to `to`, also outside; an arc the angle from `from` in its direction, in [0, 2π) also
 * beyond its end.
 */
Touch projection(const Curve2& c, const Handle(Geom2d_Curve) & carrier, Vec2 center) {
  Geom2dAPI_ProjectPointOnCurve projected(gp_Pnt2d(center[0], center[1]), carrier);
  if (projected.NbPoints() == 0) {
    throw Failure(ErrorCode::OperationFailed, "filletArc: the center does not project");
  }
  const gp_Pnt2d nearest = projected.NearestPoint();
  const double u = projected.LowerDistanceParameter();
  const Vec2 point{nearest.X(), nearest.Y()};
  if (c.kind == Kind::Line) return {point, u / dist(c.from, c.to)};
  const double a0 = std::atan2(c.from[1] - c.center[1], c.from[0] - c.center[0]);
  const double t = wrap(c.ccw ? u - a0 : a0 - u, kTurn);
  return {point, t >= kTurn ? 0 : t};
}

}  // namespace

FilletArc filletOf(const Curve2& a, const Curve2& b, double radius, Vec2 near) {
  const std::array<Curve2, 2> pair{a, b};
  const double scale = scaleOf(pair, radius);
  const double tol = kConfusion * scale;
  const Handle(Geom2d_Curve) carrierA = carrierOf(a, kLineReach * scale);
  const Handle(Geom2d_Curve) carrierB = carrierOf(b, kLineReach * scale);
  std::vector<Handle(Geom2d_Curve)> offsetsA;
  for (double d : offsetsOf(a, radius, tol)) {
    offsetsA.push_back(new Geom2d_OffsetCurve(carrierA, d, true));
  }
  std::vector<Handle(Geom2d_Curve)> offsetsB;
  for (double d : offsetsOf(b, radius, tol)) {
    offsetsB.push_back(new Geom2d_OffsetCurve(carrierB, d, true));
  }
  std::optional<Vec2> center;
  for (const auto& oa : offsetsA) {
    for (const auto& ob : offsetsB) {
      for (const Vec2& c : commonPoints(oa, ob, near, tol)) {
        if (!center || dist(c, near) < dist(*center, near)) center = c;
      }
    }
  }
  if (!center) {
    throw Failure(ErrorCode::OperationFailed, "filletArc: no center at that radius");
  }
  const Touch onA = projection(a, carrierA, *center);
  const Touch onB = projection(b, carrierB, *center);
  return {*center, onA.point, onB.point, onA.t, onB.t};
}

}  // namespace tinycad::geometry::detail
