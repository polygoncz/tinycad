#pragma once

// The volume of a body for the regen cases (spec 13 "Druhy případů › regen", Q110; port of
// test/integration/shared-cases/support/mesh-volume.ts): computed from a fine mesh, compared with
// tolerance.relative 1e-3.

#include "tinycad/kernel/types.hpp"

namespace tinycad::testing {

/** The fine mesh of the volume (spec 13): linearDeflection 0.01, angularDeflection 0.05. */
inline constexpr kernel::MeshQuality kFineMesh{0.01, 0.05};

/** Volume enclosed by the triangles (divergence theorem): Σ a · (b × c) / 6. */
double meshVolume(const kernel::MeshData& mesh);

}  // namespace tinycad::testing
