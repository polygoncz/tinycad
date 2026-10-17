// The runner of the shared cases regen (spec 13 "Druhy případů › regen"; the TypeScript twin is
// test/integration/shared-cases/regen.test.ts): a stored document loaded with the built-in
// schemas, regenerated once from scratch by a new Regenerator over a new OcctKernel, described by
// support/regen_describe and compared with the expected output.

#include <gtest/gtest.h>

#include <algorithm>
#include <set>
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

/**
 * The cases with a sketch: the sketch builder comes in M44.1 (decision N46), which deletes this
 * list. A fixed list, not "whatever fails": a new failing case must not hide here.
 */
const std::set<std::string> kSketchCases = {
    "extrude-add-on-top-face",       "extrude-rectangle",
    "extrude-remove-hole",           "extrude-unresolved-region",
    "extrude-up-to-face",            "input-of-extrude-on-top-face",
    "revolve-full-turn-origin-axis", "revolve-full-turn-sketch-line",
    "sketch-bspline-extrude",        "sketch-circular-pattern-extrude",
    "sketch-fitspline-extrude",      "sketch-spline-crossing-warning",
    "sketch-spline-with-hole-extrude", "sketch-text-construction",
    "sketch-text-extrude",
};

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
  if (kSketchCases.contains(GetParam())) GTEST_SKIP() << "a sketch case of M44.1 (N46)";
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

TEST(RegenSharedCases, SkipExactlyTheFifteenSketchCasesOfM441) {
  const auto names = caseNames("regen");
  std::size_t present = 0;
  for (const auto& name : kSketchCases) {
    if (std::find(names.begin(), names.end(), name) != names.end()) ++present;
  }
  EXPECT_EQ(present, 15U);
  EXPECT_EQ(names.size() - present, 24U);
}

}  // namespace
}  // namespace tinycad::testing
