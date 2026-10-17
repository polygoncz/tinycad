#pragma once

// The four geometry algorithms over OCCT on an already checked input (validate.hpp). They throw
// Failure ('operation-failed') or let OCCT exceptions out; geometry.cpp turns those into
// 'internal'. Internal to tinycad_geometry.

#include <vector>

#include "tinycad/geometry/geometry.hpp"
#include "validate.hpp"

namespace tinycad::geometry::detail {

/** Port of curveIntersectionsOf (src/kernel-occt/curves.ts). */
std::vector<CurveHit> intersectionsOf(const std::vector<Curve2>& curves);

/** Port of curveSegmentOf (src/kernel-occt/curves.ts). */
Curve2 segmentOf(const SegmentInput& input);

/** Port of filletArcOf (src/kernel-occt/fillet.ts). */
FilletArc filletOf(const Curve2& a, const Curve2& b, double radius, Vec2 near);

/** Port of offsetCurvesOf (src/kernel-occt/offset.ts). */
std::vector<OffsetCurve> offsetOf(const std::vector<Curve2>& chain, bool closed, double distance);

}  // namespace tinycad::geometry::detail
