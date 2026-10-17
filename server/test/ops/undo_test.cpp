// Port of test/unit/ops/undo.test.ts without the event tests (decision N21): undo and redo over
// the dispatcher, document.rename outside undo, rebuildUndoStacks and reopening.

#include <gtest/gtest.h>

#include <limits>
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
using Seqs = std::vector<std::int64_t>;

DocumentOptions twoFeatures() {
  return {.features = {aFeature({.id = "a", .name = "A"}), aFeature({.id = "b", .name = "B"})}};
}

std::string nameOf(const document::Document& doc, const std::string& id) {
  return doc.feature(FeatureId(id))->name;
}

Json renameDocument(const std::string& name) {
  return {{"type", "document.rename"}, {"v", 1}, {"name", name}};
}

Json dataOf(const document::DocumentReader& doc) {
  return document::documentDataJson(document::toData(doc));
}

TEST(Undo, WalksDoUndoRedoAndKeepsTheStacksInSync) {
  OpsSession s(twoFeatures());
  ASSERT_TRUE(s.dispatcher.dispatch(renameOp("a", "X")));
  ASSERT_TRUE(s.dispatcher.dispatch(renameOp("a", "Y")));
  EXPECT_EQ(s.undo.stacks(), (ops::UndoStacks{{1, 2}, {}}));

  ASSERT_TRUE(s.undo.undo());
  EXPECT_EQ(nameOf(*s.doc, "a"), "X");
  EXPECT_EQ(s.undo.stacks(), (ops::UndoStacks{{1}, {2}}));
  ASSERT_TRUE(s.undo.undo());
  EXPECT_EQ(nameOf(*s.doc, "a"), "A");
  ASSERT_TRUE(s.undo.redo());
  EXPECT_EQ(nameOf(*s.doc, "a"), "X");
  ASSERT_TRUE(s.undo.redo());
  EXPECT_EQ(nameOf(*s.doc, "a"), "Y");
  EXPECT_EQ(s.undo.stacks(), (ops::UndoStacks{{1, 2}, {}}));

  const auto entries = s.log.entries();
  ASSERT_EQ(entries.size(), 6U);
  const std::vector<ops::EntryKind> kinds = {ops::EntryKind::Do,   ops::EntryKind::Do,
                                             ops::EntryKind::Undo, ops::EntryKind::Undo,
                                             ops::EntryKind::Redo, ops::EntryKind::Redo};
  const std::vector<std::optional<std::int64_t>> targets = {std::nullopt, std::nullopt, 2, 1, 1, 2};
  for (std::size_t i = 0; i < entries.size(); ++i) {
    EXPECT_EQ(entries[i].kind, kinds[i]) << i;
    EXPECT_EQ(entries[i].target, targets[i]) << i;
  }
  EXPECT_EQ(entries[2].label, "feature.rename");
}

TEST(Undo, ANewChangeAfterUndoClearsRedo) {
  OpsSession s(twoFeatures());
  ASSERT_TRUE(s.dispatcher.dispatch(renameOp("a", "X")));
  ASSERT_TRUE(s.undo.undo());
  EXPECT_TRUE(s.undo.canRedo());
  ASSERT_TRUE(s.dispatcher.dispatch(renameOp("b", "Z")));
  EXPECT_FALSE(s.undo.canRedo());
  EXPECT_THROW((void)s.undo.redo(), core::AssertionError);
  EXPECT_EQ(s.undo.stacks(), (ops::UndoStacks{{3}, {}}));
}

TEST(Undo, ThrowsOnEmptyStacksAndLeavesTheLogAlone) {
  OpsSession s(twoFeatures());
  EXPECT_THROW((void)s.undo.undo(), core::AssertionError);
  EXPECT_THROW((void)s.undo.redo(), core::AssertionError);
  EXPECT_EQ(s.log.lastSeq(), 0);
}

