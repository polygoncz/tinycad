#pragma once

// profileRegions of the kernel (spec 06 "Oblasti skici v adaptéru (M30)", spec 12 "Oblasti
// (profily)"): a port of the algorithm of src/kernel-occt/regions.ts, not BOPAlgo or
// BRepAlgoAPI_Splitter, so the names and `crossing` match the shared regen cases (decision N29).
// Internal to tinycad_kernel.

#include <span>

#include "tinycad/kernel/profile.hpp"

namespace tinycad::kernel::detail {

/**
 * Checks the curves (parseProfileRegionsInput, InvalidInput with every problem) and returns the
 * regions they bound, sorted by name; a crossing gives no regions.
 */
ProfileRegions profileRegionsOf(std::span<const ProfileCurve> curves);

}  // namespace tinycad::kernel::detail
