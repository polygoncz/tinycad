// Port of test/unit/ops/dispatcher.test.ts without the subscriber exception tests (decision N21):
// dispatch writes one entry, a failure writes nothing, meta consistency and reentrance.

#include <gtest/gtest.h>

#include <memory>
#include <vector>

#include "ops/testing.hpp"
#include "tinycad/document/serialize.hpp"
#include "tinycad/ops/transaction.hpp"

namespace tinycad::testing {
namespace {

using document::FeatureId;

DocumentOptions twoFeatures() {
  return {.features = {aFeature({.id = "a", .name = "A"}), aFeature({.id = "b", .name = "B"})}};
}

/** Records every entry the dispatcher reports (the hook of decision N21). */
class RecordingListener final : public ops::LogListener {
 public:
  void onAppended(const ops::LogEntry& entry) override { seqs.push_back(entry.seq); }
  std::vector<std::int64_t> seqs;
};

TEST(Dispatch, WritesTheEntryWithInverseDefaultLabelAndTimeFromTheClock) {
  document::FeatureSchemaRegistry schemas;
  auto doc = aDocument(twoFeatures());
  const ops::OpHandlerRegistry handlers(schemas);
  ops::OperationLog log;
  ops::OperationDispatcher dispatcher(*doc, handlers, log, [] { return 1234.0; });
  const auto entry = dispatcher.dispatch(renameOp("a", "X"));
  ASSERT_TRUE(entry.has_value());
  EXPECT_EQ(entry->seq, 1);
  EXPECT_EQ(entry->kind, ops::EntryKind::Do);
  EXPECT_FALSE(entry->target.has_value());
  EXPECT_EQ(entry->op, renameOp("a", "X"));
  EXPECT_EQ(entry->inverse, renameOp("a", "A"));
  EXPECT_EQ(entry->label, "feature.rename");
  EXPECT_EQ(entry->time, 1234.0);
  EXPECT_EQ(log.lastSeq(), 1);
  EXPECT_EQ(doc->feature(FeatureId("a"))->name, "X");
}

TEST(Dispatch, UsesTheLabelFromMetaAndIsNotInATransaction) {
  OpsSession s(twoFeatures());
  EXPECT_EQ(s.dispatcher.dispatch(renameOp("a", "X"), {.label = "Rename"})->label, "Rename");
  EXPECT_EQ(s.dispatcher.dispatch(renameOp("a", "Y"), {.label = ""})->label, "");
  EXPECT_FALSE(s.dispatcher.inTransaction());
}

TEST(Dispatch, TellsTheListenerAboutEveryEntry) {
  auto doc = aDocument(twoFeatures());
  const ops::OpHandlerRegistry handlers(noSchemas());
  ops::OperationLog log;
  ops::OperationDispatcher dispatcher(*doc, handlers, log, [] { return 0.0; });
  RecordingListener listener;
  dispatcher.setListener(&listener);
  RecordingListener other;
  EXPECT_THROW(dispatcher.setListener(&other), core::AssertionError);
  (void)dispatcher.dispatch(renameOp("a", "X"));
  auto tx = dispatcher.begin("t");
  ASSERT_TRUE(tx->apply(renameOp("b", "Y")));
  EXPECT_EQ(listener.seqs, (std::vector<std::int64_t>{1}));
  tx->commit();
  EXPECT_EQ(listener.seqs, (std::vector<std::int64_t>{1, 2}));
  dispatcher.setListener(nullptr);
}

TEST(Dispatch, WritesNothingWhenTheOperationFails) {
  OpsSession s(twoFeatures());
  const auto studio = s.doc->studio();
  const auto result = s.dispatcher.dispatch(renameOp("zzz", "X"));
  ASSERT_FALSE(result.has_value());
  EXPECT_EQ(result.error().path, "featureId");
  EXPECT_EQ(s.log.lastSeq(), 0);
  EXPECT_EQ(s.doc->studio(), studio);
  EXPECT_FALSE(s.undo.canUndo());
}

TEST(Dispatch, RecordsAnOperationThatDoesNotChangeTheDocument) {
  OpsSession s(twoFeatures());
  ASSERT_TRUE(s.dispatcher.dispatch(rollbackOp(2)));
  EXPECT_EQ(s.log.lastSeq(), 1);
}

TEST(DispatchMeta, ChecksTheConsistencyOfKindAndTarget) {
  OpsSession s(twoFeatures());
  ASSERT_TRUE(s.dispatcher.dispatch(renameOp("a", "X")));
  ASSERT_TRUE(s.undo.undo());  // seq 2 is an undo entry
  const auto op = renameOp("a", "Z");
  EXPECT_THROW((void)s.dispatcher.dispatch(op, {.target = 1}), core::AssertionError);
  EXPECT_THROW((void)s.dispatcher.dispatch(op, {.kind = ops::EntryKind::Undo}), core::AssertionError);
  EXPECT_THROW((void)s.dispatcher.dispatch(op, {.kind = ops::EntryKind::Redo}), core::AssertionError);
  EXPECT_THROW((void)s.dispatcher.dispatch(op, {.kind = ops::EntryKind::Undo, .target = 9}),
               core::AssertionError);
  EXPECT_THROW((void)s.dispatcher.dispatch(op, {.kind = ops::EntryKind::Undo, .target = 0}),
               core::AssertionError);
  EXPECT_THROW((void)s.dispatcher.dispatch(op, {.kind = ops::EntryKind::Undo, .target = 2}),
               core::AssertionError);
  EXPECT_EQ(s.log.lastSeq(), 2);
}

TEST(DispatchMeta, AcceptsUndoWithAValidTarget) {
  OpsSession s(twoFeatures());
  ASSERT_TRUE(s.dispatcher.dispatch(renameOp("a", "X")));
  const auto entry = s.dispatcher.dispatch(renameOp("a", "A"), {.kind = ops::EntryKind::Undo, .target = 1});
  ASSERT_TRUE(entry.has_value());
  EXPECT_EQ(entry->target, 1);
}

TEST(Dispatch, IsRefusedWhileATransactionIsOpen) {
  OpsSession s(twoFeatures());
  auto tx = s.dispatcher.begin("t");
  EXPECT_TRUE(s.dispatcher.inTransaction());
  EXPECT_THROW((void)s.dispatcher.dispatch(renameOp("a", "X")), core::AssertionError);
  EXPECT_THROW((void)s.dispatcher.begin("second"), core::AssertionError);
  tx->abort();
  EXPECT_FALSE(s.dispatcher.inTransaction());
  EXPECT_TRUE(s.dispatcher.dispatch(renameOp("a", "X")));
}

/** A listener that dispatches from the hook: allowed, the entry is written by then. */
class DispatchingListener final : public ops::LogListener {
 public:
  explicit DispatchingListener(ops::OperationDispatcher& dispatcher) : dispatcher_(dispatcher) {}
  void onAppended(const ops::LogEntry& entry) override {
    if (entry.seq == 1) result = dispatcher_.dispatch(renameOp("b", "Inner")).has_value();
  }
  bool result = false;

 private:
  ops::OperationDispatcher& dispatcher_;
};

TEST(Dispatch, TheListenerMayDispatch) {
  auto doc = aDocument(twoFeatures());
  const ops::OpHandlerRegistry handlers(noSchemas());
  ops::OperationLog log;
  ops::OperationDispatcher dispatcher(*doc, handlers, log, [] { return 0.0; });
  DispatchingListener listener(dispatcher);
  dispatcher.setListener(&listener);
  ASSERT_TRUE(dispatcher.dispatch(renameOp("a", "Outer")));
  EXPECT_TRUE(listener.result);
  EXPECT_EQ(log.lastSeq(), 2);
  dispatcher.setListener(nullptr);
}

}  // namespace
}  // namespace tinycad::testing
