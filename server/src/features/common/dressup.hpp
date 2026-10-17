#pragma once

// The shared build of Fillet and Chamfer (src/features/{fillet,chamfer}/builder.ts are twins):
// the edges grouped by body, one kernel call per body with all its edges (R105), each body keeps
// its identity. The kernel's OperationFailed becomes INVALID_PARAMS with the issue of the feature
// at its size param (D6); any other kernel error is KERNEL.

#include "tinycad/regen/builder.hpp"

namespace tinycad::features {

enum class DressupKind { Fillet, Chamfer };

regen::BuildResult buildDressup(DressupKind kind, const regen::BuildInput& input,
                                regen::BuildContext& ctx);

}  // namespace tinycad::features
