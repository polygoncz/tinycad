#pragma once

// The identity rule of changed bodies and the body operation of sketch-based features in one place
// (spec 07 "Builder featury" and "Operace tělesa (M13)", src/regen/body-change.ts and
// body-operation.ts). Plugins may not depend on each other, so the shared code lives in regen.

#include <optional>
#include <string_view>
#include <vector>

#include "tinycad/kernel/kernel.hpp"
#include "tinycad/regen/names.hpp"
#include "tinycad/regen/state.hpp"

namespace tinycad::regen {

/**
 * The body changed by `feature` to the shape of `result`: id, origin and place stay, names come
 * from nameShape over `inputs` (the tables of the input shapes in the order of the kernel call)
 * with `generatedTag`, lastModifiedBy = `feature`. `body` stays as it is.
 */
kernel::KernelResult<BodyPtr> modifyBody(kernel::QueryOps& kernel, const FeatureId& feature,
                                         const Body& body, const kernel::ShapeResult& result,
                                         const std::vector<NameTablePtr>& inputs,
                                         std::string_view generatedTag = "gen");

/** The params value of `operation`: "new" | "add" | "remove" | "intersect". */
enum class BodyOperation { New, Add, Remove, Intersect };

/** The enum of the params string; nullopt for anything else (validated params never give it). */
std::optional<BodyOperation> parseBodyOperation(std::string_view name);

/**
 * The state after `feature` applied its new `shapes` (≥ 1) by `op` (spec 07, R65–R67):
 * - New: one shape is the body, several are united by one union; a new body bodyId(feature) at
 *   the end,
 * - Add: one union of the first target with the other targets and the shapes; the result keeps
 *   id, origin and place of the first target, the other targets leave,
 * - Remove / Intersect: subtract / intersect for each target on its own, one after another;
 *   each target keeps id, origin and place.
 * Each new shape is named by its roles (inputs NameTable::empty() for every history input), a
 * boolean result by nameShape over the tables of its inputs in the order of the kernel call.
 * `kernel` is ctx.kernel() (intermediate shapes are tracked and swept). A kernel error (an empty
 * result too) is returned. No shapes, or no targets for a change, throws core::AssertionError:
 * the schemas require at least one.
 */
kernel::KernelResult<StatePtr> applyBodyOperation(kernel::ModelingKernel& kernel,
                                                  const StatePtr& state, const FeatureId& feature,
                                                  BodyOperation op,
                                                  const std::vector<kernel::ShapeResult>& shapes,
                                                  const std::vector<BodyPtr>& targets);

}  // namespace tinycad::regen
