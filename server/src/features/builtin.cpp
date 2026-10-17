#include "tinycad/features/builtin.hpp"

#include <memory>

#include "boolean/schema.hpp"
#include "box/schema.hpp"
#include "chamfer/schema.hpp"
#include "cylinder/schema.hpp"
#include "extrude/schema.hpp"
#include "fillet/schema.hpp"
#include "revolve/schema.hpp"
#include "sketch/schema.hpp"
#include "transform/schema.hpp"

namespace tinycad::features {

void registerBuiltInSchemas(document::FeatureSchemaRegistry& registry) {
  registry.add(std::make_shared<BoxSchema>());
  registry.add(std::make_shared<CylinderSchema>());
  registry.add(std::make_shared<BooleanSchema>());
  registry.add(std::make_shared<SketchSchema>());
  registry.add(std::make_shared<ExtrudeSchema>());
  registry.add(std::make_shared<RevolveSchema>());
  registry.add(std::make_shared<FilletSchema>());
  registry.add(std::make_shared<ChamferSchema>());
  registry.add(std::make_shared<TransformSchema>());
}

}  // namespace tinycad::features
