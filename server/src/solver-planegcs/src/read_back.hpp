#pragma once

// The solution back into sketch terms (port of readEntities, backToIds and passedEnds of
// src/solver-planegcs/solve.ts).

#include <optional>
#include <string>
#include <unordered_map>
#include <vector>

#include "gcs_wrapper.hpp"

namespace tinycad::solver_planegcs {

/**
 * The input entities with the solved coordinates and radii (points, circles, the hidden poles of
 * fit splines; the rest unchanged and shared); nullopt if any number is not finite.
 */
std::optional<std::vector<sketch::EntityPtr>> readEntities(
    GcsWrapper& w, const std::vector<sketch::EntityPtr>& input);

/**
 * planegcs ids → sketch constraint ids: suffixes off, drag, arc rules and fit points out, no
 * duplicates, in the order of the first occurrence.
 */
std::vector<sketch::SketchConstraintId> backToIds(
    const std::vector<std::optional<std::string>>& ids,
    const std::unordered_map<std::string, sketch::SketchConstraintId>& constraintIds);

/** The free parameters that left [0, 1] in the solution, with the end they passed. */
Ends passedEnds(GcsWrapper& w, const std::vector<FreeParam>& params);

}  // namespace tinycad::solver_planegcs
