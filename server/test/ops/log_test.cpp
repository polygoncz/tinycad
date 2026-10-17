// Port of test/unit/ops/log.test.ts and replay.test.ts: the append-only log and replaying it.
// The event and freezing tests of TS have no C++ counterpart (decision N21; entries are values).

#include <gtest/gtest.h>

#include <vector>

#include "ops/testing.hpp"
#include "tinycad/document/serialize.hpp"
#include "tinycad/ops/apply.hpp"
#include "tinycad/ops/log.hpp"
#include "tinycad/ops/replay.hpp"

namespace tinycad::testing {
namespace {

ops::LogEntry entry(const Json& op, const Json& inverse = Json(),
                    ops::EntryKind kind = ops::EntryKind::Do) {
  ops::LogEntry e;
  e.kind = kind;
  e.op = op;
  e.inverse = inverse;
  e.label = "L";
  e.time = 0;
  return e;
}

TEST(OperationLog, StartsEmptyWithLastSeq0) {
  const ops::OperationLog log;
  EXPECT_EQ(log.lastSeq(), 0);
  EXPECT_TRUE(log.entries().empty());
  EXPECT_EQ(log.entry(1), nullptr);
}

TEST(OperationLog, AssignsSeqFrom1AndUpdatesLastSeq) {
  ops::OperationLog log;
  EXPECT_EQ(log.append(entry(renameOp("a", "x"))).seq, 1);
  auto second = entry(renameOp("a", "y"));
  second.seq = 99;  // ignored
  EXPECT_EQ(log.append(second).seq, 2);
  EXPECT_EQ(log.lastSeq(), 2);
  EXPECT_EQ(log.entry(2)->op, renameOp("a", "y"));
}

TEST(OperationLog, EntriesFromSeqReturnsTheEntriesWithSeqAtLeastFromSeq) {
  ops::OperationLog log;
  for (int i = 0; i < 3; ++i) log.append(entry(renameOp("a", std::to_string(i))));
  EXPECT_EQ(log.entries().size(), 3U);
  EXPECT_EQ(log.entries(2).size(), 2U);
  EXPECT_EQ(log.entries(2).front().seq, 2);
  EXPECT_EQ(log.entries(0).size(), 3U);
  EXPECT_TRUE(log.entries(4).empty());
}

TEST(OperationLog, RestoresFromEntriesAndContinuesSeq) {
  auto first = entry(renameOp("a", "x"));
  first.seq = 1;
  auto second = entry(renameOp("a", "y"));
  second.seq = 2;
  ops::OperationLog log({first, second});
  EXPECT_EQ(log.lastSeq(), 2);
  EXPECT_EQ(log.append(entry(renameOp("a", "z"))).seq, 3);
}

TEST(OperationLog, AssertsOnAGapOrWhenNotStartingAt1) {
  auto e = entry(renameOp("a", "x"));
  e.seq = 2;
  EXPECT_THROW(ops::OperationLog({e}), core::AssertionError);
  auto first = entry(renameOp("a", "x"));
  first.seq = 1;
  auto third = e;
  third.seq = 3;
  EXPECT_THROW(ops::OperationLog({first, third}), core::AssertionError);
}

TEST(LogEntryJson, WritesTargetOnlyForUndoAndRedo) {
  auto e = entry(renameOp("a", "x"), renameOp("a", "y"), ops::EntryKind::Undo);
  e.seq = 2;
  e.target = 1;
  e.time = 5.5;
  const Json json = ops::logEntryJson(e);
  EXPECT_EQ(json.at("kind"), "undo");
  EXPECT_EQ(json.at("target"), 1);
  EXPECT_EQ(json.at("time"), 5.5);
  EXPECT_FALSE(ops::logEntryJson(entry(renameOp("a", "x"))).contains("target"));
}

const ops::OpHandlerRegistry& handlers() {
  static const ops::OpHandlerRegistry registry(noSchemas());
  return registry;
}

TEST(ReplayLog, AppliesOpOfEveryEntryInOrderUndoEntriesIncluded) {
  const auto doc = aDocument({.features = {aFeature({.id = "a", .name = "A"})}});
  std::vector<ops::LogEntry> entries = {entry(renameOp("a", "B")), entry(renameOp("a", "C")),
                                        entry(renameOp("a", "B"), Json(), ops::EntryKind::Undo)};
  ASSERT_TRUE(ops::replayLog(*doc, handlers(), entries).has_value());
  EXPECT_EQ(doc->feature(document::FeatureId("a"))->name, "B");
}

TEST(ReplayLog, ReproducesALiveDocument) {
  const auto live = aDocument();
  const auto replayed = aDocument();
  std::vector<ops::LogEntry> entries;
  for (const Json& op : {addOp(*aFeature("a"), 0), addOp(*aFeature("b"), 0), moveOp("a", 0),
                         rollbackOp(1), suppressOp("b", true), removeOp("a")}) {
    const auto inverse = ops::applyOperation(*live, handlers(), op);
    ASSERT_TRUE(inverse.has_value()) << op.dump();
    entries.push_back(entry(op, *inverse));
  }
  ASSERT_TRUE(ops::replayLog(*replayed, handlers(), entries).has_value());
  EXPECT_TRUE(document::sameStudio(*replayed->studio(), *live->studio()));
}

TEST(ReplayLog, StopsAtTheFirstFailingEntryWithItsSeq) {
  const auto doc = aDocument({.features = {aFeature({.id = "a", .name = "A"})}});
  auto ok = entry(renameOp("a", "B"));
  ok.seq = 1;
  auto broken = entry(renameOp("zzz", "x"));
  broken.seq = 2;
  const auto result = ops::replayLog(*doc, handlers(), {ok, broken});
  ASSERT_FALSE(result.has_value());
  EXPECT_EQ(result.error().seq, 2);
  EXPECT_EQ(result.error().error.path, "featureId");
  EXPECT_EQ(doc->feature(document::FeatureId("a"))->name, "B");
}

}  // namespace
}  // namespace tinycad::testing
