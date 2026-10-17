// Transactions and undo through the RuntimeDocument (spec 04, spec 14 "Změny dokumentu", Q097):
// the port of test/unit/ops/{transaction,undo}.test.ts one level up, where every durable call is
// stored before it answers and a reopened document continues undo and redo.

#include <gtest/gtest.h>

#include "session/runtime_testing.hpp"
#include "tinycad/session/runtime_document.hpp"

namespace tinycad::session {
namespace {

using namespace testing;

class RuntimeTransactionsTest : public RuntimeFixture {
 protected:
  document::DocumentId id = createDocument("Part");
  std::unique_ptr<RuntimeDocument> doc = openRuntime(id);
  Caller writer = callerOf("s1");
  RecentResponses recent{1000};
  v1::ReadModelOptions options;
  v1::ChangeResult out;
  int nextKey = 0;

  void SetUp() override {
    ASSERT_TRUE(doc->acquireLease(writer.session));
    dispatch(batch(Json::array({addBox("a", 0), addBox("b", 1)})));
  }

  std::string nextId() { return "op-" + std::to_string(++nextKey); }
  StepKey step() { return {recent, key(nextId())}; }

  void dispatch(const Json& op) {
    auto done = doc->dispatch(writer, op, "", key(nextId()), options, &out);
    ASSERT_TRUE(done.has_value()) << done.error().message;
  }
  void begin(const std::string& label = "T") {
    auto done = doc->begin(writer, label, step(), options, &out);
    ASSERT_TRUE(done.has_value()) << done.error().message;
  }
  void apply(const Json& op) {
    auto done = doc->apply(writer, op, step(), options, &out);
    ASSERT_TRUE(done.has_value()) << done.error().message;
  }
  void applyTransient(const Json& op) {
    auto done = doc->applyTransient(writer, op, step(), options, &out);
    ASSERT_TRUE(done.has_value()) << done.error().message;
  }
  void commit() {
    auto done = doc->commit(writer, step(), options, &out);
    ASSERT_TRUE(done.has_value()) << done.error().message;
  }

