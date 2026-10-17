// The runner of the shared cases regen (spec 13 "Druhy případů › regen"; the TypeScript twin is
// test/integration/shared-cases/regen.test.ts): a stored document loaded with the built-in
// schemas, regenerated once from scratch by a new Regenerator over a new OcctKernel, described by
// support/regen_describe and compared with the expected output.

#include <gtest/gtest.h>

#include <algorithm>
#include <string>

#include "shared-cases/support/regen_describe.hpp"
#include "support/compare.hpp"
#include "support/shared_cases.hpp"
#include "tinycad/document/serialize.hpp"
#include "tinycad/features/builders.hpp"
#include "tinycad/features/builtin.hpp"
#include "tinycad/kernel/occt_kernel.hpp"
#include "tinycad/regen/regenerator.hpp"

namespace tinycad::testing {
namespace {

using core::Json;

const document::FeatureSchemaRegistry& schemas() {
  static const document::FeatureSchemaRegistry registry = [] {
    document::FeatureSchemaRegistry r;
    features::registerBuiltInSchemas(r);
    return r;
  }();
  return registry;
}

const regen::FeatureBuilderRegistry& builders() {
  static const regen::FeatureBuilderRegistry registry = [] {
    regen::FeatureBuilderRegistry r;
    features::registerBuiltInBuilders(r);
    return r;
  }();
  return registry;
}

/** Loads the document, regenerates it once with a new Regenerator and describes the result. */
Json regenerate(const Json& input) {
  auto loaded = document::fromData(input.at("document"), schemas());
  if (!loaded) throw std::runtime_error("The document does not load: " + input.dump());
  const auto studio = (*loaded)->studio();
  regen::RunOptions options;
  if (input.contains("inputOf")) {
    options.inputOf = document::FeatureId(input.at("inputOf").get<std::string>());
  }
  kernel::OcctKernel kernel;
  regen::Regenerator regenerator(kernel, builders(), schemas(), [] { return 0.0; });
  const regen::RegenResult result = regenerator.run(*studio, options);
  Json output = describeResult(kernel, result);
  // Only with inputOf (spec 13): the state in front of the edited feature, null when the feature
  // is behind the rollback bar or unknown.
  if (options.inputOf) {
    if (result.input) {
      Json state = describeState(kernel, *result.input->state);
      output["input"] = {{"feature", result.input->feature.str()},
                         {"bodies", state["bodies"]},
                         {"sketches", state["sketches"]}};
    } else {
      output["input"] = nullptr;
    }
  }
  return {{"ok", output}};
}

class RegenSharedCase : public ::testing::TestWithParam<std::string> {};

TEST_P(RegenSharedCase, MatchesExpected) {
  const Json sharedCase = loadCase("regen", GetParam());
  ASSERT_EQ(sharedCase.at("kind").get<std::string>(), "regen");
  ASSERT_TRUE(sharedCase.contains("expected")) << "'expected' is missing";

  const Json actual = regenerate(sharedCase.at("input"));
  const Tolerance tolerance = resolveTolerance(sharedCase.value("tolerance", Json(nullptr)));
  const auto difference = firstDifference(sharedCase.at("expected"), actual, tolerance);
  EXPECT_FALSE(difference.has_value()) << *difference << "\nactual: " << actual.dump();
}

INSTANTIATE_TEST_SUITE_P(Regen, RegenSharedCase, ::testing::ValuesIn(caseNames("regen")),
                         [](const ::testing::TestParamInfo<std::string>& param) {
                           std::string name = param.param;
                           std::replace(name.begin(), name.end(), '-', '_');
                           return name;
                         });

// All 48 cases in one run (39 of M43, the 15 with a sketch of M44.1 among them, N46; 9 converted
// from the integration scenarios in M47, N127): nothing is skipped.
TEST(RegenSharedCases, AreAllFortyEightFound) { EXPECT_EQ(caseNames("regen").size(), 48U); }

}  // namespace
}  // namespace tinycad::testing
