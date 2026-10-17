#pragma once

// Planar profiles for SketchOps (spec 06 "Stav po M12" and "Stav po M30", src/kernel/profile.ts):
// the input of makeFace, the regions of profileRegions and the one check of their inputs.
//
// The 2D-only functions of the TS SketchOps (curveIntersections, curveSegment, filletArc,
// offsetCurves) are NOT part of the C++ port: they are the library tinycad_geometry of M39
// behind GeometryService, and no feature builder uses them (decision N12).

#include <string>
#include <vector>

#include "tinycad/core/curve2.hpp"
#include "tinycad/core/math.hpp"
#include "tinycad/core/result.hpp"

namespace tinycad::kernel {

/** A 2D curve in a plane; `id` = id of the sketch entity, opaque for the kernel ("" = none). */
using ProfileCurve = core::Curve2;
using ProfileLoop = std::vector<ProfileCurve>;

/** The input of makeFace. Loop coordinates are in the plane (x = xDir, y = normal × xDir). */
struct FaceInput {
  core::Plane plane;
  ProfileLoop outer;
  std::vector<ProfileLoop> holes;
};

/** A region (M30): a closed outer loop and holes; structurally SketchRegion of sketch. */
struct ProfileRegion {
  /** Ids of all boundary curves, without duplicates, sorted (byte order), joined by ','. */
  std::string name;
  /** Counter-clockwise, the input curves oriented along the loop (coordinates unchanged). */
  ProfileLoop outer;
  /** Clockwise. */
  std::vector<ProfileLoop> holes;
  /** > 0: outer minus holes. */
  double area = 0;
};

/** Regions sorted by name; a crossing gives no regions (Q093). */
struct ProfileRegions {
  std::vector<ProfileRegion> regions;
  bool crossing = false;
};

/**
 * The makeFace contract check (validateFaceInput): empty = valid, else descriptions of every
 * problem (the method then fails with InvalidInput). Spec 06 Kontrakt `makeFace`: orthonormal
 * plane (1e-9), non-empty outer, each loop one circle or ≥ 1 lines/arcs/splines joined end to
 * start within 1e-7 · max(1, |coordinate|), non-degenerate curves, equal arc radii (1e-7 relative).
 */
std::vector<std::string> validateFaceInput(const FaceInput& input);

/**
 * The profileRegions input check (parseProfileRegionsInput): every curve with a non-empty id,
 * unique within the call, valid shape; returns the curves WITHOUT the skipped degenerate ones
 * (zero-length line/arc, spline with all poles in one point), or every problem.
 */
core::Result<std::vector<ProfileCurve>, std::vector<std::string>> parseProfileRegionsInput(
    const std::vector<ProfileCurve>& curves);

}  // namespace tinycad::kernel
