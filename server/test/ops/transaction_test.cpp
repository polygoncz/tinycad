// Port of test/unit/ops/transaction.test.ts without the subscriber exception tests (decision
// N21): commit and its compression, abort, the lifecycle, transient steps and merging on apply
// (ADR 0025). Where TS counts `applied` events, a recording test handler counts its applies.

#include <gtest/gtest.h>

#include <map>
#include <memory>
#include <string>
#include <vector>

#include "ops/testing.hpp"
#include "tinycad/document/serialize.hpp"
#include "tinycad/ops/replay.hpp"
#include "tinycad/ops/transaction.hpp"

namespace tinycad::testing {
namespace {

using document::FeatureId;

DocumentOptions twoFeatures() {
  return {.features = {aFeature({.id = "a", .name = "A", .params = Json{{"size", 0}}}),
                       aFeature({.id = "b", .name = "B", .params = Json{{"size", 0}}})}};
}

Json setParams(const std::string& id, int size) { return setParamsOp(id, {{"size", size}}); }

Json dataOf(const document::DocumentReader& doc) {
  return document::documentDataJson(document::toData(doc));
}

TEST(TransactionCommit, Compresses50SetParamsOfOneFeatureIntoOneEntry) {
  OpsSession s(twoFeatures());
  auto tx = s.dispatcher.begin("Drag");
  for (int i = 1; i <= 50; ++i) ASSERT_TRUE(tx->apply(setParams("a", i)));
  const auto entry = tx->commit();
  ASSERT_TRUE(entry.has_value());
  EXPECT_EQ(s.log.lastSeq(), 1);
  EXPECT_EQ(entry->kind, ops::EntryKind::Do);
  EXPECT_EQ(entry->label, "Drag");
  EXPECT_EQ(entry->op, setParams("a", 50));
  EXPECT_EQ(entry->inverse, setParams("a", 0));
}

TEST(TransactionCommit, MakesABatchOfAddAndMergedSetParams) {
  OpsSession s(twoFeatures());
  auto tx = s.dispatcher.begin("Box");
  const auto c = aFeature({.id = "c", .params = Json{{"size", 0}}});
  ASSERT_TRUE(tx->apply(addOp(*c, 2)));
  for (int i = 1; i <= 3; ++i) ASSERT_TRUE(tx->apply(setParams("c", i)));
  const auto entry = tx->commit();
  ASSERT_TRUE(entry.has_value());
  EXPECT_EQ(entry->op, batchOp(Json::array({addOp(*c, 2), setParams("c", 3)})));
  EXPECT_EQ(entry->inverse.at("ops").at(0), setParams("c", 0));
  EXPECT_EQ(entry->inverse.at("ops").at(1).at("type"), "batch");
}

TEST(TransactionCommit, DoesNotMergeNonAdjacentOps) {
  OpsSession s(twoFeatures());
  auto tx = s.dispatcher.begin("x");
  ASSERT_TRUE(tx->apply(setParams("a", 1)));
  ASSERT_TRUE(tx->apply(setParams("b", 1)));
  ASSERT_TRUE(tx->apply(setParams("a", 2)));
  const auto entry = tx->commit();
  ASSERT_TRUE(entry.has_value());
  EXPECT_EQ(entry->op.at("ops").size(), 3U);
}

TEST(TransactionCommit, AnEmptyTransactionReturnsNulloptAndWritesNothing) {
  OpsSession s(twoFeatures());
  EXPECT_FALSE(s.dispatcher.begin("x")->commit().has_value());
  EXPECT_EQ(s.log.lastSeq(), 0);
  EXPECT_FALSE(s.dispatcher.inTransaction());
}

TEST(TransactionAbort, RestoresTheDocumentAndLeavesTheLogUntouched) {
  OpsSession s(twoFeatures());
  const Json before = dataOf(*s.doc);
  auto tx = s.dispatcher.begin("x");
  ASSERT_TRUE(tx->apply(setParams("a", 1)));
  ASSERT_TRUE(tx->apply(removeOp("b")));
  tx->abort();
  EXPECT_EQ(dataOf(*s.doc), before);
  EXPECT_EQ(s.log.lastSeq(), 0);
  EXPECT_FALSE(s.dispatcher.inTransaction());
}

TEST(TransactionLifecycle, AFailingApplyLeavesTheTransactionOpenAndUnchanged) {
  OpsSession s(twoFeatures());
  auto tx = s.dispatcher.begin("x");
  ASSERT_TRUE(tx->apply(setParams("a", 1)));
  const auto studio = s.doc->studio();
  EXPECT_FALSE(tx->apply(setParams("zzz", 1)).has_value());
  EXPECT_EQ(s.doc->studio(), studio);
  EXPECT_TRUE(s.dispatcher.inTransaction());
  EXPECT_EQ(tx->commit()->op, setParams("a", 1));
}

TEST(TransactionLifecycle, EveryCallAfterTheEndThrows) {
  OpsSession s(twoFeatures());
  auto tx = s.dispatcher.begin("x");
  tx->commit();
  EXPECT_TRUE(tx->ended());
  EXPECT_THROW((void)tx->apply(setParams("a", 1)), core::AssertionError);
  EXPECT_THROW((void)tx->applyTransient(rollbackOp(1)), core::AssertionError);
  EXPECT_THROW((void)tx->commit(), core::AssertionError);
  EXPECT_THROW(tx->abort(), core::AssertionError);
  auto tx2 = s.dispatcher.begin("y");
  tx2->abort();
  EXPECT_THROW((void)tx2->commit(), core::AssertionError);
}

TEST(TransactionLifecycle, DestroyingAnOpenTransactionAbortsIt) {
  OpsSession s(twoFeatures());
  const Json before = dataOf(*s.doc);
  {
    auto tx = s.dispatcher.begin("x");
    ASSERT_TRUE(tx->apply(setParams("a", 1)));
  }
  EXPECT_EQ(dataOf(*s.doc), before);
  EXPECT_FALSE(s.dispatcher.inTransaction());
  EXPECT_EQ(s.log.lastSeq(), 0);
}

TEST(TransactionTransient, CommitRevertsTheTransientStepAndWritesOnlyTheLoggedOnes) {
  OpsSession s(twoFeatures());
  auto tx = s.dispatcher.begin("Edit");
  ASSERT_TRUE(tx->applyTransient(rollbackOp(1)));
  EXPECT_EQ(s.doc->studio()->rollbackIndex, 1);
  for (int i = 1; i <= 3; ++i) ASSERT_TRUE(tx->apply(setParams("a", i)));
  const auto entry = tx->commit();
  ASSERT_TRUE(entry.has_value());
  EXPECT_EQ(s.log.lastSeq(), 1);
  EXPECT_EQ(entry->op, setParams("a", 3));
  EXPECT_EQ(entry->inverse, setParams("a", 0));
  EXPECT_EQ(s.doc->studio()->rollbackIndex, 2);
  EXPECT_EQ(*s.doc->feature(FeatureId("a"))->params, (Json{{"size", 3}}));
}

TEST(TransactionTransient, AbortRevertsLoggedAndTransientSteps) {
  OpsSession s(twoFeatures());
  const Json before = dataOf(*s.doc);
  auto tx = s.dispatcher.begin("Edit");
  ASSERT_TRUE(tx->applyTransient(rollbackOp(1)));
  for (int i = 1; i <= 3; ++i) ASSERT_TRUE(tx->apply(setParams("a", i)));
  tx->abort();
  EXPECT_EQ(dataOf(*s.doc), before);
  EXPECT_EQ(s.log.lastSeq(), 0);
}

TEST(TransactionTransient, OnlyTransientStepsWriteNothing) {
  OpsSession s(twoFeatures());
  const Json before = dataOf(*s.doc);
  auto tx = s.dispatcher.begin("Edit");
  ASSERT_TRUE(tx->applyTransient(rollbackOp(1)));
  ASSERT_TRUE(tx->applyTransient(rollbackOp(0)));
  EXPECT_FALSE(tx->commit().has_value());
  EXPECT_EQ(s.log.lastSeq(), 0);
  EXPECT_EQ(dataOf(*s.doc), before);
}

TEST(TransactionTransient, AFailingHandlerLeavesTheTransactionOpenAndUnchanged) {
  OpsSession s(twoFeatures());
  const Json before = dataOf(*s.doc);
  auto tx = s.dispatcher.begin("Edit");
  EXPECT_FALSE(tx->applyTransient(rollbackOp(99)).has_value());
  EXPECT_TRUE(s.dispatcher.inTransaction());
  EXPECT_EQ(dataOf(*s.doc), before);
  ASSERT_TRUE(tx->apply(setParams("a", 1)));
  EXPECT_EQ(tx->commit()->op, setParams("a", 1));
  EXPECT_EQ(s.doc->studio()->rollbackIndex, 2);
}

TEST(TransactionTransient, ReplayingTheLogAfterCommitGivesTheLiveDocument) {
  OpsSession s(twoFeatures());
  auto tx = s.dispatcher.begin("Edit");
  ASSERT_TRUE(tx->applyTransient(rollbackOp(0)));
  for (int i = 1; i <= 3; ++i) ASSERT_TRUE(tx->apply(setParams("b", i)));
  tx->commit();
  OpsSession replayed(twoFeatures());
  ASSERT_TRUE(ops::replayLog(*replayed.doc, s.handlers, s.log.entries()));
  EXPECT_EQ(dataOf(*replayed.doc), dataOf(*s.doc));
}

// --- merging on apply (ADR 0025) --------------------------------------------------------------

/**
 * test.set { key, value }: keeps values per key in itself, records every applied op and merges
 * two sets of one key. Stands in for setParams where TS counts `applied` events.
 */
class RecordingHandler final : public ops::OpHandler {
 public:
  [[nodiscard]] std::string_view type() const override { return "test.set"; }
  [[nodiscard]] int version() const override { return 1; }
  [[nodiscard]] core::Result<ops::Operation, ops::OperationLoadError> invert(
      const document::DocumentReader& /*doc*/, const ops::Operation& op) const override {
    const std::string key = op.at("key").get<std::string>();
    return set(key, values.contains(key) ? values.at(key) : 0);
  }
  core::Result<void, ops::OperationLoadError> apply(document::DocumentWriter& /*doc*/,
                                                    const ops::Operation& op) const override {
    applied.push_back(op);
    values[op.at("key").get<std::string>()] = op.at("value").get<int>();
    return {};
  }
  [[nodiscard]] std::optional<ops::Operation> merge(const ops::Operation& prev,
                                                    const ops::Operation& next) const override {
    if (prev.at("key") != next.at("key")) return std::nullopt;
    return std::optional<ops::Operation>(std::in_place, next);
  }

