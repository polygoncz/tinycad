// curveSegment (port of src/kernel-occt/curves.ts, spec 12 "Port a parametr křivky"): pieces of
// lines and arcs from the formulas, of a spline by Geom2d_BSplineCurve::Segment.

#include <cmath>

#include "tinycad/occt2d/curves.hpp"

#include "algorithms.hpp"

namespace tinycad::geometry::detail {

using occt2d::angleAround;
using occt2d::arcSweep;
using occt2d::Kind;
using occt2d::onCircle;
using occt2d::splineCurve;
using occt2d::splineOf;

namespace {

Vec2 onLine(const Curve2& line, double t) {
  if (t == 0) return line.from;
  if (t == 1) return line.to;
  return {line.from[0] + (line.to[0] - line.from[0]) * t,
          line.from[1] + (line.to[1] - line.from[1]) * t};
}

/** The point of the arc at t (the angle from `from` in its direction); its ends exactly. */
Vec2 onArc(const Curve2& arc, double t) {
  if (t == 0) return arc.from;
  if (t == arcSweep(arc)) return arc.to;
  const double r = std::hypot(arc.from[0] - arc.center[0], arc.from[1] - arc.center[1]);
  const double sign = arc.ccw ? 1 : -1;
  return onCircle(arc.center, r, angleAround(arc.center, arc.from) + sign * t);
}

/** The piece of a spline with its knots rescaled from [from, to] to [0, 1]. */
Curve2 splineSegment(const Curve2& spline, double from, double to) {
  const Handle(Geom2d_BSplineCurve) g = splineCurve(spline);
  g->Segment(from, to);
  Curve2 piece = splineOf(g, from, to);
  piece.id = spline.id;
  return piece;
}

}  // namespace

Curve2 segmentOf(const SegmentInput& input) {
  const Curve2& c = input.curve;
  switch (c.kind) {
    case Kind::Line:
      return Curve2::line(onLine(c, input.from), onLine(c, input.to), c.id);
    case Kind::Arc:
      return Curve2::arc(c.center, onArc(c, input.from), onArc(c, input.to), c.ccw, c.id);
    case Kind::Circle:
      return Curve2::arc(c.center, onCircle(c.center, c.radius, input.from),
                         onCircle(c.center, c.radius, input.to), true, c.id);
    case Kind::BSpline:
      break;
  }
  return splineSegment(c, input.from, input.to);
}

}  // namespace tinycad::geometry::detail