TEST(Undo, IsBlockedDuringATransaction) {
  OpsSession s(twoFeatures());
  ASSERT_TRUE(s.dispatcher.dispatch(renameOp("a", "X")));
  auto tx = s.dispatcher.begin("t");
  EXPECT_FALSE(s.undo.canUndo());
  EXPECT_THROW((void)s.undo.undo(), core::AssertionError);
  tx->abort();
  EXPECT_TRUE(s.undo.canUndo());
}

TEST(Undo, UndoOfFeatureRemoveBringsBackTheFeatureAndTheRollbackBar) {
  OpsSession s({.features = {aFeature("a"), aFeature("b"), aFeature("c")}, .rollbackIndex = 2});
  const Json before = dataOf(*s.doc);
  ASSERT_TRUE(s.dispatcher.dispatch(removeOp("a")));
  EXPECT_EQ(s.doc->studio()->rollbackIndex, 1);
  ASSERT_TRUE(s.undo.undo());
  EXPECT_EQ(dataOf(*s.doc), before);
}

TEST(Undo, AFailedUndoChangesNeitherTheLogNorTheStacks) {
  auto doc = aDocument({.features = {aFeature({.id = "b", .name = "B"})}});
  const ops::OpHandlerRegistry handlers(noSchemas());
  ops::LogEntry broken;
  broken.seq = 1;
  broken.op = renameOp("b", "B");
  broken.inverse = setParamsOp("b", {{"size", std::numeric_limits<double>::quiet_NaN()}});
  broken.label = "Broken";
  ops::OperationLog log({broken});
  ops::OperationDispatcher dispatcher(*doc, handlers, log, [] { return 0.0; });
  ops::UndoManager undo(dispatcher, log);
  const auto studio = doc->studio();
  const auto result = undo.undo();
  ASSERT_FALSE(result.has_value());
  EXPECT_EQ(result.error().path, "params");
  EXPECT_EQ(log.lastSeq(), 1);
  EXPECT_EQ(undo.stacks(), (ops::UndoStacks{{1}, {}}));
  EXPECT_EQ(doc->studio(), studio);
}

TEST(UndoDocumentRename, StaysOutOfUndo) {
  OpsSession s(twoFeatures());
  ASSERT_TRUE(s.dispatcher.dispatch(renameOp("a", "X")));
  const auto before = s.undo.stacks();
  ASSERT_TRUE(s.dispatcher.dispatch(renameDocument("Part")));
  EXPECT_EQ(s.undo.stacks(), before);
  ASSERT_TRUE(s.undo.undo());
  EXPECT_EQ(nameOf(*s.doc, "a"), "A");
  EXPECT_EQ(s.doc->meta().name, "Part");
  EXPECT_FALSE(s.undo.canUndo());
}

TEST(UndoDocumentRename, DoesNotClearTheRedoStack) {
  OpsSession s(twoFeatures());
  ASSERT_TRUE(s.dispatcher.dispatch(renameOp("a", "X")));
  ASSERT_TRUE(s.undo.undo());
  ASSERT_TRUE(s.dispatcher.dispatch(renameDocument("Part")));
  EXPECT_TRUE(s.undo.canRedo());
  ASSERT_TRUE(s.undo.redo());
  EXPECT_EQ(nameOf(*s.doc, "a"), "X");
  EXPECT_EQ(s.doc->meta().name, "Part");
}

TEST(UndoDocumentRename, RebuildUndoStacksSkipsItTheSameWay) {
  OpsSession s(twoFeatures());
  ASSERT_TRUE(s.dispatcher.dispatch(renameOp("a", "X")));
  ASSERT_TRUE(s.dispatcher.dispatch(renameOp("a", "Y")));
  ASSERT_TRUE(s.undo.undo());
  ASSERT_TRUE(s.dispatcher.dispatch(renameDocument("Part")));
  EXPECT_EQ(ops::rebuildUndoStacks(s.log.entries()).value(), (ops::UndoStacks{{1}, {2}}));
  EXPECT_EQ(s.undo.stacks(), (ops::UndoStacks{{1}, {2}}));
}

