#pragma once

// 2D curves of a profile as OCCT Geom2d curves, small vector helpers and the bounding box
// prefilter of curve pairs: shared by the input checks (profile.cpp), the face (face.cpp) and
// the regions (regions.cpp). A port of src/kernel-occt/geom2d.ts, like the internal geom2d.hpp
// of tinycad_geometry, which is not public. Internal to tinycad_kernel.

#include <Geom2d_BSplineCurve.hxx>
#include <Geom2d_Curve.hxx>
#include <Standard_Handle.hxx>

#include <array>
#include <cstddef>
#include <numbers>
#include <span>
#include <utility>
#include <vector>

#include "tinycad/core/curve2.hpp"
#include "tinycad/core/math.hpp"

namespace tinycad::kernel::detail {

using core::Curve2;
using core::Vec2;
using Kind = Curve2::Kind;

inline constexpr double kTurn = 2 * std::numbers::pi;

/** Spec 06: two points coincide within this · max(1, |coordinate|), per coordinate. */
inline constexpr double kPointTolerance = 1e-7;

double dist(Vec2 a, Vec2 b);

/** Spec 06: coordinates agree within kPointTolerance · max(1, |coordinate|). */
bool samePoint(Vec2 a, Vec2 b);

/** max(1, |every coordinate of the curves|): the scale of the tolerances of a call. */
double scaleOf(std::span<const Curve2> curves);

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

/** A counter-clockwise Geom2d_Circle, parametrised by the angle from +x. */
Handle(Geom2d_Curve) circleCurve(Vec2 center, double radius);

/** The distinct knots of a non-decreasing knot vector and how often each repeats. */
struct CompressedKnots {
  std::vector<double> knots;
  std::vector<int> multiplicities;
};
CompressedKnots compressKnots(const std::vector<double>& flat);

/** Axis-aligned box [minX, minY, maxX, maxY]. */
using Box = std::array<double, 4>;

/**
 * A box around the curve grown by `tol`: an arc by its whole circle, a spline by its poles (the
 * curve lies in their convex hull).
 */
Box boxOf(const Curve2& curve, double tol);

/** The smallest box containing both. */
Box unionOf(const Box& a, const Box& b);

bool boxesOverlap(const Box& a, const Box& b);

bool inBox(const Box& b, Vec2 q);

/** The pairs [i, j] (i < j) of boxes that overlap, by a sweep along x; in no particular order. */
std::vector<std::pair<std::size_t, std::size_t>> overlappingPairs(const std::vector<Box>& boxes);

}  // namespace tinycad::kernel::detail
