#pragma once

// Axis-aligned boxes of 2D curves and the prefilter of curve pairs whose boxes overlap: shared
// by the regions of tinycad_kernel and the intersections of tinycad_geometry (decision N77).

#include <array>
#include <cstddef>
#include <utility>
#include <vector>

#include "tinycad/occt2d/curves.hpp"

namespace tinycad::occt2d {

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

}  // namespace tinycad::occt2d