  static Json set(const std::string& key, int value) {
    return {{"type", "test.set"}, {"v", 1}, {"key", key}, {"value", value}};
  }

  // Test state: a handler is const in the registry.
  mutable std::vector<Json> applied;
  mutable std::map<std::string, int> values;
};

struct RecordingSession {
  RecordingSession() : handlers(noSchemas()) {
    handlers.add(recorder);
  }
  std::shared_ptr<RecordingHandler> recorder = std::make_shared<RecordingHandler>();
  std::unique_ptr<document::Document> doc = aDocument();
  ops::OpHandlerRegistry handlers;
  ops::OperationLog log;
  ops::OperationDispatcher dispatcher{*doc, handlers, log, [] { return 0.0; }};
};

TEST(TransactionMerging, A1000StepsOfOneKeyLeaveOneStepAbortAppliesOneInverse) {
  RecordingSession s;
  auto tx = s.dispatcher.begin("Drag");
  for (int i = 1; i <= 1000; ++i) ASSERT_TRUE(tx->apply(RecordingHandler::set("a", i)));
  s.recorder->applied.clear();
  tx->abort();
  EXPECT_EQ(s.recorder->applied, (std::vector<Json>{RecordingHandler::set("a", 0)}));
  EXPECT_EQ(s.log.lastSeq(), 0);
}

TEST(TransactionMerging, DoesNotMergeStepsOfDifferentKeys) {
  RecordingSession s;
  auto tx = s.dispatcher.begin("x");
  ASSERT_TRUE(tx->apply(RecordingHandler::set("a", 1)));
  ASSERT_TRUE(tx->apply(RecordingHandler::set("b", 2)));
  ASSERT_TRUE(tx->apply(RecordingHandler::set("b", 3)));
  s.recorder->applied.clear();
  tx->abort();
  EXPECT_EQ(s.recorder->applied,
            (std::vector<Json>{RecordingHandler::set("b", 0), RecordingHandler::set("a", 0)}));
}

TEST(TransactionMerging, ATransientStepInBetweenInterruptsMerging) {
  RecordingSession s;
  auto tx = s.dispatcher.begin("x");
  ASSERT_TRUE(tx->apply(RecordingHandler::set("a", 1)));
  ASSERT_TRUE(tx->applyTransient(RecordingHandler::set("t", 5)));
  ASSERT_TRUE(tx->apply(RecordingHandler::set("a", 2)));
  ASSERT_TRUE(tx->apply(RecordingHandler::set("a", 3)));
  s.recorder->applied.clear();
  tx->abort();
  EXPECT_EQ(s.recorder->applied,
            (std::vector<Json>{RecordingHandler::set("a", 1), RecordingHandler::set("t", 0),
                               RecordingHandler::set("a", 0)}));
}

TEST(TransactionMerging, CommitStillMergesLoggedStepsAroundATransientOne) {
  RecordingSession s;
  auto tx = s.dispatcher.begin("x");
  ASSERT_TRUE(tx->apply(RecordingHandler::set("a", 1)));
  ASSERT_TRUE(tx->applyTransient(RecordingHandler::set("t", 5)));
  ASSERT_TRUE(tx->apply(RecordingHandler::set("a", 2)));
  const auto entry = tx->commit();
  ASSERT_TRUE(entry.has_value());
  EXPECT_EQ(entry->op, RecordingHandler::set("a", 2));
  EXPECT_EQ(entry->inverse, RecordingHandler::set("a", 0));
}

}  // namespace
}  // namespace tinycad::testing