  static ErrorReason reasonOf(const SessionResult<void>& result) {
    EXPECT_FALSE(result.has_value());
    return result ? ErrorReason::Internal : result.error().reason;
  }
};

// --- commit -------------------------------------------------------------------------------

TEST_F(RuntimeTransactionsTest, FiftyAppliesOfOneFeatureAreOneEntry) {
  begin("Drag");
  for (int width = 1; width <= 50; ++width) apply(setWidth("a", width));
  EXPECT_EQ(storedLog(id).size(), 1U);  // nothing written during the transaction
  commit();
  ASSERT_TRUE(out.has_entry());
  EXPECT_EQ(out.entry().label(), "Drag");
  const auto log = storedLog(id);
  ASSERT_EQ(log.size(), 2U);
  EXPECT_EQ(log[1].at("op"), setWidth("a", 50));
  EXPECT_EQ(log[1].at("inverse"), setWidth("a", 10));
}

TEST_F(RuntimeTransactionsTest, AddAndMergedSetParamsCommitAsOneBatch) {
  begin("Box");
  apply(addBox("c", 2));
  for (int width = 1; width <= 3; ++width) apply(setWidth("c", width));
  commit();
  const auto log = storedLog(id);
  ASSERT_EQ(log.size(), 2U);
  EXPECT_EQ(log[1].at("op"), batch(Json::array({addBox("c", 2), setWidth("c", 3)})));
}

TEST_F(RuntimeTransactionsTest, AnEmptyTransactionWritesNothing) {
  begin();
  commit();
  EXPECT_FALSE(out.has_entry());
  EXPECT_EQ(storedLog(id).size(), 1U);
}

TEST_F(RuntimeTransactionsTest, TheReadModelShowsTheOpenTransaction) {
  begin("Box 1: width");
  EXPECT_EQ(out.read_model().session().transaction().label(), "Box 1: width");
  commit();
  EXPECT_FALSE(out.read_model().session().has_transaction());
}

// --- abort and transient steps ------------------------------------------------------------

TEST_F(RuntimeTransactionsTest, AbortRestoresTheDocumentAndWritesNothing) {
  begin();
  apply(setWidth("a", 20));
  apply(removeFeature("b"));
  auto aborted = doc->abort(writer, step(), options, &out);
  ASSERT_TRUE(aborted.has_value());
  EXPECT_EQ(storedLog(id).size(), 1U);

  // The next change starts from the restored document: 'a' had width 10 and 'b' exists.
  dispatch(batch(Json::array({setWidth("a", 30), renameFeature("b", "B")})));
  const auto log = storedLog(id);
  ASSERT_EQ(log.size(), 2U);
  EXPECT_EQ(log[1].at("inverse").at("ops").at(1), setWidth("a", 10));
  EXPECT_EQ(storedParams(id, "a").at("width"), 30);
}

TEST_F(RuntimeTransactionsTest, TransientStepsAreRevertedAtCommitAndNeverStored) {
  begin("Edit");
  applyTransient(setRollback(0));
  apply(setWidth("a", 20));
  commit();
  const auto log = storedLog(id);
  ASSERT_EQ(log.size(), 2U);
  EXPECT_EQ(log[1].at("op"), setWidth("a", 20));
  EXPECT_EQ(stored(id)->document().studio()->rollbackIndex, 2);
}

TEST_F(RuntimeTransactionsTest, TransientStepsAreRevertedAtAbort) {
  begin("Edit");
  applyTransient(setRollback(0));
  ASSERT_TRUE(doc->abort(writer, step(), options, &out));
  dispatch(renameFeature("a", "A"));
  EXPECT_EQ(stored(id)->document().studio()->rollbackIndex, 2);
  EXPECT_EQ(storedLog(id).size(), 2U);
}

// --- lifecycle errors ---------------------------------------------------------------------

TEST_F(RuntimeTransactionsTest, BeginDispatchUndoAndRedoDuringATransactionAreTransactionOpen) {
  begin();
  EXPECT_EQ(reasonOf(doc->begin(writer, "x", step(), options, &out)), ErrorReason::TransactionOpen);
  EXPECT_EQ(reasonOf(doc->dispatch(writer, renameFeature("a", "X"), "", key(nextId()), options,
                                   &out)),
            ErrorReason::TransactionOpen);
  EXPECT_EQ(reasonOf(doc->undo(writer, key(nextId()), options, &out)),
            ErrorReason::TransactionOpen);
  EXPECT_EQ(reasonOf(doc->redo(writer, key(nextId()), options, &out)),
            ErrorReason::TransactionOpen);
  EXPECT_EQ(storedLog(id).size(), 1U);
}

TEST_F(RuntimeTransactionsTest, StepsWithoutATransactionAreNoTransaction) {
  EXPECT_EQ(reasonOf(doc->apply(writer, setWidth("a", 2), step(), options, &out)),
            ErrorReason::NoTransaction);
  EXPECT_EQ(reasonOf(doc->applyTransient(writer, setRollback(0), step(), options, &out)),
            ErrorReason::NoTransaction);
  EXPECT_EQ(reasonOf(doc->commit(writer, step(), options, &out)), ErrorReason::NoTransaction);
  EXPECT_EQ(reasonOf(doc->abort(writer, step(), options, &out)), ErrorReason::NoTransaction);
}

TEST_F(RuntimeTransactionsTest, AFailingApplyLeavesTheTransactionOpenAndUnchanged) {
  begin();
  apply(setWidth("a", 20));
  EXPECT_EQ(reasonOf(doc->apply(writer, setWidth("zzz", 1), step(), options, &out)),
            ErrorReason::InvalidOperation);
  commit();
  EXPECT_EQ(storedLog(id).back().at("op"), setWidth("a", 20));
}

// --- undo and redo ------------------------------------------------------------------------

TEST_F(RuntimeTransactionsTest, UndoAndRedoWalkTheLogAndTheReadModelFollows) {
  dispatch(setWidth("a", 20));
  EXPECT_TRUE(out.read_model().session().can_undo());
  EXPECT_FALSE(out.read_model().session().can_redo());

  ASSERT_TRUE(doc->undo(writer, key(nextId()), options, &out));
  EXPECT_EQ(out.entry().kind(), v1::LogEntryView::KIND_UNDO);
  EXPECT_EQ(out.entry().target(), 2U);
  EXPECT_TRUE(out.read_model().session().can_redo());
  EXPECT_EQ(storedParams(id, "a").at("width"), 10);

  ASSERT_TRUE(doc->redo(writer, key(nextId()), options, &out));
  EXPECT_EQ(out.entry().kind(), v1::LogEntryView::KIND_REDO);
  EXPECT_EQ(out.entry().target(), 2U);
  EXPECT_FALSE(out.read_model().session().can_redo());
  EXPECT_EQ(storedParams(id, "a").at("width"), 20);
  EXPECT_EQ(storedLog(id).size(), 4U);
}

TEST_F(RuntimeTransactionsTest, NothingToUndoAndNothingToRedo) {
  EXPECT_EQ(reasonOf(doc->redo(writer, key(nextId()), options, &out)), ErrorReason::NothingToRedo);
  ASSERT_TRUE(doc->undo(writer, key(nextId()), options, &out));
  EXPECT_EQ(reasonOf(doc->undo(writer, key(nextId()), options, &out)), ErrorReason::NothingToUndo);
  EXPECT_EQ(storedLog(id).size(), 2U);
}

TEST_F(RuntimeTransactionsTest, UndoAndRedoContinueAfterTheDocumentIsOpenedAgain) {
  dispatch(setWidth("a", 20));
  dispatch(setWidth("a", 30));
  ASSERT_TRUE(doc->undo(writer, key(nextId()), options, &out));
  doc.reset();

  // A new runtime document over the same file (a restart of the server).
  doc = openRuntime(id);
  ASSERT_TRUE(doc->acquireLease(writer.session));
  ASSERT_TRUE(doc->undo(writer, key(nextId()), options, &out));
  EXPECT_EQ(out.entry().target(), 2U);
  EXPECT_EQ(storedParams(id, "a").at("width"), 10);
  ASSERT_TRUE(doc->redo(writer, key(nextId()), options, &out));
  EXPECT_EQ(out.entry().target(), 2U);
  ASSERT_TRUE(doc->redo(writer, key(nextId()), options, &out));
  EXPECT_EQ(out.entry().target(), 3U);
  EXPECT_EQ(storedParams(id, "a").at("width"), 30);
}

}  // namespace
}  // namespace tinycad::session
