// The builders of the built-in features (spec 07), registered in the order of the built-in
// plugins; the sketch builder comes with M44.1.

#include "tinycad/features/builders.hpp"

#include <memory>

#include "boolean/builder.hpp"
#include "box/builder.hpp"
#include "chamfer/builder.hpp"
#include "cylinder/builder.hpp"
#include "extrude/builder.hpp"
#include "fillet/builder.hpp"
#include "revolve/builder.hpp"
#include "transform/builder.hpp"

namespace tinycad::features {

void registerBuiltInBuilders(regen::FeatureBuilderRegistry& registry) {
  registry.add(std::make_shared<const BoxBuilder>());
  registry.add(std::make_shared<const CylinderBuilder>());
  registry.add(std::make_shared<const BooleanBuilder>());
  // [sketch – M44.1]
  registry.add(std::make_shared<const ExtrudeBuilder>());
  registry.add(std::make_shared<const RevolveBuilder>());
  registry.add(std::make_shared<const FilletBuilder>());
  registry.add(std::make_shared<const ChamferBuilder>());
  registry.add(std::make_shared<const TransformBuilder>());
}

}  // namespace tinycad::features
