#pragma once

// Shared pieces of Geom2dAPI_InterCurveCurve: whether a piece it reports is really shared or
// a tangency, and the touching point of a tangency (port of sharesPiece and touchingPoint of
// src/kernel-occt/curves.ts). Internal to tinycad_geometry.

#include <Geom2d_Curve.hxx>
#include <Standard_Handle.hxx>

#include "tinycad/geometry/geometry.hpp"

namespace tinycad::geometry::detail {

/** Precision::Confusion: the tolerance of the intersections, times the scale. */
inline constexpr double kConfusion = 1e-7;

/**
 * Whether a piece InterCurveCurve reports as shared really lies on the other curve: the gap at
 * its quarter points is far below the tolerance. Curves touching tangentially are reported as a
 * piece too, but their gap grows quadratically to the tolerance at its ends.
 */
bool sharesPiece(const Handle(Geom2d_Curve) & piece, const Handle(Geom2d_Curve) & other,
                 double tol);

/**
 * The point of a tangency piece nearest to the other curve (golden-section search over the
 * piece). A piece split at the seam of a circle ends at the touching point in both halves, so
 * both give the same point.
 */
Vec2 touchingPoint(const Handle(Geom2d_Curve) & piece, const Handle(Geom2d_Curve) & other);

}  // namespace tinycad::geometry::detail
