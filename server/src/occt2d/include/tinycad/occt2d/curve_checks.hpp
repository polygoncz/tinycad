#pragma once

// The check of one input curve (spec 06, M29): finite coordinates, an arc with equal radii, a
// B-spline that Geom2d_BSplineCurve never throws on. Shared by the input checks of makeFace and
// profileRegions (tinycad_kernel) and of the four geometry calls (tinycad_geometry), N77.

#include <optional>
#include <string>
#include <vector>

#include "tinycad/occt2d/curves.hpp"

namespace tinycad::occt2d {

/** How a curve is read: whether the id is required and a curve of zero length left out. */
struct CurveRules {
  bool idRequired;
  bool skipZeroLength;
};

/** Ok = usable, Skip = of zero length and the rules leave it out, Bad = a problem was added. */
enum class CurveRead { Ok, Skip, Bad };

/**
 * One curve against the rules. Problems are appended to `problems` as texts with the path
 * ('curves[2].radius: …'); the texts are for people and never compared.
 */
CurveRead readCurve(const Curve2& curve, const std::string& path,
                    std::vector<std::string>& problems, CurveRules rules);

/**
 * Why a knot vector of the right length is not clamped, or nullopt when it is: the first and
 * the last degree + 1 knots equal, first < last, the interior knots strictly between them,
 * non-decreasing and none repeated more than degree times. The range need not be [0, 1].
 */
std::optional<std::string> knotsProblem(const std::vector<double>& knots, int degree);

}  // namespace tinycad::occt2d
