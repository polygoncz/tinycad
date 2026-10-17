// The runner of the shared cases document.load (spec 13, "Druhy případů"; the TypeScript twin is
// test/integration/shared-cases/document.test.ts): fromData over the built-in schemas, then
// toData; an error as the paths of its issues, sorted (the order of the checks is no contract).

#include <gtest/gtest.h>

#include <algorithm>
#include <string>
#include <vector>

#include "support/compare.hpp"
#include "support/shared_cases.hpp"
#include "tinycad/document/serialize.hpp"
#include "tinycad/features/builtin.hpp"

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

Json runLoad(const Json& input) {
  const auto loaded = document::fromData(input.at("data"), schemas());
  if (loaded) return {{"ok", {{"data", document::documentDataJson(document::toData(**loaded))}}}};
  std::vector<std::string> paths;
  for (const auto& issue : loaded.error().issues) paths.push_back(issue.path);
  // By bytes, like compareStrings by UTF-16 code units for the ASCII paths.
  std::sort(paths.begin(), paths.end());
  Json issues = Json::array();
  for (const auto& path : paths) issues.push_back({{"path", path}});
  return {{"error", {{"issues", issues}}}};
}

class DocumentSharedCase : public ::testing::TestWithParam<std::string> {};

TEST_P(DocumentSharedCase, MatchesExpected) {
  const Json sharedCase = loadCase("document", GetParam());
  ASSERT_EQ(sharedCase.at("kind").get<std::string>(), "document.load");
  ASSERT_TRUE(sharedCase.contains("expected")) << "'expected' is missing";

  const Json actual = runLoad(sharedCase.at("input"));
  const Tolerance tolerance = resolveTolerance(sharedCase.value("tolerance", Json(nullptr)));
  const auto difference = firstDifference(sharedCase.at("expected"), actual, tolerance);
  EXPECT_FALSE(difference.has_value())
      << GetParam() << ".json: " << sharedCase.at("description").get<std::string>() << "\n"
      << difference.value_or("") << "\nactual: " << actual.dump();
}

std::string testName(const ::testing::TestParamInfo<std::string>& info) {
  std::string name = info.param;
  std::replace(name.begin(), name.end(), '-', '_');
  return name;
}

INSTANTIATE_TEST_SUITE_P(Document, DocumentSharedCase, ::testing::ValuesIn(caseNames("document")),
                         testName);

TEST(DocumentSharedCases, AreFound) { EXPECT_FALSE(caseNames("document").empty()); }

}  // namespace
}  // namespace tinycad::testing
