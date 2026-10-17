// Port of test/unit/document/validate.test.ts and ref-kinds.test.ts: the generic checks of
// validateAgainstSchema per ParamSpec kind, references, exclusive bounds and conditional params.

#include <gtest/gtest.h>

#include <limits>
#include <string>
#include <vector>

#include "tinycad/document/schema.hpp"

namespace tinycad::testing {
namespace {

using core::Json;
using document::ParamIssue;
using document::ParamKind;
using document::ParamSchema;
using document::ParamSpec;
using document::VisibleWhen;

/** The issues of a single param `p`: { code, params } as JSON objects. */
std::vector<Json> check(const ParamSpec& spec, const Json& value) {
  std::vector<Json> out;
  for (const ParamIssue& issue : document::validateAgainstSchema({{"p", spec}}, Json{{"p", value}})) {
    EXPECT_EQ(issue.param, "p");
    Json json = document::issueJson(issue);
    json.erase("param");
    out.push_back(json);
  }
  return out;
}

void ok(const ParamSpec& spec, const Json& value) {
  EXPECT_EQ(check(spec, value), std::vector<Json>{}) << value.dump();
}

void bad(const ParamSpec& spec, const Json& value, const std::string& code,
         const Json& params = nullptr) {
  Json expected = {{"code", code}};
  if (!params.is_null()) expected["params"] = params;
  EXPECT_EQ(check(spec, value), std::vector<Json>{expected}) << value.dump();
}

const double kInf = std::numeric_limits<double>::infinity();

Json body(const std::string& id) { return {{"kind", "body"}, {"body", id}}; }

TEST(ValidateParamsObject, AcceptsParamsThatMatchTheSchema) {
  const ParamSchema schema = {{"width", {.kind = ParamKind::Length, .label = "w", .defaultValue = 10}},
                              {"depth", {.kind = ParamKind::Length, .label = "d", .defaultValue = 10}}};
  EXPECT_TRUE(document::validateAgainstSchema(schema, Json{{"width", 1}, {"depth", 2}}).empty());
}

TEST(ValidateParamsObject, RejectsParamsThatAreNotAnObject) {
  const ParamSchema schema = {{"width", {.kind = ParamKind::Length, .label = "w"}}};
  for (const Json& value : {Json(nullptr), Json(3), Json::array(), Json("x")}) {
    const auto issues = document::validateAgainstSchema(schema, value);
    ASSERT_EQ(issues.size(), 1U);
    EXPECT_EQ(issues[0], (ParamIssue{"", "param.wrongType", nullptr}));
  }
}

TEST(ValidateParamsObject, ReportsMissingAndUnexpectedParams) {
  const ParamSchema schema = {{"width", {.kind = ParamKind::Length, .label = "w"}}};
  const auto issues = document::validateAgainstSchema(schema, Json{{"extra", 1}});
  ASSERT_EQ(issues.size(), 2U);
  EXPECT_EQ(issues[0], (ParamIssue{"width", "param.missing", nullptr}));
  EXPECT_EQ(issues[1], (ParamIssue{"extra", "param.unexpected", nullptr}));
}

TEST(ValidateKinds, LengthAndAngleWithinMinMax) {
  for (const ParamKind kind : {ParamKind::Length, ParamKind::Angle}) {
    const ParamSpec spec{.kind = kind, .label = "L", .defaultValue = 1, .min = 0.0, .max = 10.0};
    ok(spec, 0);
    ok(spec, 10);
    bad(spec, -1, "param.belowMin", {{"min", 0}});
    bad(spec, 11, "param.aboveMax", {{"max", 10}});
    bad(spec, "5", "param.wrongType");
    bad(spec, kInf, "param.wrongType");
  }
}

TEST(ValidateKinds, NumberHonoursInteger) {
  const ParamSpec spec{.kind = ParamKind::Number, .label = "N", .defaultValue = 1, .min = 1.0,
                       .integer = true};
  ok(spec, 3);
  ok(spec, 3.0);
  bad(spec, 2.5, "param.notInteger");
  bad(spec, 0, "param.belowMin", {{"min", 1}});
  ok(ParamSpec{.kind = ParamKind::Number, .label = "N", .defaultValue = 1}, 2.5);
}

TEST(ValidateKinds, BooleanEnumPointData) {
  const ParamSpec boolean{.kind = ParamKind::Boolean, .label = "B", .defaultValue = false};
  ok(boolean, true);
  bad(boolean, 1, "param.wrongType");

  const ParamSpec choice{.kind = ParamKind::Enum, .label = "E", .defaultValue = "new",
                         .options = {{"new", "e.new"}, {"add", "e.add"}}};
  ok(choice, "add");
  bad(choice, "remove", "param.unknownOption");
  bad(choice, 1, "param.unknownOption");

  const ParamSpec point{.kind = ParamKind::Point, .label = "P", .defaultValue = {0, 0, 0}};
  ok(point, {1, 2, 3});
  bad(point, {1, 2}, "param.wrongType");
  bad(point, Json::array({1, 2, std::numeric_limits<double>::quiet_NaN()}), "param.wrongType");
  bad(point, Json{{"x", 1}, {"y", 2}, {"z", 3}}, "param.wrongType");

  const ParamSpec data{.kind = ParamKind::Data, .label = "D"};
  ok(data, nullptr);
  ok(data, Json{{"anything", {1, 2}}});
  EXPECT_EQ(document::validateAgainstSchema({{"p", data}}, Json::object()).size(), 1U);
}

TEST(ValidateReferences, BodiesWithCountLimits) {
  const ParamSpec spec{.kind = ParamKind::Bodies, .label = "B", .min = 1.0, .max = 2.0};
  const Json topo = {{"kind", "topo"}, {"body", "f1/body"}, {"name", "x"}};
  ok(spec, Json::array({body("f1/body")}));
  ok(spec, Json::array({body("f1/body"), body("f2/body")}));
  bad(spec, Json::array(), "param.tooFewRefs", {{"min", 1}});
  bad(spec, Json::array({body("f1/body"), body("f2/body"), body("f1/body:1")}),
      "param.tooManyRefs", {{"max", 2}});
  bad(spec, Json::array({body("f1/body"), topo}), "param.invalidRef", {{"index", 1}});
  bad(spec, body("f1/body"), "param.wrongType");
}

TEST(ValidateReferences, AnEmptyListIsFineWithoutMinButTheKeyMustBeThere) {
  const ParamSpec spec{.kind = ParamKind::Bodies, .label = "B"};
  ok(spec, Json::array());
  const auto issues = document::validateAgainstSchema({{"p", spec}}, Json::object());
  ASSERT_EQ(issues.size(), 1U);
  EXPECT_EQ(issues[0].code, "param.missing");
}

TEST(ValidateReferences, TopoRegionAndPlanes) {
  const ParamSpec topo{.kind = ParamKind::Topo, .label = "T", .entity = document::TopoEntity::Edge};
  ok(topo, Json::array({{{"kind", "topo"}, {"body", "f1/body"}, {"name", "e1"}}}));
  bad(topo, Json::array({{{"kind", "topo"}, {"body", "f1/body"}, {"name", ""}}}),
      "param.invalidRef", {{"index", 0}});

  const ParamSpec region{.kind = ParamKind::Region, .label = "R"};
  ok(region, Json::array({{{"kind", "region"}, {"sketch", "s1"}, {"region", "r1"}}}));
  bad(region,
      Json::array({{{"kind", "region"}, {"sketch", "s1"}, {"region", "r1"}},
                   {{"kind", "region"}, {"sketch", "s1"}, {"region", "r1"}, {"x", 1}}}),
      "param.duplicateRef", {{"index", 1}});

  const ParamSpec planes{.kind = ParamKind::Planes, .label = "P", .max = 1.0};
  ok(planes, Json::array({{{"kind", "plane"}, {"plane", "origin/plane:xy"}}}));
  ok(planes, Json::array({{{"kind", "topo"}, {"body", "a/body"}, {"name", "f1"}}}));
  bad(planes, Json::array({{{"kind", "plane"}, {"plane", "origin/body"}}}), "param.invalidRef",
      {{"index", 0}});
  bad(planes,
      Json::array({{{"kind", "plane"}, {"plane", "origin/plane:xy"}},
                   {{"kind", "plane"}, {"plane", "origin/plane:xz"}}}),
      "param.tooManyRefs", {{"max", 1}});
}

TEST(ValidateReferences, ChecksInvalidRefFirstThenDuplicateRefThenTheCounts) {
  const ParamSpec spec{.kind = ParamKind::Bodies, .label = "B", .min = 3.0, .max = 1.0};
  bad(spec, Json::array({body("a/body"), body("a/body"), Json{{"kind", "body"}}}),
      "param.invalidRef", {{"index", 2}});
  bad(spec, Json::array({body("a/body"), body("a/body")}), "param.duplicateRef", {{"index", 1}});
  bad(spec, Json::array({body("a/body"), body("b/body")}), "param.tooFewRefs", {{"min", 3}});
}

TEST(ValidateReferences, AxisIsASingleRequiredReference) {
  const ParamSpec axis{.kind = ParamKind::Axis, .label = "A"};
  bad(axis, nullptr, "param.tooFewRefs", {{"min", 1}});
  ok(axis, Json{{"kind", "axis"}, {"axis", "origin/axis:z"}});
  ok(axis, Json{{"kind", "sketchEntity"}, {"sketch", "s1"}, {"entity", "l1"}});
  bad(axis, Json::array({Json{{"kind", "axis"}, {"axis", "origin/axis:z"}}}), "param.invalidRef");
  bad(axis, Json{{"kind", "body"}, {"body", "a/body"}}, "param.invalidRef");
  EXPECT_EQ(document::validateAgainstSchema({{"p", axis}}, Json::object())[0].code,
            "param.missing");
}

TEST(ValidateExclusiveBounds, ExclusiveMinAndMax) {
  for (const ParamKind kind : {ParamKind::Length, ParamKind::Angle, ParamKind::Number}) {
    const ParamSpec low{.kind = kind, .label = "L", .defaultValue = 1, .min = 0.0, .exclusiveMin = true};
    bad(low, 0, "param.atOrBelowMin", {{"min", 0}});
    bad(low, -0.0, "param.atOrBelowMin", {{"min", 0}});
    bad(low, -1, "param.atOrBelowMin", {{"min", 0}});
    ok(low, 1e-9);
    const ParamSpec high{.kind = kind, .label = "L", .defaultValue = 1, .max = 10.0, .exclusiveMax = true};
    bad(high, 10, "param.atOrAboveMax", {{"max", 10}});
    bad(high, 11, "param.atOrAboveMax", {{"max", 10}});
    ok(high, 9.999);
  }
}

TEST(ValidateExclusiveBounds, ExclusiveWithoutMinOrMaxHasNoEffect) {
  const ParamSpec spec{.kind = ParamKind::Length, .label = "L", .defaultValue = 1,
                       .exclusiveMin = true, .exclusiveMax = true};
  ok(spec, -1e9);
  ok(spec, 0);
  ok(spec, 1e9);
}

// A schema in the style of Extrude (M13): targets only for add/remove/intersect.
ParamSchema conditionalSchema() {
  ParamSpec targets{.kind = ParamKind::Bodies, .label = "x.targets", .min = 1.0};
  targets.visibleWhen = VisibleWhen{.param = "operation",
                                    .test = VisibleWhen::Test::EqualsNone,
                                    .values = {Json("new")}};
  return {{"operation", {.kind = ParamKind::Enum, .label = "x.operation", .defaultValue = "new",
                         .options = {{"new", "n"}, {"add", "a"}}}},
          {"targets", targets}};
}

TEST(ValidateConditional, AHiddenParamIsNeitherRequiredNorCheckedNorUnexpected) {
  const auto schema = conditionalSchema();
  EXPECT_TRUE(document::validateAgainstSchema(schema, Json{{"operation", "new"}}).empty());
  EXPECT_TRUE(document::validateAgainstSchema(
                  schema, Json{{"operation", "new"}, {"targets", "garbage"}})
                  .empty());
}

TEST(ValidateConditional, AVisibleParamIsCheckedAsUsual) {
  const auto schema = conditionalSchema();
  auto issues = document::validateAgainstSchema(schema, Json{{"operation", "add"}});
  ASSERT_EQ(issues.size(), 1U);
  EXPECT_EQ(issues[0].code, "param.missing");
  issues = document::validateAgainstSchema(schema, Json{{"operation", "add"}, {"targets", Json::array()}});
  ASSERT_EQ(issues.size(), 1U);
  EXPECT_EQ(issues[0].code, "param.tooFewRefs");
}

}  // namespace
}  // namespace tinycad::testing
