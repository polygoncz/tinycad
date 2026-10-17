// Port of test/unit/ops/upcast.test.ts and parse-entry.test.ts: loading operations and log
// entries from outside with the paths of their problems.

#include <gtest/gtest.h>

#include <limits>
#include <memory>
#include <string>
#include <utility>
#include <vector>

#include "ops/testing.hpp"
#include "tinycad/ops/parse_entry.hpp"
#include "tinycad/ops/upcast.hpp"

namespace tinycad::testing {
namespace {

const ops::OpHandlerRegistry& handlers() {
  static const ops::OpHandlerRegistry registry(noSchemas());
  return registry;
}

/** A registry with test.ping of version 2 and an optional upcast. */
std::unique_ptr<ops::OpHandlerRegistry> registryWith(TestHandler::Upcast upcast = nullptr) {
  auto registry = std::make_unique<ops::OpHandlerRegistry>(noSchemas());
  registry->add(std::make_shared<TestHandler>("test.ping", 2, std::move(upcast)));
  return registry;
}

ops::Operation migrate(int from, const ops::Operation& raw) {
  EXPECT_EQ(from, 1);
  return {{"type", "test.ping"}, {"v", 2}, {"n", raw.at("n").get<int>() * 10}};
}

std::string errorPath(const ops::OpHandlerRegistry& registry, const Json& raw) {
  const auto result = ops::upcastOperation(registry, raw);
  return result ? std::string("<ok>") : result.error().path;
}

TEST(UpcastOperation, ReturnsTheCurrentVersionUnchanged) {
  const Json raw = renameOp("a", "x");
  EXPECT_EQ(ops::upcastOperation(handlers(), raw).value(), raw);
}

TEST(UpcastOperation, MigratesAnOlderVersionWithUpcast) {
  EXPECT_EQ(ops::upcastOperation(*registryWith(migrate), Json{{"type", "test.ping"}, {"v", 1}, {"n", 4}})
                .value(),
            (Json{{"type", "test.ping"}, {"v", 2}, {"n", 40}}));
}

TEST(UpcastOperation, UpcastsFeatureSetParamsVersion1To2WithTypeVersion1) {
  const Json raw = {{"type", "feature.setParams"}, {"v", 1}, {"featureId", "a"}, {"params", {{"size", 2}}}};
  EXPECT_EQ(ops::upcastOperation(handlers(), raw).value(), setParamsOp("a", {{"size", 2}}));
  EXPECT_EQ(errorPath(handlers(), Json{{"type", "feature.setParams"}, {"v", 1}, {"featureId", "a"}}),
            "params");
}

TEST(UpcastOperation, FailsWithoutUpcastOnANewerVersionAndOnAnUnknownType) {
  EXPECT_EQ(errorPath(*registryWith(), Json{{"type", "test.ping"}, {"v", 1}}), "v");
  EXPECT_EQ(errorPath(handlers(), Json{{"type", "feature.rename"}, {"v", 2}}), "v");
  EXPECT_EQ(errorPath(handlers(), Json{{"type", "nope"}, {"v", 1}}), "type");
}

TEST(UpcastOperation, ReportsABrokenEnvelope) {
  const std::vector<std::pair<Json, std::string>> cases = {
      {Json(nullptr), ""},
      {Json::array(), ""},
      {Json("x"), ""},
      {Json{{"v", 1}}, "type"},
      {Json{{"type", 5}, {"v", 1}}, "type"},
      {Json{{"type", "feature.rename"}}, "v"},
      {Json{{"type", "feature.rename"}, {"v", 0}}, "v"},
      {Json{{"type", "feature.rename"}, {"v", 1.5}}, "v"},
      {Json{{"type", "feature.rename"}, {"v", "1"}}, "v"},
  };
  for (const auto& [raw, path] : cases) EXPECT_EQ(errorPath(handlers(), raw), path) << raw.dump();
}

TEST(UpcastOperation, UpcastsABatchRecursively) {
  const Json raw = batchOp(Json::array(
      {Json{{"type", "test.ping"}, {"v", 1}, {"n", 1}},
       batchOp(Json::array({Json{{"type", "test.ping"}, {"v", 1}, {"n", 2}}}))}));
  EXPECT_EQ(ops::upcastOperation(*registryWith(migrate), raw).value(),
            batchOp(Json::array({Json{{"type", "test.ping"}, {"v", 2}, {"n", 10}},
                                 batchOp(Json::array({Json{{"type", "test.ping"}, {"v", 2}, {"n", 20}}}))})));
}

TEST(UpcastOperation, ReportsErrorsInsideABatchWithAComposedPath) {
  EXPECT_EQ(errorPath(handlers(), batchOp(Json::array({renameOp("a", "x"), renameOp("a", "y"),
                                                       Json{{"type", "feature.rename"}, {"v", 0}}}))),
            "ops[2].v");
  EXPECT_EQ(errorPath(handlers(), batchOp(Json::array({batchOp(Json::array({nullptr}))}))),
            "ops[0].ops[0]");
  EXPECT_EQ(errorPath(handlers(), Json{{"type", "batch"}, {"v", 1}, {"ops", 3}}), "ops");
  EXPECT_EQ(errorPath(handlers(), Json{{"type", "batch"}, {"v", 2}, {"ops", Json::array()}}), "v");
}

/**
 * `depth` batches nested in each other around a rename (depth 0: the rename alone). Moves only:
 * copying (an initializer list copies) a very deep value would recurse.
 */
Json nestedBatches(int depth) {
  Json op = renameOp("a", "x");
  for (int i = 0; i < depth; ++i) {
    Json outer = batchOp(Json::array());
    outer["ops"].push_back(std::move(op));
    op = std::move(outer);
  }
  return op;
}

TEST(UpcastOperation, AcceptsBatchesNestedUpToTheLimitAndRefusesDeeperOnesAtTheirPath) {
  EXPECT_EQ(errorPath(handlers(), nestedBatches(ops::MAX_BATCH_DEPTH)), "<ok>");
  // The 65th batch is at ops[0] of the 64th: 64 times 'ops[0]'.
  std::string path = "ops[0]";
  for (int i = 1; i < ops::MAX_BATCH_DEPTH; ++i) path += ".ops[0]";
  EXPECT_EQ(errorPath(handlers(), nestedBatches(ops::MAX_BATCH_DEPTH + 1)), path);
}

TEST(UpcastOperation, ADeeplyNestedLogEntryIsAnErrorNotAStackOverflow) {
  Json entry = {{"seq", 1}, {"kind", "do"}, {"inverse", renameOp("a", "A")},
                {"label", "deep"}, {"time", 0}};
  entry["op"] = nestedBatches(100'000);
  const auto parsed = ops::parseLogEntry(handlers(), entry);
  ASSERT_FALSE(parsed.has_value());
  EXPECT_TRUE(parsed.error().path.starts_with("op.ops[0]")) << parsed.error().path.substr(0, 40);
}

TEST(UpcastOperation, AssertsWhenUpcastReturnsAWrongVersion) {
  const auto bad = registryWith([](int, const ops::Operation&) -> ops::Operation {
    return {{"type", "test.ping"}, {"v", 1}};
  });
  EXPECT_THROW((void)ops::upcastOperation(*bad, Json{{"type", "test.ping"}, {"v", 1}}),
               core::AssertionError);
}

// --- parseLogEntry ---------------------------------------------------------------------------

const Json kOp = renameOp("f1", "New");
const Json kInverse = renameOp("f1", "Old");
const Json kDo = {{"seq", 1}, {"kind", "do"}, {"op", kOp}, {"inverse", kInverse},
                  {"label", "Rename"}, {"time", 1000}};

Json with(Json raw, const std::string& key, Json value) {
  raw[key] = std::move(value);
  return raw;
}

Json without(Json raw, const std::string& key) {
  raw.erase(key);
  return raw;
}

const Json kUndo = with(with(with(with(kDo, "seq", 2), "kind", "undo"), "target", 1), "op", kInverse);
const Json kRedo = with(with(with(kDo, "seq", 3), "kind", "redo"), "target", 1);

TEST(ParseLogEntry, AcceptsValidEntriesAndKeepsTheKnownFieldsOnly) {
  for (const Json& raw : {kDo, with(kUndo, "inverse", kOp), kRedo}) {
    const auto entry = ops::parseLogEntry(handlers(), raw);
    ASSERT_TRUE(entry.has_value()) << raw.dump();
    EXPECT_EQ(ops::logEntryJson(*entry), raw);
  }
  const auto extra = ops::parseLogEntry(handlers(), with(with(kDo, "docId", "d1"), "extra", true));
  ASSERT_TRUE(extra.has_value());
  EXPECT_EQ(ops::logEntryJson(*extra), kDo);
}

TEST(ParseLogEntry, RejectsBrokenEntriesAtTheirPaths) {
  const double nan = std::numeric_limits<double>::quiet_NaN();
  const std::vector<std::pair<Json, std::string>> cases = {
      {Json(nullptr), ""},
      {Json::array(), ""},
      {without(kDo, "seq"), "seq"},
      {with(kDo, "seq", 0), "seq"},
      {with(kDo, "seq", 1.5), "seq"},
      {with(kDo, "seq", "1"), "seq"},
      {without(kDo, "kind"), "kind"},
      {with(kDo, "kind", "redo-all"), "kind"},
      {without(kDo, "label"), "label"},
      {with(kDo, "label", 3), "label"},
      {without(kDo, "time"), "time"},
      {with(kDo, "time", nan), "time"},
      {with(kDo, "time", "1000"), "time"},
      {with(with(kDo, "target", 1), "seq", 2), "target"},
      {without(kUndo, "target"), "target"},
      {with(kUndo, "target", 0), "target"},
      {with(kUndo, "target", 2), "target"},
      {with(kRedo, "target", 4), "target"},
      {with(kRedo, "target", 1.5), "target"},
      {without(kDo, "op"), "op"},
      {without(kDo, "inverse"), "inverse"},
      {with(kDo, "op", with(kOp, "featureId", "")), "op.featureId"},
      {with(kDo, "inverse", with(kInverse, "name", 1)), "inverse.name"},
      {with(kDo, "op", with(kOp, "v", 2)), "op.v"},
      {with(kDo, "inverse", Json{{"type", "nope"}, {"v", 1}}), "inverse.type"},
      {with(kDo, "op", batchOp(Json::array({with(kOp, "v", 0)}))), "op.ops[0].v"},
  };
  for (const auto& [raw, path] : cases) {
    const auto entry = ops::parseLogEntry(handlers(), raw);
    ASSERT_FALSE(entry.has_value()) << raw.dump();
    EXPECT_EQ(entry.error().path, path) << raw.dump();
  }
}

TEST(ParseLogEntry, UpcastsAnOlderOperationVersionInsideTheEntry) {
  const auto registry = registryWith([](int, const ops::Operation& raw) {
    ops::Operation out = raw;
    out["v"] = 2;
    return out;
  });
  const auto entry = ops::parseLogEntry(
      *registry, with(with(kDo, "op", Json{{"type", "test.ping"}, {"v", 1}}), "inverse",
                      Json{{"type", "test.ping"}, {"v", 2}}));
  ASSERT_TRUE(entry.has_value());
  EXPECT_EQ(entry->op, (Json{{"type", "test.ping"}, {"v", 2}}));
}

}  // namespace
}  // namespace tinycad::testing
