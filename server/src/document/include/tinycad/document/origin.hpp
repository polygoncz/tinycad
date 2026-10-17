#pragma once

// The origin geometry (spec 03 "Počáteční geometrie", src/document/origin.ts): artifacts of the
// reserved owner "origin" (ADR 0015). Regen seeds them into its empty state (M43).

#include <array>
#include <string_view>

#include "tinycad/core/math.hpp"
#include "tinycad/document/refs.hpp"

namespace tinycad::document {

/** The reserved owner of the origin geometry; no feature may have this id. */
inline constexpr std::string_view ORIGIN = "origin";

struct OriginPlane {
  /** "origin/plane:xy", "origin/plane:xz", "origin/plane:yz". */
  std::string_view id;
  /** Translation key, "origin.plane.xy" (ADR 0014). */
  std::string_view label;
  core::Plane plane;
};

/** Top (xy), front (xz, normal −Y) and right (yz) plane, in this order (src/document/origin.ts). */
inline const std::array<OriginPlane, 3> ORIGIN_PLANES = {{
    {"origin/plane:xy", "origin.plane.xy", {{0, 0, 0}, {1, 0, 0}, {0, 0, 1}}},
    {"origin/plane:xz", "origin.plane.xz", {{0, 0, 0}, {1, 0, 0}, {0, -1, 0}}},
    {"origin/plane:yz", "origin.plane.yz", {{0, 0, 0}, {0, 1, 0}, {1, 0, 0}}},
}};

struct OriginAxis {
  /** "origin/axis:x", "origin/axis:y", "origin/axis:z". */
  std::string_view id;
  std::string_view label;
  core::Vec3 origin;
  /** Unit direction. */
  core::Vec3 direction;
};

/** The axes X, Y and Z through the origin, in this order (M13). */
inline const std::array<OriginAxis, 3> ORIGIN_AXES = {{
    {"origin/axis:x", "origin.axis.x", {0, 0, 0}, {1, 0, 0}},
    {"origin/axis:y", "origin.axis.y", {0, 0, 0}, {0, 1, 0}},
    {"origin/axis:z", "origin.axis.z", {0, 0, 0}, {0, 0, 1}},
}};

}  // namespace tinycad::document
