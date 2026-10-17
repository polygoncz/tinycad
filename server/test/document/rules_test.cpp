// checkParamRules (src/document/rules.cpp, M49): the declarative rule DisjointRefs over a small
// test schema. The same cases are in test/unit/document/rules.test.ts of the client.

#include <gtest/gtest.h>

#include <string>
#include <vector>

#include "tinycad/document/schema.hpp"

namespace tinycad::testing {
namespace {

using core::Json;
using document::ParamIssue;
using document::ParamKind;
using document::ParamRule;
using document::ParamSchema;
using document::ParamSpec;

Json body(const std::string& id) { return {{"kind", "body"}, {"body", id}}; }

Json topo(const std::string& bodyId, const std::string& name) {
  return {{"kind", "topo"}, {"body", bodyId}, {"name", name}};
}

ParamRule disjoint(std::string param, std::string other) {
  return {.kind = ParamRule::Kind::DisjointRefs,
          .code = "test.same",
          .param = std::move(param),
          .other = std::move(other)};
}

/** targets, tools (bodies), from, to (topo), hidden (bodies, shown only with mode "both"). */
ParamSchema schema() {
  ParamSpec hidden{.kind = ParamKind::Bodies, .label = "h"};
  hidden.visibleWhen = document::VisibleWhen{.param = "mode",
                                             .test = document::VisibleWhen::Test::EqualsAny,
                                             .values = {Json("both")}};
  return {{"targets", {.kind = ParamKind::Bodies, .label = "t"}},
          {"tools", {.kind = ParamKind::Bodies, .label = "o"}},
          {"from", {.kind = ParamKind::Topo, .label = "f", .entity = document::TopoEntity::Edge}},
          {"to", {.kind = ParamKind::Topo, .label = "g", .entity = document::TopoEntity::Edge}},
          {"mode", {.kind = ParamKind::Enum, .label = "m", .options = {{"one", "m.one"},
                                                                       {"both", "m.both"}}}},
          {"hidden", hidden}};
}

/** validateAgainstSchema + checkParamRules, the way a FeatureSchema validates. */
std::vector<ParamIssue> validate(const std::vector<ParamRule>& rules, const Json& params) {
  auto issues = document::validateAgainstSchema(schema(), params);
  document::checkParamRules(schema(), rules, params, issues);
  return issues;
}

Json params(Json targets, Json tools, std::string mode = "one") {
  return {{"targets", std::move(targets)},
          {"tools", std::move(tools)},
          {"from", Json::array()},
          {"to", Json::array()},
          {"mode", std::move(mode)}};
}

TEST(CheckParamRules, ReportsTheFirstItemOfParamThatIsAlsoInOtherAtItsIndex) {
  const auto issues =
      validate({disjoint("tools", "targets")},
               params(Json::array({body("a/body"), body("b/body")}),
                      Json::array({body("c/body"), body("b/body"), body("a/body")})));
  ASSERT_EQ(issues.size(), 1U);
  EXPECT_EQ(issues[0], (ParamIssue{"tools", "test.same", Json{{"index", 1}}}));
}

TEST(CheckParamRules, ReportsNothingForDisjointLists) {
  EXPECT_TRUE(validate({disjoint("tools", "targets")},
                       params(Json::array({body("a/body")}), Json::array({body("a/body:1")})))
                  .empty());
}

TEST(CheckParamRules, ComparesTopoReferencesByBodyAndName) {
  Json p = params(Json::array(), Json::array());
  p["from"] = Json::array({topo("a/body", "e1"), topo("a/body", "e2")});
  p["to"] = Json::array({topo("a/body", "e2"), topo("b/body", "e1")});
  const auto issues = validate({disjoint("to", "from")}, p);
  ASSERT_EQ(issues.size(), 1U);
  EXPECT_EQ(issues[0], (ParamIssue{"to", "test.same", Json{{"index", 0}}}));

  p["to"] = Json::array({topo("b/body", "e1"), topo("a/body", "e3")});
  EXPECT_TRUE(validate({disjoint("to", "from")}, p).empty());
}

TEST(CheckParamRules, IgnoresExtraFieldsOfTheReferences) {
  Json tagged = body("a/body");
  tagged["note"] = "x";
  const auto issues = validate({disjoint("tools", "targets")},
                               params(Json::array({body("a/body")}), Json::array({tagged})));
  ASSERT_EQ(issues.size(), 1U);
  EXPECT_EQ(issues[0].code, "test.same");
}

TEST(CheckParamRules, SkipsAHiddenParam) {
  Json p = params(Json::array({body("a/body")}), Json::array());
  p["hidden"] = Json::array({body("a/body")});
  EXPECT_TRUE(validate({disjoint("hidden", "targets")}, p).empty());

  p["mode"] = "both";
  const auto issues = validate({disjoint("hidden", "targets")}, p);
  ASSERT_EQ(issues.size(), 1U);
  EXPECT_EQ(issues[0], (ParamIssue{"hidden", "test.same", Json{{"index", 0}}}));
}

TEST(CheckParamRules, SkipsWhenTheGenericChecksReportedOtherOrParam) {
  // A broken item in other: only the generic issue, no rule issue.
  auto issues = validate({disjoint("tools", "targets")},
                         params(Json::array({body("a/body"), 3}), Json::array({body("a/body")})));
  ASSERT_EQ(issues.size(), 1U);
  EXPECT_EQ(issues[0].param, "targets");
  EXPECT_EQ(issues[0].code, "param.invalidRef");

  // A duplicate in param.
  issues = validate({disjoint("tools", "targets")},
                    params(Json::array({body("a/body")}),
                           Json::array({body("a/body"), body("a/body")})));
  ASSERT_EQ(issues.size(), 1U);
  EXPECT_EQ(issues[0].code, "param.duplicateRef");
}

TEST(CheckParamRules, SkipsWhenTheParamsObjectWasReported) {
  // An issue at "" (in practice: params not an object) stops every rule.
  std::vector<ParamIssue> issues = {ParamIssue{"", "param.wrongType", nullptr}};
  const Json p = params(Json::array({body("a/body")}), Json::array({body("a/body")}));
  document::checkParamRules(schema(), {disjoint("tools", "targets")}, p, issues);
  EXPECT_EQ(issues.size(), 1U);
}

TEST(CheckParamRules, IgnoresIssuesAtOtherParams) {
  Json p = params(Json::array({body("a/body")}), Json::array({body("a/body")}));
  p["extra"] = 1;
  const auto issues = validate({disjoint("tools", "targets")}, p);
  ASSERT_EQ(issues.size(), 2U);
  EXPECT_EQ(issues[0].code, "param.unexpected");
  EXPECT_EQ(issues[1].code, "test.same");
}

TEST(CheckParamRules, ReportsNothingWhenTheParamsAreNotAnObject) {
  for (const Json& raw : {Json(nullptr), Json(3), Json::array(), Json("x")}) {
    std::vector<ParamIssue> issues;
    document::checkParamRules(schema(), {disjoint("tools", "targets")}, raw, issues);
    EXPECT_TRUE(issues.empty()) << raw.dump();
  }
}

TEST(CheckParamRules, ReportsEveryRuleInOrder) {
  Json p = params(Json::array({body("a/body")}), Json::array({body("a/body")}));
  p["from"] = Json::array({topo("a/body", "e1")});
  p["to"] = Json::array({topo("a/body", "e1")});
  const auto issues = validate({disjoint("to", "from"), disjoint("tools", "targets")}, p);
  ASSERT_EQ(issues.size(), 2U);
  EXPECT_EQ(issues[0].param, "to");
  EXPECT_EQ(issues[1].param, "tools");
}

}  // namespace
}  // namespace tinycad::testing
