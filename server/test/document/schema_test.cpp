// Port of test/unit/document/schema.test.ts and evaluate.test.ts: the schema registry, the
// declarative VisibleWhen (N20) and evaluateParams.

#include <gtest/gtest.h>

#include <cmath>
#include <limits>
#include <numbers>
#include <memory>

#include "document/testing.hpp"
#include "tinycad/core/result.hpp"
#include "tinycad/document/schema.hpp"

namespace tinycad::testing {
namespace {

using core::Json;
using document::FeatureSchemaRegistry;
using document::ParamKind;
using document::ParamSpec;
using document::VisibleWhen;

std::shared_ptr<TestSchema> schema(const std::string& type, int version = 1,
                                   TestSchema::Migrate migrate = nullptr) {
  return std::make_shared<TestSchema>(type, version, document::ParamSchema{}, std::move(migrate));
}

TestSchema::Migrate identity() {
  return [](int, const Json& raw) -> core::Result<Json, std::string> { return raw; };
}

TEST(FeatureSchemaRegistry, RegistersAndFindsSchemasByTypeInOrder) {
  FeatureSchemaRegistry registry;
  registry.add(schema("box"));
  registry.add(schema("cylinder"));
  EXPECT_EQ(registry.get("box").type(), "box");
  EXPECT_EQ(registry.find("sphere"), nullptr);
  EXPECT_THROW((void)registry.get("sphere"), core::AssertionError);
  const auto all = registry.all();
  ASSERT_EQ(all.size(), 2U);
  EXPECT_EQ(all[0]->type(), "box");
  EXPECT_EQ(all[1]->type(), "cylinder");
}

TEST(FeatureSchemaRegistry, RejectsDuplicateTypes) {
  FeatureSchemaRegistry registry;
  registry.add(schema("box"));
  EXPECT_THROW(registry.add(schema("box")), core::AssertionError);
}

TEST(FeatureSchemaRegistry, RequiresMigrateOnceVersionIsAbove1) {
  FeatureSchemaRegistry registry;
  EXPECT_THROW(registry.add(schema("box", 2)), core::AssertionError);
  registry.add(schema("box", 2, identity()));
  EXPECT_EQ(registry.get("box").version(), 2);
}

TEST(FeatureSchemaRegistry, RejectsAVersionBelow1) {
  FeatureSchemaRegistry registry;
  EXPECT_THROW(registry.add(schema("box", 0)), core::AssertionError);
}

ParamSpec withVisibility(VisibleWhen when) {
  ParamSpec spec{.kind = ParamKind::Boolean, .label = "x.flip", .defaultValue = false};
  spec.visibleWhen = std::move(when);
  return spec;
}

TEST(IsParamVisible, IsTrueWithoutVisibleWhen) {
  const ParamSpec spec{.kind = ParamKind::Length, .label = "x"};
  EXPECT_TRUE(document::isParamVisible(spec, Json::object()));
  EXPECT_TRUE(document::isParamVisible(spec, Json(nullptr)));
}

TEST(IsParamVisible, EqualsAnyHidesAMissingParam) {
  const auto spec = withVisibility({.param = "pivot",
                                    .test = VisibleWhen::Test::EqualsAny,
                                    .values = {Json("point")}});
  EXPECT_TRUE(document::isParamVisible(spec, Json{{"pivot", "point"}}));
  EXPECT_FALSE(document::isParamVisible(spec, Json{{"pivot", "origin"}}));
  EXPECT_FALSE(document::isParamVisible(spec, Json::object()));
  EXPECT_FALSE(document::isParamVisible(spec, Json{{"pivot", 1}}));
  EXPECT_FALSE(document::isParamVisible(spec, Json::array()));
}

TEST(IsParamVisible, EqualsNoneShowsAMissingParamAndHidesAnotherType) {
  const auto spec = withVisibility({.param = "operation",
                                    .test = VisibleWhen::Test::EqualsNone,
                                    .values = {Json("new")}});
  EXPECT_TRUE(document::isParamVisible(spec, Json{{"operation", "add"}}));
  EXPECT_FALSE(document::isParamVisible(spec, Json{{"operation", "new"}}));
  EXPECT_TRUE(document::isParamVisible(spec, Json::object()));
  EXPECT_FALSE(document::isParamVisible(spec, Json{{"operation", 3}}));
  EXPECT_FALSE(document::isParamVisible(spec, Json{{"operation", nullptr}}));
  // Not an object: the tested value counts as missing.
  EXPECT_TRUE(document::isParamVisible(spec, Json("x")));
}

TEST(IsParamVisible, LessThanWantsAFiniteNumberBelowTheLimit) {
  const auto spec = withVisibility({.param = "angle",
                                    .test = VisibleWhen::Test::LessThan,
                                    .limit = 2 * std::numbers::pi - 1e-9});
  EXPECT_TRUE(document::isParamVisible(spec, Json{{"angle", 1}}));
  EXPECT_FALSE(document::isParamVisible(spec, Json{{"angle", 2 * std::numbers::pi}}));
  EXPECT_FALSE(document::isParamVisible(spec, Json{{"angle", "1"}}));
  EXPECT_FALSE(document::isParamVisible(spec, Json::object()));
  EXPECT_FALSE(document::isParamVisible(
      spec, Json{{"angle", -std::numeric_limits<double>::infinity()}}));
}

std::shared_ptr<TestSchema> widthSchema() {
  return std::make_shared<TestSchema>(
      "box", 1,
      document::ParamSchema{{"width", {.kind = ParamKind::Length, .label = "w", .defaultValue = 1,
                                       .min = 0.0, .exclusiveMin = true}}});
}

TEST(EvaluateParams, PassesValidParamsThroughWithNoIssues) {
  const auto result = document::evaluateParams(*widthSchema(), Json{{"width", 2}});
  ASSERT_TRUE(result.params.has_value());
  EXPECT_EQ(*result.params, (Json{{"width", 2}}));
  EXPECT_TRUE(result.issues.empty());
}

TEST(EvaluateParams, GivesNoParamsAndTheIssuesForInvalidParams) {
  const auto result = document::evaluateParams(*widthSchema(), Json{{"width", 0}});
  EXPECT_FALSE(result.params.has_value());
  ASSERT_EQ(result.issues.size(), 1U);
  EXPECT_EQ(result.issues[0].code, "param.atOrBelowMin");
  EXPECT_FALSE(document::evaluateParams(*widthSchema(), Json(3)).params.has_value());
}

TEST(IssueJson, WritesParamsOnlyWhenNotEmptyWithIntegralNumbersAsIntegers) {
  EXPECT_EQ(document::issueJson({"width", "param.missing", nullptr}),
            (Json{{"param", "width"}, {"code", "param.missing"}}));
  const Json json = document::issueJson({"width", "param.atOrBelowMin", Json{{"min", 0.0}}});
  EXPECT_TRUE(json.at("params").at("min").is_number_integer());
}

}  // namespace
}  // namespace tinycad::testing
