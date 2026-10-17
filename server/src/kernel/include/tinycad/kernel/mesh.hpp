#pragma once

// Checks that are part of the kernel contract and shared by tests and callers (src/kernel/mesh.ts,
// src/kernel/transform.ts).

#include <string>
#include <vector>

#include "tinycad/core/math.hpp"
#include "tinycad/kernel/types.hpp"

namespace tinycad::kernel {

/**
 * Structural check of a mesh (validateMeshData, spec 06 "Síť pro vykreslení"): lengths, finite
 * numbers, unit normals (1e-4), indices in range, faceRanges sorted, non-overlapping, covering
 * every triangle exactly once with ≥ 1 triangle each, edgeRanges likewise with ≥ 2 points each.
 * Empty = valid.
 */
std::vector<std::string> validateMeshData(const MeshData& mesh);

/** A rotation + translation without mirror or scale, all 16 elements finite (isRigidMotion). */
bool isRigidMotion(const core::Mat4& m);

}  // namespace tinycad::kernel
