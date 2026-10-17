// Port of test/unit/ops/apply.test.ts: the rollback bar restore (Q029), batches (atomic, nested,
// inverse order), validation on write (M19.1) and the handler migrations (Q035). The subscriber
// exception tests of TS have no C++ counterpart (decision N21); errors are values here.

#include <gtest/gtest.h>

#include <limits>
#include <memory>
#include <string>
#include <vector>

#include "ops/testing.hpp"
#include "tinycad/document/serialize.hpp"
#include "tinycad/ops/apply.hpp"

namespace tinycad::testing {
namespace {

using document::Document;
using document::FeatureId;
using Strings = std::vector<std::string>;

const double kNaN = std::numeric_limits<double>::quiet_NaN();
const double kInf = std::numeric_limits<double>::infinity();

const ops::OpHandlerRegistry& handlers() {
  static const ops::OpHandlerRegistry registry(noSchemas());
  return registry;
}

std::unique_ptr<Document> setup(int rollbackIndex) {
  return aDocument({.features = {aFeature({.id = "a", .name = "A"}), aFeature({.id = "b", .name = "B"}),
                                 aFeature({.id = "c", .name = "C"})},
                    .rollbackIndex = rollbackIndex});
}

Json dataOf(const document::DocumentReader& doc) {
  return document::documentDataJson(document::toData(doc));
}

Strings names(const Document& doc) {
  Strings out;
  for (const auto& f : doc.studio()->features) out.push_back(f->name);
  return out;
}

Json inverseOf(Document& doc, const Json& op) {
  auto result = ops::applyOperation(doc, handlers(), op);
  EXPECT_TRUE(result.has_value()) << (result ? "" : result.error().path + ": " + result.error().message);
  return result.value_or(Json());
}

/** The op fails at `path` and leaves the document exactly as it was (the same StudioPtr). */
void expectRejected(Document& doc, const Json& op, const std::string& path) {
  const auto studio = doc.studio();
  const Json before = dataOf(doc);
  const auto result = ops::applyOperation(doc, handlers(), op);
  ASSERT_FALSE(result.has_value()) << op.dump();
  EXPECT_EQ(result.error().path, path) << result.error().message;
  EXPECT_EQ(doc.studio(), studio);
  EXPECT_EQ(dataOf(doc), before);
}

Json makeOp(const std::string& name, int at) {
  if (name == "add") return addOp(*aFeature("n"), at);
  if (name == "remove") return removeOp(std::string(1, "abc"[at]));
  return moveOp("a", at);
}

TEST(ApplyRollbackBar, TheInverseRestoresTheDataForEveryBarAndPosition) {
  for (const std::string name : {"add", "remove", "move"}) {
    for (int bar = 0; bar <= 3; ++bar) {
      for (int at = 0; at <= (name == "add" ? 3 : 2); ++at) {
        const auto doc = setup(bar);
        const Json before = dataOf(*doc);
        const Json inverse = inverseOf(*doc, makeOp(name, at));
        inverseOf(*doc, inverse);
        EXPECT_EQ(dataOf(*doc), before) << name << "(" << at << ") with bar at " << bar;
      }
    }
  }
}

TEST(ApplyRollbackBar, WrapsTheInverseInABatchWithSetRollbackWhenTheBarMoved) {
  const auto doc = setup(3);
  const Json inverse = inverseOf(*doc, makeOp("add", 0));
  EXPECT_EQ(inverse.at("type"), "batch");
  EXPECT_EQ(inverse.at("ops").at(1), rollbackOp(3));
}

TEST(ApplyRollbackBar, DoesNotWrapRenameSetParamsAndSuppress) {
  for (const int bar : {0, 1, 3}) {
    const auto doc = setup(bar);
    for (const Json& op : {renameOp("b", "X"), setParamsOp("b", {{"size", 7}}), suppressOp("b", true)}) {
      EXPECT_NE(inverseOf(*doc, op).at("type"), "batch") << op.dump();
    }
  }
}

TEST(ApplyRollbackBar, WrapsAddRemoveAndMoveAtEveryBarPosition) {
  for (int bar = 0; bar <= 3; ++bar) {
    for (const std::string name : {"add", "remove", "move"}) {
      const auto doc = setup(bar);
      EXPECT_EQ(inverseOf(*doc, makeOp(name, name == "move" ? 2 : 0)).at("type"), "batch")
          << name << " bar " << bar;
    }
  }
}

TEST(ApplyRollbackBar, DoesNotWrapStudioSetRollback) {
  const auto doc = setup(3);
  EXPECT_EQ(inverseOf(*doc, rollbackOp(1)), rollbackOp(3));
}

TEST(ApplyBatch, InvertsSubOperationsInReverseOrder) {
  const auto doc = setup(3);
  const Json before = dataOf(*doc);
  const Json inverse =
      inverseOf(*doc, batchOp(Json::array({renameOp("a", "A1"), renameOp("a", "A2")})));
  EXPECT_EQ(names(*doc), (Strings{"A2", "B", "C"}));
  EXPECT_EQ(inverse, batchOp(Json::array({renameOp("a", "A1"), renameOp("a", "A")})));
  inverseOf(*doc, inverse);
  EXPECT_EQ(dataOf(*doc), before);
}

TEST(ApplyBatch, HandlesNestedBatches) {
  const auto doc = setup(3);
  const Json before = dataOf(*doc);
  const Json inverse = inverseOf(
      *doc, batchOp(Json::array({renameOp("a", "A1"),
                                 batchOp(Json::array({renameOp("b", "B1"), renameOp("c", "C1")}))})));
  EXPECT_EQ(names(*doc), (Strings{"A1", "B1", "C1"}));
  inverseOf(*doc, inverse);
  EXPECT_EQ(dataOf(*doc), before);
}

TEST(ApplyBatch, AnEmptyBatchChangesNothingAndInvertsToAnEmptyBatch) {
  const auto doc = setup(3);
  const auto studio = doc->studio();
  EXPECT_EQ(inverseOf(*doc, batchOp(Json::array())), batchOp(Json::array()));
  EXPECT_EQ(doc->studio(), studio);
}

TEST(ApplyBatch, IsAtomicAndReportsTheFailingSubOperationsPath) {
  const auto doc = setup(3);
  const Json before = dataOf(*doc);
  const auto result =
      ops::applyOperation(*doc, handlers(), batchOp(Json::array({renameOp("a", "A1"), renameOp("zzz", "x")})));
  ASSERT_FALSE(result.has_value());
  EXPECT_EQ(result.error().path, "ops[1].featureId");
  EXPECT_EQ(dataOf(*doc), before);
}

TEST(ApplyBatch, RevertsWhenAHandlerFails) {
  ops::OpHandlerRegistry registry(noSchemas());
  registry.add(std::make_shared<TestHandler>("test.fail", 1, nullptr, true));
  const auto doc = setup(3);
  const auto result = ops::applyOperation(
      *doc, registry, batchOp(Json::array({renameOp("a", "A1"), Json{{"type", "test.fail"}, {"v", 1}}})));
  ASSERT_FALSE(result.has_value());
  EXPECT_EQ(result.error().path, "ops[1]");
  EXPECT_EQ(names(*doc), (Strings{"A", "B", "C"}));
}

TEST(ApplyValidation, RefusesParamsThatAreNotPlainJson) {
  for (const Json& params : {Json{{"size", kNaN}}, Json{{"size", kInf}}, Json{{"size", -kInf}},
                             Json{{"list", Json::array({Json{{"x", kNaN}}})}}}) {
    const auto doc = setup(3);
    expectRejected(*doc, setParamsOp("b", params), "params");
  }
}

TEST(ApplyValidation, RefusesWhatLoadingWouldRefuse) {
  const auto doc = setup(3);
  expectRejected(*doc, addOp(*aFeature({.id = "n", .params = Json{{"size", kNaN}}}), 0),
                 "feature.params");
  expectRejected(*doc, addOp(*aFeature("a/b"), 0), "feature.id");
  expectRejected(*doc, Json{{"type", "body.setColor"}, {"v", 1}, {"body", "a/body"}, {"color", "#FF0000"}},
                 "color");
  expectRejected(*doc, Json{{"type", "body.setMaterial"}, {"v", 1}, {"body", "a/body"}, {"material", "gold"}},
                 "material");
}

TEST(ApplyValidation, ReportsTheFirstProblemAndListsAllOfThem) {
  const auto doc = setup(3);
  const auto result = ops::applyOperation(
      *doc, handlers(), addOp(*aFeature({.id = "a/b", .params = Json{{"size", kNaN}}}), 0));
  ASSERT_FALSE(result.has_value());
  EXPECT_EQ(result.error().path, "feature.id");
  EXPECT_NE(result.error().message.find("feature.params"), std::string::npos);
}

TEST(ApplyValidation, ValidatesBeforeInvert) {
  const auto doc = setup(3);
  expectRejected(*doc, setParamsOp("zzz", {{"size", kNaN}}), "params");
  expectRejected(*doc, setParamsOp("zzz", {{"size", 1}}), "featureId");
}

TEST(ApplyValidation, ABadSubOperationRevertsTheBatch) {
  const auto doc = setup(3);
  const Json before = dataOf(*doc);
  const auto result = ops::applyOperation(
      *doc, handlers(), batchOp(Json::array({renameOp("a", "A1"), setParamsOp("b", {{"size", kNaN}})})));
  ASSERT_FALSE(result.has_value());
  EXPECT_EQ(result.error().path, "ops[1].params");
  EXPECT_EQ(dataOf(*doc), before);
}

TEST(ApplyValidation, RefusesAnotherVersionThanTheCurrentOne) {
  for (const int v : {3, 1}) {
    const auto doc = setup(3);
    Json op = setParamsOp("b", {{"size", 7}});
    op["v"] = v;
    expectRejected(*doc, op, "v");
  }
  const auto doc = setup(3);
  expectRejected(*doc, Json{{"type", "batch"}, {"v", 2}, {"ops", Json::array({renameOp("a", "A1")})}}, "v");
  // The rename was applied and reverted: equal data, not the same studio.
  Json stale = renameOp("b", "X");
  stale["v"] = 2;
  const Json before = dataOf(*doc);
  const auto result =
      ops::applyOperation(*doc, handlers(), batchOp(Json::array({renameOp("a", "A1"), stale})));
  ASSERT_FALSE(result.has_value());
  EXPECT_EQ(result.error().path, "ops[1].v");
  EXPECT_EQ(dataOf(*doc), before);
}

TEST(ApplyValidation, RefusesABrokenEnvelope) {
  const auto doc = setup(3);
  expectRejected(*doc, Json::array(), "");
  expectRejected(*doc, Json{{"v", 1}}, "type");
  expectRejected(*doc, Json{{"type", "nope"}, {"v", 1}}, "type");
  expectRejected(*doc, Json{{"type", "batch"}, {"v", 1}}, "ops");
}

TEST(ApplyValidation, RefusesAnOperationThatDoesNotFitTheDocument) {
  const auto doc = setup(3);
  expectRejected(*doc, addOp(*aFeature("x"), 4), "index");
  expectRejected(*doc, addOp(*aFeature("a"), 0), "feature.id");
  expectRejected(*doc, moveOp("a", 3), "toIndex");
  expectRejected(*doc, removeOp("zzz"), "featureId");
  expectRejected(*doc, rollbackOp(4), "index");
}

TEST(ApplyValidation, AValidOperationStillPasses) {
  const auto doc = setup(3);
  const Json params = {{"size", 7}, {"list", Json::array({1, Json{{"x", -0.0}}})}, {"ref", nullptr}};
  inverseOf(*doc, setParamsOp("b", params));
  EXPECT_EQ(*doc->feature(FeatureId("b"))->params, params);
}

// Migration of the feature data of old operations (Q035).

std::shared_ptr<TestSchema> boxV2() {
  return std::make_shared<TestSchema>(
      "box", 2, document::ParamSchema{},
      [](int, const Json& raw) -> core::Result<Json, std::string> {
        if (!raw.contains("size")) return core::fail(std::string("no size"));
        return Json{{"width", raw.at("size")}};
      });
}

TEST(ApplyMigration, FeatureAddAndSetParamsMigrateOldFeatureData) {
  document::FeatureSchemaRegistry schemas;
  schemas.add(boxV2());
  const ops::OpHandlerRegistry registry(schemas);
  const auto doc = aDocument();
  ASSERT_TRUE(ops::applyOperation(*doc, registry, addOp(*aFeature({.id = "a", .params = Json{{"size", 3}}}), 0)));
  EXPECT_EQ(doc->feature(FeatureId("a"))->typeVersion, 2);
  EXPECT_EQ(*doc->feature(FeatureId("a"))->params, (Json{{"width", 3}}));

  ASSERT_TRUE(ops::applyOperation(*doc, registry, setParamsOp("a", {{"size", 5}})));
  EXPECT_EQ(*doc->feature(FeatureId("a"))->params, (Json{{"width", 5}}));

  const auto failed = ops::applyOperation(*doc, registry, setParamsOp("a", {{"other", 5}}));
  ASSERT_FALSE(failed.has_value());
  EXPECT_EQ(failed.error().path, "params");
  const auto failedAdd =
      ops::applyOperation(*doc, registry, addOp(*aFeature({.id = "b", .params = Json{{"x", 1}}}), 0));
  ASSERT_FALSE(failedAdd.has_value());
  EXPECT_EQ(failedAdd.error().path, "feature.params");
}

TEST(ApplyMigration, FeatureAddOnTheCurrentVersionKeepsTheData) {
  const auto doc = aDocument();
  const auto f = aFeature({.id = "a", .params = Json{{"size", 3}}});
  ASSERT_TRUE(ops::applyOperation(*doc, handlers(), addOp(*f, 0)));
  EXPECT_TRUE(document::sameFeature(*doc->feature(FeatureId("a")), *f));
}

}  // namespace
}  // namespace tinycad::testing
