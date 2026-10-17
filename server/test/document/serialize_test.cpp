// Port of test/unit/document/serialize.test.ts: toData / fromData round trip, body metadata,
// migration through the registry, unknown types and broken data with every path.

#include <gtest/gtest.h>

#include <memory>
#include <string>
#include <vector>

#include "document/testing.hpp"
#include "tinycad/document/serialize.hpp"

namespace tinycad::testing {
namespace {

using core::Json;
using document::BodyId;
using document::BodyMaterial;
using document::BodyMeta;
using document::DocumentLoadIssue;
using document::FeatureData;
using document::FeatureSchemaRegistry;
using Strings = std::vector<std::string>;

// Box v2 renamed `size` to `width` and dropped `legacy`.
std::shared_ptr<TestSchema> boxV2() {
  return std::make_shared<TestSchema>(
      "box", 2, document::ParamSchema{},
      [](int fromVersion, const Json& raw) -> core::Result<Json, std::string> {
        if (fromVersion != 1) return core::fail("Unsupported version " + std::to_string(fromVersion));
        if (!raw.contains("size") || !raw.at("size").is_number()) {
          return core::fail(std::string("size must be a number"));
        }
        return Json{{"width", raw.at("size")}};
      });
}

FeatureSchemaRegistry registryOf(std::shared_ptr<TestSchema> schema) {
  FeatureSchemaRegistry registry;
  registry.add(std::move(schema));
  return registry;
}

Json box(const std::string& id, int width) {
  return {{"id", id},   {"type", "box"},         {"typeVersion", 2},
          {"name", id}, {"params", {{"width", width}}}, {"suppressed", false}};
}

Json rawData(const Json& features, std::optional<int> rollbackIndex = {}) {
  return {{"meta", {{"id", "d1"}, {"name", "Doc"}, {"createdAt", 0}}},
          {"studio",
           {{"features", features},
            {"rollbackIndex", rollbackIndex.value_or(static_cast<int>(features.size()))}}}};
}

std::unique_ptr<document::Document> load(const Json& data,
                                         const FeatureSchemaRegistry& registry = registryOf(boxV2())) {
  auto result = document::fromData(data, registry);
  if (!result) {
    ADD_FAILURE() << "unexpected issue at " << result.error().issues.at(0).path;
    return nullptr;
  }
  return std::move(*result);
}

Strings issuePaths(const Json& data, const FeatureSchemaRegistry& registry = registryOf(boxV2())) {
  const auto result = document::fromData(data, registry);
  if (result) {
    ADD_FAILURE() << "expected fromData to fail";
    return {};
  }
  Strings paths;
  for (const DocumentLoadIssue& issue : result.error().issues) paths.push_back(issue.path);
  return paths;
}

TEST(Serialize, ToDataSharesTheStudio) {
  const auto doc = load(rawData(Json::array({box("a", 1), box("b", 2)}), 1));
  const auto data = document::toData(*doc);
  EXPECT_EQ(data.studio, doc->studio());
  EXPECT_EQ(data.meta.name, "Doc");
}

TEST(Serialize, FromDataOfDocumentDataJsonIsTheIdentity) {
  const Json raw = rawData(Json::array({box("a", 1), box("b", 2), box("c", 3)}), 2);
  const auto doc = load(raw);
  const Json once = document::documentDataJson(document::toData(*doc));
  EXPECT_EQ(once, raw);
  const auto again = load(once);
  EXPECT_EQ(document::documentDataJson(document::toData(*again)), once);
}

TEST(Serialize, KeepsBodyMetadataThroughJsonInCanonicalForm) {
  Json raw = rawData(Json::array());
  raw["studio"]["bodies"] = {{"a/body", {{"name", "Lid"}, {"hidden", false}}},
                             {"b/body:1", {{"hidden", false}}},
                             {"c/body", {{"color", "#00ff00"}, {"material", "steel"}}},
                             {"d/body", {{"material", "plastic"}}}};
  const auto doc = load(raw);
  EXPECT_EQ(doc->bodyMeta(BodyId("a/body")), (BodyMeta{.name = "Lid"}));
  EXPECT_EQ(doc->studio()->bodies.size(), 2U);
  EXPECT_EQ(doc->bodyMeta(BodyId("c/body")),
            (BodyMeta{.color = "#00ff00", .material = BodyMaterial::Steel}));
  const Json out = document::documentDataJson(document::toData(*doc));
  EXPECT_EQ(out["studio"]["bodies"],
            (Json{{"a/body", {{"name", "Lid"}}},
                  {"c/body", {{"color", "#00ff00"}, {"material", "steel"}}}}));
}

TEST(Serialize, AnEmptyBodiesObjectIsAbsentInJson) {
  Json raw = rawData(Json::array());
  raw["studio"]["bodies"] = Json::object();
  const Json out = document::documentDataJson(document::toData(*load(raw)));
  EXPECT_FALSE(out["studio"].contains("bodies"));
}

TEST(SerializeBodies, ReportsBrokenValuesWithTheirPaths) {
  const std::vector<std::pair<Json, std::string>> cases = {
      {Json{{"a/body", 1}}, "studio.bodies['a/body']"},
      {Json{{"a/body", {{"name", ""}}}}, "studio.bodies['a/body'].name"},
      {Json{{"a/body", {{"hidden", "yes"}}}}, "studio.bodies['a/body'].hidden"},
      {Json{{"a/body", {{"color", "#FF0000"}}}}, "studio.bodies['a/body'].color"},
      {Json{{"a/body", {{"material", 1}}}}, "studio.bodies['a/body'].material"},
      {Json{{"a/body", {{"extra", 1}}}}, "studio.bodies['a/body'].extra"},
      {Json{{"a/sketch", {{"name", "x"}}}}, "studio.bodies['a/sketch']"},
  };
  for (const auto& [bodies, path] : cases) {
    Json raw = rawData(Json::array());
    raw["studio"]["bodies"] = bodies;
    EXPECT_EQ(issuePaths(raw), Strings{path}) << bodies.dump();
  }
  Json raw = rawData(Json::array());
  raw["studio"]["bodies"] = nullptr;
  EXPECT_EQ(issuePaths(raw), Strings{"studio.bodies"});
}

TEST(SerializeMigration, LoadsAVersion1FeatureThroughTheVersion2Schema) {
  const Json v1 = {{"id", "a"},       {"type", "box"},
                   {"typeVersion", 1}, {"name", "Box 1"},
                   {"params", {{"size", 5}, {"legacy", true}}}, {"suppressed", false}};
  const auto doc = load(rawData(Json::array({v1})));
  const auto& f = *doc->studio()->features[0];
  EXPECT_EQ(f.typeVersion, 2);
  EXPECT_EQ(*f.params, (Json{{"width", 5}}));
  EXPECT_EQ(f.name, "Box 1");
}

TEST(SerializeMigration, ReportsAFailingMigrationAndANewerVersion) {
  Json v1 = {{"id", "a"},       {"type", "box"},
             {"typeVersion", 1}, {"name", "Box 1"},
             {"params", {{"size", "x"}}}, {"suppressed", false}};
  EXPECT_EQ(issuePaths(rawData(Json::array({v1}))), Strings{"studio.features[0].params"});
  Json v3 = box("a", 1);
  v3["typeVersion"] = 3;
  EXPECT_EQ(issuePaths(rawData(Json::array({v3}))), Strings{"studio.features[0].typeVersion"});
}

TEST(SerializeMigration, ReportsAMigrationThatDoesNotReturnAnObject) {
  const auto broken = std::make_shared<TestSchema>(
      "box", 2, document::ParamSchema{},
      [](int, const Json&) -> core::Result<Json, std::string> { return Json(42); });
  Json v1 = box("a", 1);
  v1["typeVersion"] = 1;
  EXPECT_EQ(issuePaths(rawData(Json::array({v1})), registryOf(broken)),
            Strings{"studio.features[0].params"});
}

TEST(MigrateFeatureData, KeepsCurrentAndUnknownDataUnchanged) {
  const auto registry = registryOf(boxV2());
  const FeatureData current{"box", 2, Json{{"width", 1}}};
  const auto same = document::migrateFeatureData(registry, current);
  ASSERT_TRUE(same.has_value());
  EXPECT_EQ(same->params, current.params);
  EXPECT_EQ(same->typeVersion, 2);
  const FeatureData unknown{"teleport", 7, Json{{"any", 1}}};
  const auto kept = document::migrateFeatureData(registry, unknown);
  ASSERT_TRUE(kept.has_value());
  EXPECT_EQ(kept->typeVersion, 7);
}

TEST(MigrateFeatureData, MigratesAndReportsWithPathsRelativeToTheFeature) {
  const auto registry = registryOf(boxV2());
  const auto migrated =
      document::migrateFeatureData(registry, {"box", 1, Json{{"size", 5}, {"legacy", true}}});
  ASSERT_TRUE(migrated.has_value());
  EXPECT_EQ(migrated->typeVersion, 2);
  EXPECT_EQ(migrated->params, (Json{{"width", 5}}));
  EXPECT_EQ(document::migrateFeatureData(registry, {"box", 3, Json::object()}).error().path,
            "typeVersion");
  EXPECT_EQ(document::migrateFeatureData(registry, {"box", 1, Json{{"size", "x"}}}).error().path,
            "params");
}

TEST(SerializeUnknownTypes, KeepsThemUnchanged) {
  const Json teleport = {{"id", "t"},        {"type", "teleport"},
                         {"typeVersion", 7}, {"name", "T"},
                         {"params", {{"any", {1, 2}}}}, {"suppressed", true}};
  const auto doc = load(rawData(Json::array({teleport})));
  EXPECT_EQ(document::documentDataJson(document::toData(*doc))["studio"]["features"][0], teleport);
}

TEST(SerializeBroken, ReportsEveryProblemWithItsPath) {
  EXPECT_EQ(issuePaths(Json::array()), Strings{""});
  EXPECT_EQ(issuePaths(Json{{"meta", {{"id", ""}, {"name", 1}}}, {"studio", nullptr}}),
            (Strings{"meta.id", "meta.name", "meta.createdAt", "studio"}));
  Json slash = box("a/b", 1);
  EXPECT_EQ(issuePaths(rawData(Json::array({slash}))), Strings{"studio.features[0].id"});
  Json origin = box("origin", 1);
  EXPECT_EQ(issuePaths(rawData(Json::array({origin}))), Strings{"studio.features[0].id"});
  EXPECT_EQ(issuePaths(rawData(Json::array({box("a", 1), box("a", 2)}))),
            Strings{"studio.features[1].id"});
  EXPECT_EQ(issuePaths(Json{{"meta", {{"id", "d"}, {"name", "n"}, {"createdAt", 0}}},
                            {"studio", Json::object()}}),
            Strings{"studio.features"});
  // A typeVersion of 2.0 is a whole number (spec 13).
  Json fraction = box("a", 1);
  fraction["typeVersion"] = 2.0;
  EXPECT_TRUE(document::fromData(rawData(Json::array({fraction})), registryOf(boxV2())).has_value());
  fraction["typeVersion"] = 1.5;
  EXPECT_EQ(issuePaths(rawData(Json::array({fraction}))), Strings{"studio.features[0].typeVersion"});
  EXPECT_EQ(issuePaths(rawData(Json::array({box("a", 1)}), 2)), Strings{"studio.rollbackIndex"});
}

}  // namespace
}  // namespace tinycad::testing
