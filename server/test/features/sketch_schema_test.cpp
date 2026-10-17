// SketchSchema (port of the sketchSchema part of test/unit/features/sketch/sketch.test.ts): the
// params, the defaults and validate = the generic checks + Sketch::parse with its issues at
// entities / constraints and the index.

#include <gtest/gtest.h>

#include <string>
#include <vector>

#include "tinycad/document/schema.hpp"
#include "tinycad/features/builtin.hpp"

namespace tinycad::testing {
namespace {

using core::Json;
using document::ParamIssue;
using document::ParamKind;
using Strings = std::vector<std::string>;

const document::FeatureSchema& sketchSchema() {
  static const document::FeatureSchemaRegistry registry = [] {
    document::FeatureSchemaRegistry r;
    features::registerBuiltInSchemas(r);
    return r;
  }();
  return registry.get("sketch");
}

Json planeRef(const std::string& id) { return {{"kind", "plane"}, {"plane", id}}; }

/** The rectangle 10 × 5 of rectangleData (src/sketch/testing.ts): 8 entities, 4 constraints. */
const Json RECTANGLE_ENTITIES = Json::parse(R"([
  {"kind": "point", "id": "a", "x": 0, "y": 0},
  {"kind": "point", "id": "b", "x": 10, "y": 0},
  {"kind": "point", "id": "c", "x": 10, "y": 5},
  {"kind": "point", "id": "d", "x": 0, "y": 5},
  {"kind": "line", "id": "ab", "p1": "a", "p2": "b"},
  {"kind": "line", "id": "bc", "p1": "b", "p2": "c"},
  {"kind": "line", "id": "cd", "p1": "c", "p2": "d"},
  {"kind": "line", "id": "da", "p1": "d", "p2": "a"}
])");
const Json RECTANGLE_CONSTRAINTS = Json::parse(R"([
  {"kind": "horizontal", "id": "h1", "line": "ab"},
  {"kind": "vertical", "id": "v1", "line": "bc"},
  {"kind": "horizontal", "id": "h2", "line": "cd"},
  {"kind": "vertical", "id": "v2", "line": "da"}
])");

Json withField(Json params, const std::string& key, Json value) {
  params[key] = std::move(value);
  return params;
}

Strings paramsOf(const std::vector<ParamIssue>& issues) {
  Strings out;
  for (const auto& issue : issues) out.push_back(issue.param);
  return out;
}

TEST(SketchSchema, IsVersion1OfTypeSketchWithTheIconPencil) {
  const auto& schema = sketchSchema();
  EXPECT_EQ(schema.type(), "sketch");
  EXPECT_EQ(schema.version(), 1);
  EXPECT_EQ(schema.label(), "sketch.label");
  EXPECT_EQ(schema.icon(), "pencil");
}

TEST(SketchSchema, HasTheParamsPlaneEntitiesConstraintsInThisOrder) {
  const auto& params = sketchSchema().params();
  ASSERT_EQ(params.size(), 3U);
  EXPECT_EQ(params[0].key, "plane");
  EXPECT_EQ(params[0].spec.kind, ParamKind::Planes);
  EXPECT_EQ(params[0].spec.label, "sketch.plane");
  EXPECT_EQ(params[0].spec.min, 1.0);
  EXPECT_EQ(params[0].spec.max, 1.0);
  EXPECT_EQ(params[1].key, "entities");
  EXPECT_EQ(params[1].spec.kind, ParamKind::Data);
  EXPECT_EQ(params[1].spec.label, "sketch.entities");
  EXPECT_EQ(params[2].key, "constraints");
  EXPECT_EQ(params[2].spec.kind, ParamKind::Data);
  EXPECT_EQ(params[2].spec.label, "sketch.constraints");
}

TEST(SketchSchema, DefaultsAreAnEmptySketchOnTheOriginPlaneXyAndPassValidation) {
  const Json defaults = sketchSchema().defaults();
  EXPECT_EQ(defaults, Json::parse(R"({
    "plane": [{"kind": "plane", "plane": "origin/plane:xy"}],
    "entities": [],
    "constraints": []
  })"));
  EXPECT_TRUE(sketchSchema().validate(defaults).empty());
}

