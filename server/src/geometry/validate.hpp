#pragma once

// The input checks of the four geometry calls (port of parseProfileRegionsInput,
// parseCurveSegmentInput, parseFilletArcInput and parseOffsetCurvesInput of
// src/kernel/profile.ts). Each returns the checked input or throws Failure 'invalid-input' with
// every problem found. Internal to tinycad_geometry.

#include <vector>

#include "tinycad/geometry/geometry.hpp"

namespace tinycad::geometry::detail {

/** Every id present and unique (among the skipped curves too); curves of zero length left out. */
std::vector<Curve2> checkIntersections(const std::vector<Curve2>& curves);

struct SegmentInput {
  Curve2 curve;
  double from = 0;
  double to = 0;
};

/**
 * The curve as makeFace takes it (id optional), finite from < to in the range of t (spec 12);
 * a parameter just outside the range (rounding) is moved onto its bound.
 */
SegmentInput checkSegment(const Curve2& curve, double from, double to);

/** Lines or arcs as makeFace takes them, a finite radius > 0 and a finite `near`. */
void checkFillet(const Curve2& a, const Curve2& b, double radius, Vec2 near);

/**
 * A non-empty chain of curves as makeFace takes them, each with an id, joined end to start
 * (the last to the first when closed); a circle only alone and closed; a finite distance != 0.
 */
void checkOffset(const std::vector<Curve2>& chain, bool closed, double distance);

}  // namespace tinycad::geometry::detail