TEST(RebuildUndoStacks, EqualsTheLiveStacks) {
  OpsSession s(twoFeatures());
  ASSERT_TRUE(s.dispatcher.dispatch(renameOp("a", "X")));
  ASSERT_TRUE(s.dispatcher.dispatch(renameOp("a", "Y")));
  ASSERT_TRUE(s.dispatcher.dispatch(renameOp("b", "Z")));
  ASSERT_TRUE(s.undo.undo());
  ASSERT_TRUE(s.undo.undo());
  ASSERT_TRUE(s.undo.redo());
  ASSERT_TRUE(s.dispatcher.dispatch(renameOp("b", "W")));
  ASSERT_TRUE(s.undo.undo());
  EXPECT_EQ(ops::rebuildUndoStacks(s.log.entries()).value(), s.undo.stacks());
}

TEST(RebuildUndoStacks, ReturnsTheSeqOfACorruptEntry) {
  OpsSession s(twoFeatures());
  ASSERT_TRUE(s.dispatcher.dispatch(renameOp("a", "X")));
  ASSERT_TRUE(s.dispatcher.dispatch(renameOp("a", "Y")));
  auto entries = s.log.entries();
  ops::LogEntry bad = entries[1];
  bad.seq = 3;
  bad.kind = ops::EntryKind::Undo;
  bad.target = 1;
  const auto undo = ops::rebuildUndoStacks({entries[0], entries[1], bad});
  ASSERT_FALSE(undo.has_value());
  EXPECT_EQ(undo.error().seq, 3);
  bad.kind = ops::EntryKind::Redo;
  const auto redo = ops::rebuildUndoStacks({entries[0], entries[1], bad});
  ASSERT_FALSE(redo.has_value());
  EXPECT_EQ(redo.error().seq, 3);
  EXPECT_EQ(ops::rebuildUndoStacks({}).value(), ops::UndoStacks{});
}

TEST(UndoManager, AssertsOnALogTheCallerDidNotCheck) {
  OpsSession s(twoFeatures());
  ASSERT_TRUE(s.dispatcher.dispatch(renameOp("a", "X")));
  ops::LogEntry bad = s.log.entries()[0];
  bad.seq = 2;
  bad.kind = ops::EntryKind::Redo;
  bad.target = 1;
  ops::OperationLog log({s.log.entries()[0], bad});
  // A dispatcher of its own: the one of the session has its listener already.
  ops::OperationDispatcher dispatcher(*s.doc, s.handlers, log, [] { return 0.0; });
  EXPECT_THROW((void)ops::UndoManager(dispatcher, log), core::AssertionError);
}

TEST(Reopening, ContinuesUndoRedoIdenticallyAfterRebuildingFromStoredEntries) {
  OpsSession live(twoFeatures());
  ASSERT_TRUE(live.dispatcher.dispatch(renameOp("a", "X")));
  ASSERT_TRUE(live.dispatcher.dispatch(renameOp("b", "Y")));
  ASSERT_TRUE(live.dispatcher.dispatch(removeOp("a")));
  ASSERT_TRUE(live.undo.undo());
  ASSERT_TRUE(live.undo.undo());

  // Reopen: a fresh document in the initial state, the log replayed onto it.
  const auto entries = live.log.entries();
  auto doc = aDocument(twoFeatures());
  const ops::OpHandlerRegistry handlers(noSchemas());
  ASSERT_TRUE(ops::replayLog(*doc, handlers, entries));
  EXPECT_EQ(dataOf(*doc), dataOf(*live.doc));
  ops::OperationLog log(entries);
  ops::OperationDispatcher dispatcher(*doc, handlers, log, [] { return 0.0; });
  ops::UndoManager undo(dispatcher, log);
  EXPECT_EQ(undo.stacks(), live.undo.stacks());

  for (ops::UndoManager* m : {&live.undo, &undo}) {
    ASSERT_TRUE(m->undo());
    ASSERT_TRUE(m->redo());
    ASSERT_TRUE(m->redo());
    ASSERT_TRUE(m->undo());
  }
  EXPECT_EQ(dataOf(*doc), dataOf(*live.doc));
  EXPECT_EQ(undo.stacks(), live.undo.stacks());
}

}  // namespace
}  // namespace tinycad::testing
