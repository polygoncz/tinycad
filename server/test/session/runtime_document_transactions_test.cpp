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
  ReadModelOptions options;
  ChangeResult out;
  int nextKey = 0;

  void SetUp() override {
    ASSERT_TRUE(doc->acquireLease(writer.session));
    dispatch(batch(Json::array({addBox("a", 0), addBox("b", 1)})));
  }

  std::string nextId() { return "op-" + std::to_string(++nextKey); }
  StepKey step() { return {recent, key(nextId())}; }

  void dispatch(const Json& op) {
    ASSERT_TRUE(keep(doc->dispatch(writer, op, "", key(nextId()), options)));
  }
  void begin(const std::string& label = "T") {
    ASSERT_TRUE(keep(doc->begin(writer, label, step(), options)));
  }
  void apply(const Json& op) { ASSERT_TRUE(keep(doc->apply(writer, op, step(), options))); }
  void applyTransient(const Json& op) {
    ASSERT_TRUE(keep(doc->applyTransient(writer, op, step(), options)));
  }
  void commit() { ASSERT_TRUE(keep(doc->commit(writer, step(), options))); }

  /** A successful change is kept in `out`; false (with the message) for an error. */
  ::testing::AssertionResult keep(SessionResult<ChangeResult> result) {
    if (!result) return ::testing::AssertionFailure() << result.error().message;
    out = std::move(*result);
    return ::testing::AssertionSuccess();
  }

  template <class T>
  static ErrorReason reasonOf(const SessionResult<T>& result) {
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
  ASSERT_TRUE(out.entry.has_value());
  EXPECT_EQ(out.entry->at("label"), "Drag");
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
  EXPECT_FALSE(out.entry.has_value());
  EXPECT_EQ(storedLog(id).size(), 1U);
}

TEST_F(RuntimeTransactionsTest, TheReadModelShowsTheOpenTransaction) {
  begin("Box 1: width");
  EXPECT_EQ(*out.readModel.session.transactionLabel, "Box 1: width");
  commit();
  EXPECT_FALSE(out.readModel.session.transactionLabel.has_value());
}

// --- abort and transient steps ------------------------------------------------------------

TEST_F(RuntimeTransactionsTest, AbortRestoresTheDocumentAndWritesNothing) {
  begin();
  apply(setWidth("a", 20));
  apply(removeFeature("b"));
  ASSERT_TRUE(keep(doc->abort(writer, step(), options)));
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
  ASSERT_TRUE(keep(doc->abort(writer, step(), options)));
  dispatch(renameFeature("a", "A"));
  EXPECT_EQ(stored(id)->document().studio()->rollbackIndex, 2);
  EXPECT_EQ(storedLog(id).size(), 2U);
}

// --- lifecycle errors ---------------------------------------------------------------------

TEST_F(RuntimeTransactionsTest, BeginDispatchUndoAndRedoDuringATransactionAreTransactionOpen) {
  begin();
  EXPECT_EQ(reasonOf(doc->begin(writer, "x", step(), options)), ErrorReason::TransactionOpen);
  EXPECT_EQ(reasonOf(doc->dispatch(writer, renameFeature("a", "X"), "", key(nextId()), options)),
            ErrorReason::TransactionOpen);
  EXPECT_EQ(reasonOf(doc->undo(writer, key(nextId()), options)),
            ErrorReason::TransactionOpen);
  EXPECT_EQ(reasonOf(doc->redo(writer, key(nextId()), options)),
            ErrorReason::TransactionOpen);
  EXPECT_EQ(storedLog(id).size(), 1U);
}

TEST_F(RuntimeTransactionsTest, StepsWithoutATransactionAreNoTransaction) {
  EXPECT_EQ(reasonOf(doc->apply(writer, setWidth("a", 2), step(), options)),
            ErrorReason::NoTransaction);
  EXPECT_EQ(reasonOf(doc->applyTransient(writer, setRollback(0), step(), options)),
            ErrorReason::NoTransaction);
  EXPECT_EQ(reasonOf(doc->commit(writer, step(), options)), ErrorReason::NoTransaction);
  EXPECT_EQ(reasonOf(doc->abort(writer, step(), options)), ErrorReason::NoTransaction);
}

TEST_F(RuntimeTransactionsTest, AFailingApplyLeavesTheTransactionOpenAndUnchanged) {
  begin();
  apply(setWidth("a", 20));
  EXPECT_EQ(reasonOf(doc->apply(writer, setWidth("zzz", 1), step(), options)),
            ErrorReason::InvalidOperation);
  commit();
  EXPECT_EQ(storedLog(id).back().at("op"), setWidth("a", 20));
}

// --- undo and redo ------------------------------------------------------------------------

