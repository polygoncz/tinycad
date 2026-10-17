#pragma once

// Evaluation of a clamped polynomial B-spline and its derivatives (port of evaluate and derivative
// of src/core/math/bspline.ts, Piegl–Tiller A2.1, A2.3, A3.2). Only the adapter needs it, for the
// start value of the curve parameter of a point on a spline, so it is internal here.

#include "tinycad/core/math.hpp"

namespace tinycad::solver_planegcs::bspline {

/** The point on the curve; t is clamped to [knots[degree], knots[poles.size()]]. */
core::Vec2 evaluate(const core::BSplineShape& curve, double t);

/** The order-th derivative with respect to t (order 1 or 2; zero when degree < order). */
core::Vec2 derivative(const core::BSplineShape& curve, double t, int order);

}  // namespace tinycad::solver_planegcs::bspline
