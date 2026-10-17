#pragma once

// The behaviour halves of the built-in features (spec 07, src/features/*/builder.ts): one
// regen::FeatureBuilder class per feature in server/src/features/<name>/builder.{hpp,cpp}.
//
// A second library next to the schemas (decision N44): tinycad_feature_builders depends on
// tinycad_regen and the kernel port, tinycad_features (schemas, M40) stays without them, so storage
// (M41) and the feature descriptors (M45) do not drag regen or OCCT in.

#include "tinycad/regen/builder.hpp"

namespace tinycad::features {

/**
 * Registers the builders in the order of test/integration/shared-cases/support/plugins.ts:
 * box, cylinder, boolean, [sketch – M44.1], extrude, revolve, fillet, chamfer, transform.
 */
void registerBuiltInBuilders(regen::FeatureBuilderRegistry& registry);

}  // namespace tinycad::features