TEST(SketchSchema, AcceptsAValidSketch) {
  const Json params = {{"plane", Json::array({planeRef("origin/plane:xy")})},
                       {"entities", RECTANGLE_ENTITIES},
                       {"constraints", RECTANGLE_CONSTRAINTS}};
  EXPECT_TRUE(sketchSchema().validate(params).empty());
}

TEST(SketchSchema, RejectsNoPlaneAndTwoPlanes) {
  const Json defaults = sketchSchema().defaults();
  const auto none = sketchSchema().validate(withField(defaults, "plane", Json::array()));
  ASSERT_EQ(none.size(), 1U);
  EXPECT_EQ(none[0], (ParamIssue{"plane", "param.tooFewRefs", Json{{"min", 1}}}));
  const Json two = Json::array({planeRef("origin/plane:xy"), planeRef("origin/plane:xz")});
  EXPECT_EQ(paramsOf(sketchSchema().validate(withField(defaults, "plane", two))),
            Strings{"plane"});
}

TEST(SketchSchema, TurnsInvalidEntitiesIntoIssuesAtEntitiesWithTheIndex) {
  Json entities = RECTANGLE_ENTITIES;
  // NaN is not JSON; a string coordinate is just as invalid for the parser.
  entities.push_back({{"kind", "point"}, {"id", "e"}, {"x", "NaN"}, {"y", 0}});
  entities.push_back({{"kind", "line"}, {"id", "bad"}, {"p1", "a"}, {"p2", "a"}});
  const auto issues =
      sketchSchema().validate(withField(sketchSchema().defaults(), "entities", entities));
  EXPECT_EQ(issues, (std::vector<ParamIssue>{
                        {"entities", "sketch.invalidEntity", Json{{"index", 8}}},
                        {"entities", "sketch.invalidEntity", Json{{"index", 9}}}}));
}

TEST(SketchSchema, TurnsInvalidConstraintsIntoIssuesAtConstraintsWithTheIndex) {
  Json constraints = Json::array({{{"kind", "horizontal"}, {"id", "h"}, {"line", "a"}}});
  for (const auto& c : RECTANGLE_CONSTRAINTS) constraints.push_back(c);
  constraints.push_back({{"kind", "radius"}, {"id", "r"}, {"curve", "ab"}, {"value", 2}});
  Json params = withField(sketchSchema().defaults(), "entities", RECTANGLE_ENTITIES);
  params["constraints"] = constraints;
  EXPECT_EQ(sketchSchema().validate(params),
            (std::vector<ParamIssue>{
                {"constraints", "sketch.invalidConstraint", Json{{"index", 0}}},
                {"constraints", "sketch.invalidConstraint", Json{{"index", 5}}}}));
}

TEST(SketchSchema, AFieldThatIsNotAnArrayGivesOneIssueWithIndexMinus1) {
  EXPECT_EQ(sketchSchema().validate(withField(sketchSchema().defaults(), "entities",
                                              Json::object())),
            (std::vector<ParamIssue>{{"entities", "sketch.invalidEntity", Json{{"index", -1}}}}));
}

TEST(SketchSchema, ChecksTheSketchDataOnlyWhenBothEntitiesAndConstraintsArePresent) {
  const Json params = {{"plane", Json::array({planeRef("origin/plane:xy")})}, {"entities", 5}};
  EXPECT_EQ(sketchSchema().validate(params),
            (std::vector<ParamIssue>{{"constraints", "param.missing", Json()}}));
}

TEST(SketchSchema, RejectsParamsThatAreNotAnObjectMissingAndUnexpectedParams) {
  EXPECT_FALSE(sketchSchema().validate(Json()).empty());
  Json noConstraints = sketchSchema().defaults();
  noConstraints.erase("constraints");
  EXPECT_EQ(paramsOf(sketchSchema().validate(noConstraints)), Strings{"constraints"});
  EXPECT_EQ(paramsOf(sketchSchema().validate(withField(sketchSchema().defaults(), "extra", 1))),
            Strings{"extra"});
}

}  // namespace
}  // namespace tinycad::testing
