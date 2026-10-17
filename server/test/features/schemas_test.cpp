// Port of the schema part of test/unit/features/<name>/<name>.test.ts: type, version, label,
// icon, params in TS order, defaults, own rules, the transform migrations, and every VisibleWhen
// (N20) against the TS predicate it replaces on the values of the shared cases and more.

#include <gtest/gtest.h>

#include <cmath>
#include <functional>
#include <numbers>
#include <algorithm>
#include <string>
#include <vector>

#include "tinycad/document/schema.hpp"
#include "tinycad/document/serialize.hpp"
#include "tinycad/features/builtin.hpp"

namespace tinycad::testing {
namespace {

using core::Json;
using document::FeatureSchema;
using Strings = std::vector<std::string>;

const document::FeatureSchemaRegistry& registry() {
  static const document::FeatureSchemaRegistry r = [] {
    document::FeatureSchemaRegistry out;
    features::registerBuiltInSchemas(out);
    return out;
  }();
  return r;
}

Strings keysOf(const FeatureSchema& schema) {
  Strings keys;
  for (const auto& entry : schema.params()) keys.push_back(entry.key);
  return keys;
}

const document::ParamSpec& spec(const std::string& type, const std::string& param) {
  for (const auto& entry : registry().get(type).params()) {
    if (entry.key == param) return entry.spec;
  }
  throw std::runtime_error("no param " + param);
}

Strings codes(const std::vector<document::ParamIssue>& issues) {
  Strings out;
  for (const auto& issue : issues) out.push_back(issue.param + ":" + issue.code);
  return out;
}

TEST(BuiltInSchemas, RegistersTheNineSchemasInPluginOrder) {
  Strings types;
  for (const auto* schema : registry().all()) types.push_back(schema->type());
  EXPECT_EQ(types, (Strings{"box", "cylinder", "boolean", "sketch", "extrude", "revolve", "fillet",
                            "chamfer", "transform"}));
}

struct Identity {
  std::string type;
  int version;
  std::string icon;
  Strings params;
};

class SchemaIdentity : public ::testing::TestWithParam<Identity> {};

TEST_P(SchemaIdentity, HasTheTypeVersionLabelIconAndParamsOfTs) {
  const auto& schema = registry().get(GetParam().type);
  EXPECT_EQ(schema.version(), GetParam().version);
  EXPECT_EQ(schema.label(), GetParam().type + ".label");
  EXPECT_EQ(schema.icon(), GetParam().icon);
  EXPECT_EQ(keysOf(schema), GetParam().params);
  EXPECT_TRUE(document::isJsonObject(schema.defaults()));
  // Every key of the defaults is a param and the other way round.
  Strings defaultKeys;
  const Json defaults = schema.defaults();
  for (const auto& item : defaults.items()) defaultKeys.push_back(item.key());
  Strings sorted = GetParam().params;
  std::sort(sorted.begin(), sorted.end());
  EXPECT_EQ(defaultKeys, sorted);
  // Labels are translation keys of the feature (ADR 0014).
  for (const auto& entry : schema.params()) {
    EXPECT_TRUE(entry.spec.label.starts_with(GetParam().type + ".")) << entry.spec.label;
  }
}

INSTANTIATE_TEST_SUITE_P(
    Features, SchemaIdentity,
    ::testing::Values(
        Identity{"box", 1, "box", {"origin", "width", "depth", "height"}},
        Identity{"cylinder", 1, "cylinder", {"base", "axis", "radius", "height"}},
        Identity{"boolean", 1, "layers-union", {"op", "targets", "tools", "keepTools"}},
        Identity{"sketch", 1, "pencil", {"plane", "entities", "constraints"}},
        Identity{"extrude", 1, "arrow-big-up-lines",
                 {"regions", "operation", "targets", "endType", "distance", "upTo", "flip"}},
        Identity{"revolve", 1, "rotate-360",
                 {"regions", "axis", "operation", "targets", "angle", "flip"}},
        Identity{"fillet", 1, "border-radius", {"edges", "radius"}},
        Identity{"chamfer", 1, "border-corner-square", {"edges", "distance"}},
        Identity{"transform", 3, "arrows-move",
                 {"bodies", "pivot", "pivotPoint", "translate", "rx", "ry", "rz"}}),
    [](const ::testing::TestParamInfo<Identity>& param) { return param.param.type; });

TEST(Defaults, PassValidationOrAskOnlyForReferences) {
  EXPECT_TRUE(registry().get("box").validate(registry().get("box").defaults()).empty());
  EXPECT_TRUE(registry().get("cylinder").validate(registry().get("cylinder").defaults()).empty());
  EXPECT_EQ(codes(registry().get("boolean").validate(registry().get("boolean").defaults())),
            (Strings{"targets:param.tooFewRefs", "tools:param.tooFewRefs"}));
  EXPECT_EQ(codes(registry().get("extrude").validate(registry().get("extrude").defaults())),
            (Strings{"regions:param.tooFewRefs"}));
  EXPECT_EQ(codes(registry().get("revolve").validate(registry().get("revolve").defaults())),
            (Strings{"regions:param.tooFewRefs", "axis:param.tooFewRefs"}));
  EXPECT_EQ(codes(registry().get("transform").validate(registry().get("transform").defaults())),
            (Strings{"bodies:param.tooFewRefs"}));
}

Json bodyRef(const std::string& id) { return {{"kind", "body"}, {"body", id}}; }

Json booleanParams(Json targets, Json tools) {
  return {{"op", "union"}, {"targets", targets}, {"tools", tools}, {"keepTools", false}};
}

TEST(BooleanSchema, RejectsABodyThatIsATargetAndAToolAtItsIndexInTools) {
  const auto& schema = registry().get("boolean");
  const auto issues = schema.validate(booleanParams(
      Json::array({bodyRef("a/body")}), Json::array({bodyRef("b/body"), bodyRef("a/body"),
                                                     bodyRef("a/body:1")})));
  ASSERT_EQ(issues.size(), 1U);
  EXPECT_EQ(issues[0], (document::ParamIssue{"tools", "boolean.sameBody", Json{{"index", 1}}}));
}

TEST(BooleanSchema, ReportsOnlyTheFirstToolThatIsAlsoATarget) {
  const auto issues = registry().get("boolean").validate(booleanParams(
      Json::array({bodyRef("a/body"), bodyRef("b/body")}),
      Json::array({bodyRef("b/body"), bodyRef("a/body")})));
  ASSERT_EQ(issues.size(), 1U);
  EXPECT_EQ(issues[0].params, (Json{{"index", 0}}));
}

TEST(BooleanSchema, ChecksTheSameBodyOnlyWhenBothListsPassedTheShapeChecks) {
  const auto issues = registry().get("boolean").validate(
      booleanParams(Json::array({bodyRef("a/body")}), Json::array({bodyRef("a/body"), 3})));
  EXPECT_EQ(codes(issues), (Strings{"tools:param.invalidRef"}));
}

// --- Transform migrations (src/features/transform/schema.ts) -----------------------------------

Json migrate(int from, const Json& raw) {
  const auto result = registry().get("transform").migrate(from, raw);
  EXPECT_TRUE(result.has_value()) << raw.dump();
  return result.value_or(Json());
}

TEST(TransformSchema, MigratesVersion1ToVersion3WithThePivotAtTheOrigin) {
  const Json v1 = {{"bodies", Json::array({bodyRef("a/body")})},
                   {"translate", {1, 2, 3}},
                   {"axis", "y"},
                   {"angle", 0.5}};
  EXPECT_EQ(migrate(1, v1), (Json{{"bodies", Json::array({bodyRef("a/body")})},
                                  {"translate", {1, 2, 3}},
                                  {"pivot", "origin"},
                                  {"pivotPoint", {0, 0, 0}},
                                  {"rx", 0},
                                  {"ry", 0.5},
                                  {"rz", 0}}));
}

TEST(TransformSchema, LeavesVersion2WithAnUnknownAxisUnchanged) {
  const Json v2 = {{"axis", "w"}, {"angle", 1}, {"pivot", "origin"}};
  EXPECT_EQ(migrate(2, v2), v2);
}

TEST(TransformSchema, RefusesParamsThatAreNotAnObjectAndAnUnknownVersion) {
  const auto& schema = registry().get("transform");
  EXPECT_FALSE(schema.migrate(1, Json::array()).has_value());
  EXPECT_FALSE(schema.migrate(2, Json("x")).has_value());
  EXPECT_FALSE(schema.migrate(4, Json::object()).has_value());
}

// --- VisibleWhen against the TS predicates ----------------------------------------------------

/** A TS predicate over the unchecked value of one param; nullptr = the param is missing. */
using Predicate = std::function<bool(const Json*)>;

/** noneOf of extrude/revolve schema.ts: missing shows, a string not among the options shows. */
Predicate noneOf(Strings options) {
  return [options](const Json* v) {
    if (!v) return true;
    if (!v->is_string()) return false;
    return std::find(options.begin(), options.end(), v->get<std::string>()) == options.end();
  };
}

/** `p[key] === value` with a string value. */
Predicate equals(std::string value) {
  return [value](const Json* v) { return v && v->is_string() && v->get<std::string>() == value; };
}

/** flipApplies of revolve: a number below a full turn. */
Predicate belowFullTurn() {
  return [](const Json* v) {
    return v && v->is_number() && v->get<double>() < 2 * std::numbers::pi - 1e-9;
  };
}

struct Visibility {
  std::string type;
  std::string param;
  std::string tested;
  Predicate predicate;
};

/** The values a param takes in the loop; `discarded` stands for a missing param. */
const std::vector<Json> kValues = {
    Json(Json::value_t::discarded),   Json("new"),      Json("add"),       Json("remove"),     Json("blind"),
    Json("symmetric"), Json("upToFace"), Json("point"),  Json("origin"),     Json("bodiesCenter"),
    Json(3),        Json(nullptr),    Json(true),        Json::array(),      Json::object(),
    Json(0.5),      Json(2 * std::numbers::pi), Json(2 * std::numbers::pi - 1e-10),
    Json(2 * std::numbers::pi - 1e-8), Json(-1),      Json("NEW")};

TEST(VisibleWhen, MatchesTheTsPredicateOfEveryConditionalParam) {
  const std::vector<Visibility> cases = {
      {"extrude", "targets", "operation", noneOf({"new"})},
      {"extrude", "distance", "endType", noneOf({"upToFace"})},
      {"extrude", "upTo", "endType", equals("upToFace")},
      {"extrude", "flip", "endType", equals("blind")},
      {"revolve", "targets", "operation", noneOf({"new"})},
      {"revolve", "flip", "angle", belowFullTurn()},
      {"transform", "pivotPoint", "pivot", equals("point")},
  };
  for (const auto& c : cases) {
    for (const auto& value : kValues) {
      const bool missing = value.is_discarded();
      Json params = {{"other", 1}};
      if (!missing) params[c.tested] = value;
      EXPECT_EQ(document::isParamVisible(spec(c.type, c.param), params),
                c.predicate(missing ? nullptr : &value))
          << c.type << "." << c.param << " with " << (missing ? "missing" : value.dump());
    }
  }
}

TEST(VisibleWhen, OnlyTheConditionalParamsHaveOne) {
  int conditional = 0;
  for (const auto* schema : registry().all()) {
    for (const auto& entry : schema->params()) {
      if (entry.spec.visibleWhen) ++conditional;
    }
  }
  EXPECT_EQ(conditional, 7);
}

}  // namespace
}  // namespace tinycad::testing
