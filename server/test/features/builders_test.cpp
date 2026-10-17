// registerBuiltInBuilders: the eight builders in the order of the built-in plugins (sketch: M44.1).

#include "features/builder_testing.hpp"

namespace tinycad::features::test {
namespace {

TEST(RegisterBuiltInBuilders, RegistersTheEightBuildersInPluginOrder) {
  regen::FeatureBuilderRegistry registry;
  registerBuiltInBuilders(registry);
  std::vector<std::string> types;
  for (const auto* b : registry.all()) types.push_back(b->type());
  EXPECT_EQ(types, (std::vector<std::string>{"box", "cylinder", "boolean", "extrude", "revolve",
                                             "fillet", "chamfer", "transform"}));
}

}  // namespace
}  // namespace tinycad::features::test
