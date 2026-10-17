// The runner of the shared cases schema.validate and schema.visibleWhen (spec 13, "Druhy
// případů"; the TypeScript twin is test/integration/shared-cases/schema.test.ts, N150): the issues
// of the params of a built-in feature by the validate of its schema, sorted by param, code and the
// canonical JSON of params; whether a param applies by isParamVisible over the declarative
// VisibleWhen (N20). The reference: the TS runner drops the codes of the rules only the server
// checks (SERVER_ONLY_CODES, spec 03), this one checks every issue.

#include <gtest/gtest.h>

#include <algorithm>
#include <cmath>
#include <stdexcept>
#include <string>
#include <vector>

#include "support/compare.hpp"
#include "support/shared_cases.hpp"
#include "tinycad/document/schema.hpp"
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

/**
 * JSON as JSON.stringify writes it with the keys sorted (nlohmann keeps object keys sorted by
 * bytes; the keys are ASCII): integral numbers within 2^53 without '.0'. "" for null, so an issue
 * without params sorts first (canonicalJson in support/sort.ts).
 */
std::string canonicalJson(const Json& value) {
  if (value.is_null()) return "";
  if (value.is_number_float()) {
    const double d = value.get<double>();
    if (std::trunc(d) == d && std::abs(d) <= 9007199254740992.0) {
      return std::to_string(static_cast<long long>(d));
    }
    return value.dump();
  }
  if (value.is_array()) {
    std::string out = "[";
    for (std::size_t i = 0; i < value.size(); ++i) {
      if (i > 0) out += ",";
      out += value[i].is_null() ? "null" : canonicalJson(value[i]);
    }
    return out + "]";
  }
  if (value.is_object()) {
    std::string out = "{";
    bool first = true;
    for (const auto& item : value.items()) {
      if (!first) out += ",";
      first = false;
      out += Json(item.key()).dump() + ":" +
             (item.value().is_null() ? "null" : canonicalJson(item.value()));
    }
    return out + "}";
  }
  return value.dump();
}

/** The order of compareIssues (support/sort.ts): total, so std::sort needs no stability. */
bool issueBefore(const document::ParamIssue& a, const document::ParamIssue& b) {
  if (a.param != b.param) return a.param < b.param;
  if (a.code != b.code) return a.code < b.code;
  return canonicalJson(a.params) < canonicalJson(b.params);
}

Json runValidate(const Json& input) {
  const auto& schema = schemas().get(input.at("type").get<std::string>());
  auto issues = schema.validate(input.contains("params") ? input.at("params") : Json());
  std::sort(issues.begin(), issues.end(), issueBefore);
  Json out = Json::array();
  for (const auto& issue : issues) out.push_back(document::issueJson(issue));
  return {{"ok", {{"issues", out}}}};
}

Json runVisibleWhen(const Json& input) {
  const auto& schema = schemas().get(input.at("type").get<std::string>());
  const std::string param = input.at("param").get<std::string>();
  for (const auto& entry : schema.params()) {
    if (entry.key == param) {
      return {{"ok", {{"visible", document::isParamVisible(entry.spec, input.at("params"))}}}};
    }
  }
  throw std::runtime_error("feature '" + schema.type() + "' has no param '" + param + "'");
}

class SchemaSharedCase : public ::testing::TestWithParam<std::string> {};

TEST_P(SchemaSharedCase, MatchesExpected) {
  const Json sharedCase = loadCase("schema", GetParam());
  const std::string kind = sharedCase.at("kind").get<std::string>();
  ASSERT_TRUE(sharedCase.contains("expected")) << "'expected' is missing";

  Json actual;
  if (kind == "schema.validate") {
    actual = runValidate(sharedCase.at("input"));
  } else if (kind == "schema.visibleWhen") {
    actual = runVisibleWhen(sharedCase.at("input"));
  } else {
    FAIL() << "a case of another kind: " << kind;
  }
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

INSTANTIATE_TEST_SUITE_P(Schema, SchemaSharedCase, ::testing::ValuesIn(caseNames("schema")),
                         testName);

// No folder or no case would leave the suite empty and green.
TEST(SchemaSharedCases, AreFound) { EXPECT_FALSE(caseNames("schema").empty()); }

}  // namespace
}  // namespace tinycad::testing
