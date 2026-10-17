#pragma once

// The schemas (data half) of the built-in features (decision N22): box, cylinder, boolean,
// sketch (M44.1), extrude, revolve, fillet, chamfer and transform. The builders (geometry half)
// are tinycad_feature_builders of M43 (builders.hpp).

#include "tinycad/document/schema.hpp"

namespace tinycad::features {

/**
 * Registers the nine schemas in the order of the built-in plugins
 * (test/integration/shared-cases/support/plugins.ts). A type already in the registry throws
 * AssertionError, like any duplicate.
 */
void registerBuiltInSchemas(document::FeatureSchemaRegistry& registry);

}  // namespace tinycad::features