TEST_F(RuntimeTransactionsTest, UndoAndRedoWalkTheLogAndTheReadModelFollows) {
  dispatch(setWidth("a", 20));
  EXPECT_TRUE(out.readModel.session.canUndo);
  EXPECT_FALSE(out.readModel.session.canRedo);

  ASSERT_TRUE(keep(doc->undo(writer, key(nextId()), options)));
  EXPECT_EQ(out.entry->at("kind"), "undo");
  EXPECT_EQ(out.entry->at("target"), 2);
  EXPECT_TRUE(out.readModel.session.canRedo);
  EXPECT_EQ(storedParams(id, "a").at("width"), 10);

  ASSERT_TRUE(keep(doc->redo(writer, key(nextId()), options)));
  EXPECT_EQ(out.entry->at("kind"), "redo");
  EXPECT_EQ(out.entry->at("target"), 2);
  EXPECT_FALSE(out.readModel.session.canRedo);
  EXPECT_EQ(storedParams(id, "a").at("width"), 20);
  EXPECT_EQ(storedLog(id).size(), 4U);
}

TEST_F(RuntimeTransactionsTest, NothingToUndoAndNothingToRedo) {
  EXPECT_EQ(reasonOf(doc->redo(writer, key(nextId()), options)), ErrorReason::NothingToRedo);
  ASSERT_TRUE(keep(doc->undo(writer, key(nextId()), options)));
  EXPECT_EQ(reasonOf(doc->undo(writer, key(nextId()), options)), ErrorReason::NothingToUndo);
  EXPECT_EQ(storedLog(id).size(), 2U);
}

TEST_F(RuntimeTransactionsTest, UndoAndRedoContinueAfterTheDocumentIsOpenedAgain) {
  dispatch(setWidth("a", 20));
  dispatch(setWidth("a", 30));
  ASSERT_TRUE(keep(doc->undo(writer, key(nextId()), options)));
  doc.reset();

  // A new runtime document over the same file (a restart of the server).
  doc = openRuntime(id);
  ASSERT_TRUE(doc->acquireLease(writer.session));
  ASSERT_TRUE(keep(doc->undo(writer, key(nextId()), options)));
  EXPECT_EQ(out.entry->at("target"), 2);
  EXPECT_EQ(storedParams(id, "a").at("width"), 10);
  ASSERT_TRUE(keep(doc->redo(writer, key(nextId()), options)));
  EXPECT_EQ(out.entry->at("target"), 2);
  ASSERT_TRUE(keep(doc->redo(writer, key(nextId()), options)));
  EXPECT_EQ(out.entry->at("target"), 3);
  EXPECT_EQ(storedParams(id, "a").at("width"), 30);
}

// --- STORAGE in a transaction (N155) ------------------------------------------------------

TEST_F(RuntimeTransactionsTest, AFailedCommitKeepsTheTransactionAndARetryWritesIt) {
  begin("Drag");
  apply(setWidth("a", 20));
  apply(setWidth("b", 30));
  const auto generationBefore = changedOf(*doc).back().generation;

  fail->append = true;
  EXPECT_EQ(reasonOf(doc->commit(writer, step(), options)), ErrorReason::Storage);
  fail->append = false;

  // Still open with both steps, no change event, nothing stored.
  EXPECT_EQ(changedOf(*doc).back().generation, generationBefore);
  auto model = doc->readModel(writer, options);
  ASSERT_TRUE(model.has_value());
  EXPECT_EQ(model->session.transactionLabel, "Drag");
  EXPECT_EQ(model->generation, generationBefore);
  EXPECT_EQ(storedLog(id).size(), 1U);

  // A retried Commit (a new operation id) writes one entry with both steps.
  commit();
  ASSERT_TRUE(out.entry.has_value());
  EXPECT_EQ(out.entry->at("op").at("ops").size(), 2U);
  EXPECT_FALSE(out.readModel.session.transactionLabel.has_value());
  EXPECT_EQ(storedLog(id).size(), 2U);
  EXPECT_EQ(storedParams(id, "a").at("width"), 20);
  EXPECT_EQ(storedParams(id, "b").at("width"), 30);
}

TEST_F(RuntimeTransactionsTest, ARetriedDispatchWithTheSameIdAfterStorageIsANewAttempt) {
  fail->append = true;
  EXPECT_EQ(reasonOf(doc->dispatch(writer, setWidth("a", 20), "", key("retry"), options)),
            ErrorReason::Storage);
  fail->append = false;
  // Nothing was stored under the id, so this is not a repeat: it applies and writes.
  ASSERT_TRUE(keep(doc->dispatch(writer, setWidth("a", 20), "", key("retry"), options)));
  ASSERT_TRUE(out.entry.has_value());
  EXPECT_EQ(storedLog(id).size(), 2U);
  EXPECT_EQ(storedParams(id, "a").at("width"), 20);
}

}  // namespace
}  // namespace tinycad::session
