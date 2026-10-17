#pragma once

// 2D curves as OCCT Geom2d curves and the small vector helpers around them (port of
// src/kernel-occt/geom2d.ts): the one 2D base of tinycad_kernel (faces, regions) and
// tinycad_geometry (sketch geometry), decision N77. Internal library: these headers carry OCCT
// types, so only kernel and geometry link it, privately (ADR 0030, decision N154).

#include <Geom2d_BSplineCurve.hxx>
#include <Geom2d_Curve.hxx>
#include <Standard_Handle.hxx>

#include <numbers>
#include <span>
#include <vector>

#include "tinycad/core/curve2.hpp"
#include "tinycad/core/math.hpp"

namespace tinycad::occt2d {

using core::Curve2;
using core::Vec2;
using Kind = Curve2::Kind;

inline constexpr double kTurn = 2 * std::numbers::pi;

/** Spec 06: two points coincide within this · max(1, |coordinate|), per coordinate. */
inline constexpr double kPointTolerance = 1e-7;

double dist(Vec2 a, Vec2 b);

/** Spec 06: coordinates agree within kPointTolerance · max(1, |coordinate|). */
bool samePoint(Vec2 a, Vec2 b);

/** The angle of `p` around `center`, atan2. */
double angleAround(Vec2 center, Vec2 p);

/** The point of the circle at `angle` from +x. */
Vec2 onCircle(Vec2 center, double radius, double angle);

/** JavaScript's ((x % m) + m) % m: x reduced into [0, m) (m itself after rounding). */
double wrap(double x, double m);

/** The sweep of an arc in its own direction, [0, 2π). */
double arcSweep(const Curve2& arc);

/** max(1, |extra|, |every coordinate of the curves|): the scale of the tolerances of a call. */
double scaleOf(std::span<const Curve2> curves, double extra = 0);

/** An arc running counter-clockwise from `from` to `to` (the same arc); other curves unchanged. */
Curve2 counterClockwise(const Curve2& curve);

/** The start of a line, an arc or a spline (its first pole). */
Vec2 startOf(const Curve2& curve);
/** The end of a line, an arc or a spline (its last pole). */
Vec2 endOf(const Curve2& curve);

/**
 * A Geom2d curve of a line, an arc or a spline, parametrised from its start to its end; an arc
 * must be counter-clockwise (see counterClockwise).
 */
Handle(Geom2d_Curve) boundedCurve(const Curve2& curve);

/** The non-rational Geom2d_BSplineCurve of a clamped spline. */
Handle(Geom2d_BSplineCurve) splineCurve(const Curve2& spline);

/** A counter-clockwise Geom2d_Circle, parametrised by the angle from +x. */
Handle(Geom2d_Curve) circleCurve(Vec2 center, double radius);

/** The distinct knots of a non-decreasing knot vector and how often each repeats. */
struct CompressedKnots {
  std::vector<double> knots;
  std::vector<int> multiplicities;
};
CompressedKnots compressKnots(const std::vector<double>& flat);

/** The spline of a Geom2d_BSplineCurve: poles, the flat knot vector rescaled from [k0, k1] to [0, 1]. */
Curve2 splineOf(const Handle(Geom2d_BSplineCurve) & g, double k0, double k1);

}  // namespace tinycad::occt2d
