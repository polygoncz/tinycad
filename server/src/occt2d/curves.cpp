#include "tinycad/occt2d/curves.hpp"

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

namespace tinycad::occt2d {

double dist(Vec2 a, Vec2 b) { return std::hypot(a[0] - b[0], a[1] - b[1]); }

bool samePoint(Vec2 a, Vec2 b) {
  const auto near = [](double u, double v) {
    return std::abs(u - v) <= kPointTolerance * std::max({1.0, std::abs(u), std::abs(v)});
  };
  return near(a[0], b[0]) && near(a[1], b[1]);
}

double angleAround(Vec2 center, Vec2 p) { return std::atan2(p[1] - center[1], p[0] - center[0]); }

Vec2 onCircle(Vec2 center, double radius, double angle) {
  return {center[0] + radius * std::cos(angle), center[1] + radius * std::sin(angle)};
}

double wrap(double x, double m) { return std::fmod(std::fmod(x, m) + m, m); }

double arcSweep(const Curve2& arc) {
  const double a0 = angleAround(arc.center, arc.from);
  const double a1 = angleAround(arc.center, arc.to);
  return wrap(arc.ccw ? a1 - a0 : a0 - a1, kTurn);
}

double scaleOf(std::span<const Curve2> curves, double extra) {
  double scale = std::max(1.0, std::abs(extra));
  const auto grow = [&scale](Vec2 p) {
    scale = std::max({scale, std::abs(p[0]), std::abs(p[1])});
  };
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

Handle(Geom2d_Curve) boundedCurve(const Curve2& curve) {
  const gp_Pnt2d from(curve.from[0], curve.from[1]);
  const gp_Pnt2d to(curve.to[0], curve.to[1]);
  if (curve.kind == Kind::Line) {
    const GC_MakeSegment2d maker(from, to);
    const Handle(Geom2d_TrimmedCurve)& segment = maker.Value();
    return Handle(Geom2d_Curve)(segment);
  }
  if (curve.kind == Kind::Arc) {
    const gp_Circ2d circle(gp_Ax2d(gp_Pnt2d(curve.center[0], curve.center[1]), gp_Dir2d(1, 0)),
                           dist(curve.center, curve.from), true);
    const GC_MakeArcOfCircle2d maker(circle, from, to, true);
    const Handle(Geom2d_TrimmedCurve)& arc = maker.Value();
    return Handle(Geom2d_Curve)(arc);
  }
  return splineCurve(curve);
}

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

Handle(Geom2d_Curve) circleCurve(Vec2 center, double radius) {
  return new Geom2d_Circle(gp_Ax2d(gp_Pnt2d(center[0], center[1]), gp_Dir2d(1, 0)), radius, true);
}

CompressedKnots compressKnots(const std::vector<double>& flat) {
  CompressedKnots out;
  for (double k : flat) {
    if (!out.knots.empty() && out.knots.back() == k) {
      ++out.multiplicities.back();
    } else {
      out.knots.push_back(k);
      out.multiplicities.push_back(1);
    }
  }
  return out;
}

Curve2 splineOf(const Handle(Geom2d_BSplineCurve) & g, double k0, double k1) {
  std::vector<Vec2> poles;
  const NCollection_Array1<gp_Pnt2d>& poleArray = g->Poles();
  for (int i = poleArray.Lower(); i <= poleArray.Upper(); ++i) {
    poles.push_back({poleArray.Value(i).X(), poleArray.Value(i).Y()});
  }
  std::vector<double> knots;
  const NCollection_Array1<double>& knotArray = g->Knots();
  const NCollection_Array1<int>& multArray = g->Multiplicities();
  const int lower = knotArray.Lower();
  const int upper = knotArray.Upper();
  for (int i = lower; i <= upper; ++i) {
    const double k = i == lower ? 0 : i == upper ? 1 : (knotArray.Value(i) - k0) / (k1 - k0);
    for (int m = 0; m < multArray.Value(i); ++m) knots.push_back(k);
  }
  return Curve2::bspline(g->Degree(), poles, knots);
}

}  // namespace tinycad::occt2d
