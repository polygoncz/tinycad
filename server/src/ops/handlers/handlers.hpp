#pragma once

// The built-in handlers (spec 04 "Vestavěné operace"), one subclass of OpHandler per operation
// type, grouped like src/ops/handlers/*.ts. Internal to tinycad_ops: OpHandlerRegistry registers
// them on construction.

#include <vector>

#include "tinycad/document/schema.hpp"
#include "tinycad/ops/handler.hpp"

namespace tinycad::ops::handlers {

/** feature.add, feature.remove, feature.setParams, feature.rename, feature.suppress, feature.move. */
std::vector<OpHandlerPtr> featureHandlers(const document::FeatureSchemaRegistryReader& schemas);
/** studio.setRollback. */
std::vector<OpHandlerPtr> studioHandlers();
/** body.rename, body.setVisible, body.setColor, body.setMaterial. */
std::vector<OpHandlerPtr> bodyHandlers();
/** document.rename. */
std::vector<OpHandlerPtr> documentHandlers();

}  // namespace tinycad::ops::handlers
