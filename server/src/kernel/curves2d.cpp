#include "curves2d.hpp"

#include <GC_MakeArcOfCircle2d.hxx>
#include <GC_MakeSegment2d.hxx>
#include <Geom2d_Circle.hxx>
#include <Geom2d_TrimmedCurve.hxx>
#include <NCollection_Array1.hxx>
#include <gp_Ax2d.hxx>
#include <gp_Circ2d.hxx>
#include <gp_Dir2d.hxx>
#include <gp_Pnt2d.hxx>

#include <algorithm>
#include <cmath>
#include <numeric>

namespace tinycad::kernel::detail {

double dist(Vec2 a, Vec2 b) { return std::hypot(a[0] - b[0], a[1] - b[1]); }

bool samePoint(Vec2 a, Vec2 b) {
  const auto near = [](double u, double v) {
    return std::abs(u - v) <= kPointTolerance * std::max({1.0, std::abs(u), std::abs(v)});
  };
  return near(a[0], b[0]) && near(a[1], b[1]);
}

double scaleOf(std::span<const Curve2> curves) {
  double scale = 1;
  const auto grow = [&scale](Vec2 p) { scale = std::max({scale, std::abs(p[0]), std::abs(p[1])}); };
  for (const Curve2& c : curves) {
    switch (c.kind) {
      case Kind::Line:
        grow(c.from);
        grow(c.to);
        break;
      case Kind::Arc:
        grow(c.center);
        grow(c.from);
        grow(c.to);
        break;
      case Kind::Circle:
        grow(c.center);
        break;
      case Kind::BSpline:
        for (const Vec2& p : c.poles) grow(p);
        break;
    }
  }
  return scale;
}

Curve2 counterClockwise(const Curve2& curve) {
  if (curve.kind != Kind::Arc || curve.ccw) return curve;
  return Curve2::arc(curve.center, curve.to, curve.from, true, curve.id);
}

Vec2 startOf(const Curve2& curve) {
  return curve.kind == Kind::BSpline ? curve.poles.front() : curve.from;
}

Vec2 endOf(const Curve2& curve) {
  return curve.kind == Kind::BSpline ? curve.poles.back() : curve.to;
}

namespace {

Handle(Geom2d_BSplineCurve) splineCurve(const Curve2& spline) {
  const CompressedKnots compressed = compressKnots(spline.knots);
  const int poleCount = static_cast<int>(spline.poles.size());
  const int knotCount = static_cast<int>(compressed.knots.size());
  NCollection_Array1<gp_Pnt2d> poles(1, poleCount);
  for (int i = 0; i < poleCount; ++i) {
    const Vec2& q = spline.poles[static_cast<std::size_t>(i)];
    poles.SetValue(i + 1, gp_Pnt2d(q[0], q[1]));
  }
  NCollection_Array1<double> knotArray(1, knotCount);
  NCollection_Array1<int> multArray(1, knotCount);
  for (int i = 0; i < knotCount; ++i) {
    knotArray.SetValue(i + 1, compressed.knots[static_cast<std::size_t>(i)]);
    multArray.SetValue(i + 1, compressed.multiplicities[static_cast<std::size_t>(i)]);
  }
  return new Geom2d_BSplineCurve(poles, knotArray, multArray, spline.degree, false);
}

}  // namespace

Handle(Geom2d_Curve) boundedCurve(const Curve2& curve) {
  const gp_Pnt2d from(curve.from[0], curve.from[1]);
  const gp_Pnt2d to(curve.to[0], curve.to[1]);
  if (curve.kind == Kind::Line) {
    const GC_MakeSegment2d maker(from, to);
    const Handle(Geom2d_TrimmedCurve) & segment = maker.Value();
    return Handle(Geom2d_Curve)(segment);
  }
  if (curve.kind == Kind::Arc) {
    const gp_Circ2d circle(gp_Ax2d(gp_Pnt2d(curve.center[0], curve.center[1]), gp_Dir2d(1, 0)),
                           dist(curve.center, curve.from), true);
    const GC_MakeArcOfCircle2d maker(circle, from, to, true);
    const Handle(Geom2d_TrimmedCurve) & arc = maker.Value();
    return Handle(Geom2d_Curve)(arc);
  }
  return splineCurve(curve);
}

Handle(Geom2d_Curve) circleCurve(Vec2 center, double radius) {
  return new Geom2d_Circle(gp_Ax2d(gp_Pnt2d(center[0], center[1]), gp_Dir2d(1, 0)), radius, true);
}

CompressedKnots compressKnots(const std::vector<double>& flat) {
  CompressedKnots out;
  for (const double k : flat) {
    if (!out.knots.empty() && out.knots.back() == k) {
      ++out.multiplicities.back();
    } else {
      out.knots.push_back(k);
      out.multiplicities.push_back(1);
    }
  }
  return out;
}

Box boxOf(const Curve2& curve, double tol) {
  std::vector<Vec2> points;
  switch (curve.kind) {
    case Kind::Line:
      points = {curve.from, curve.to};
      break;
    case Kind::Arc:
    case Kind::Circle: {
      const double r = curve.kind == Kind::Arc ? dist(curve.center, curve.from) : curve.radius;
      points = {Vec2{curve.center[0] - r, curve.center[1] - r},
                Vec2{curve.center[0] + r, curve.center[1] + r}};
      break;
    }
    case Kind::BSpline:
      points = curve.poles;
      break;
  }
  Box box{points[0][0], points[0][1], points[0][0], points[0][1]};
  for (const Vec2& q : points) {
    box[0] = std::min(box[0], q[0]);
    box[1] = std::min(box[1], q[1]);
    box[2] = std::max(box[2], q[0]);
    box[3] = std::max(box[3], q[1]);
  }
  return {box[0] - tol, box[1] - tol, box[2] + tol, box[3] + tol};
}

Box unionOf(const Box& a, const Box& b) {
  return {std::min(a[0], b[0]), std::min(a[1], b[1]), std::max(a[2], b[2]), std::max(a[3], b[3])};
}

bool boxesOverlap(const Box& a, const Box& b) {
  return a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
}

bool inBox(const Box& b, Vec2 q) {
  return q[0] >= b[0] && q[0] <= b[2] && q[1] >= b[1] && q[1] <= b[3];
}

std::vector<std::pair<std::size_t, std::size_t>> overlappingPairs(const std::vector<Box>& boxes) {
  std::vector<std::size_t> order(boxes.size());
  std::iota(order.begin(), order.end(), std::size_t{0});
  std::stable_sort(order.begin(), order.end(),
                   [&](std::size_t i, std::size_t j) { return boxes[i][0] < boxes[j][0]; });
  std::vector<std::pair<std::size_t, std::size_t>> pairs;
  for (std::size_t k = 0; k < order.size(); ++k) {
    const std::size_t i = order[k];
    for (std::size_t m = k + 1; m < order.size(); ++m) {
      const std::size_t j = order[m];
      if (boxes[j][0] > boxes[i][2]) break;
      if (boxesOverlap(boxes[i], boxes[j])) pairs.emplace_back(std::min(i, j), std::max(i, j));
    }
  }
  return pairs;
}

}  // namespace tinycad::kernel::detail
