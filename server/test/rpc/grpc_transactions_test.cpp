// Transactions and undo through a real gRPC channel: the tests of spec 04
// (test/unit/ops/{transaction,undo}.test.ts) against SessionService (spec 14 "Změny dokumentu",
// "Testy"; Q097): 50 changes = 1 entry, abort, transient steps, the errors of the table, and undo
// and redo after the document was reopened and after a server restart.

#include <gtest/gtest.h>

#include "rpc/grpc_harness.hpp"

namespace tinycad::session {
namespace {

using namespace testing;

class GrpcTransactionsTest : public ::testing::Test {
 protected:
  TestServer server;
  document::DocumentId part = server.createDocument("Part");
  std::string session = server.openOk(part);

  void SetUp() override { ASSERT_TRUE(server.dispatch(session, addBox("a", 0), "op-a").ok()); }

  v1::ReadModel model() {
    auto read = server.readModel(session);
    EXPECT_TRUE(read.ok());
    return read.response.read_model();
  }

  static v1::ErrorReason reasonOf(const grpc::Status& status) {
    EXPECT_EQ(status.error_code(), grpc::StatusCode::FAILED_PRECONDITION);
    return detailOf(status).reason();
  }
};

TEST_F(GrpcTransactionsTest, FiftyAppliesOfOneFeatureAreOneEntry) {
  ASSERT_TRUE(server.begin(session, "Drag", "b-1").ok());
  for (int i = 1; i <= 50; ++i) {
    auto applied = server.apply(session, setWidth("a", 10 + i), "a-" + std::to_string(i));
    ASSERT_TRUE(applied.ok()) << applied.status.error_message();
  }
  EXPECT_EQ(model().session().transaction().label(), "Drag");
  auto committed = server.commit(session, "c-1");
  ASSERT_TRUE(committed.ok());
  ASSERT_TRUE(committed.response.result().has_entry());
  EXPECT_EQ(committed.response.result().entry().label(), "Drag");
  EXPECT_EQ(widthOf(committed.response.result().read_model(), "a"), 60);
  EXPECT_FALSE(committed.response.result().read_model().session().has_transaction());
  EXPECT_EQ(server.storedLog(part).size(), 2U);

  // One undo takes the whole drag back.
  auto undone = server.undo(session, "u-1");
  ASSERT_TRUE(undone.ok());
  EXPECT_EQ(widthOf(undone.response.result().read_model(), "a"), 10);
}

TEST_F(GrpcTransactionsTest, AbortReturnsTheDocumentAndWritesNothing) {
  const std::uint64_t generation = model().regen().generation();
  ASSERT_TRUE(server.begin(session, "Edit", "b-1").ok());
  ASSERT_TRUE(server.apply(session, setWidth("a", 30), "a-1").ok());
  ASSERT_TRUE(server.apply(session, addBox("b", 1), "a-2").ok());
  EXPECT_EQ(model().document().features_size(), 2);

  auto aborted = server.abort(session, "x-1");
  ASSERT_TRUE(aborted.ok());
  const v1::ReadModel& after = aborted.response.result().read_model();
  EXPECT_FALSE(aborted.response.result().has_entry());
  EXPECT_EQ(after.document().features_size(), 1);
  EXPECT_EQ(widthOf(after, "a"), 10);
  EXPECT_FALSE(after.session().has_transaction());
  EXPECT_EQ(after.regen().generation(), generation + 4);  // begin, 2× apply, abort
  EXPECT_EQ(server.storedLog(part).size(), 1U);
}

TEST_F(GrpcTransactionsTest, TransientStepsNeverReachTheLog) {
  ASSERT_TRUE(server.begin(session, "Edit", "b-1").ok());
  auto preview = server.applyTransient(session, setWidth("a", 99), "t-1");
  ASSERT_TRUE(preview.ok());
  EXPECT_EQ(widthOf(preview.response.result().read_model(), "a"), 99);
  ASSERT_TRUE(server.apply(session, renameFeature("a", "Renamed"), "a-1").ok());

  auto committed = server.commit(session, "c-1");
  ASSERT_TRUE(committed.ok());
  const v1::ReadModel& after = committed.response.result().read_model();
  EXPECT_EQ(widthOf(after, "a"), 10);
  EXPECT_EQ(featureOf(after, "a")->name(), "Renamed");
  const auto log = server.storedLog(part);
  ASSERT_EQ(log.size(), 2U);
  EXPECT_EQ(log[1].at("op").dump().find("99"), std::string::npos) << log[1].dump();

  // Reverted by abort too.
  ASSERT_TRUE(server.begin(session, "Edit", "b-2").ok());
  ASSERT_TRUE(server.applyTransient(session, setWidth("a", 77), "t-2").ok());
  auto aborted = server.abort(session, "x-2");
  ASSERT_TRUE(aborted.ok());
  EXPECT_EQ(widthOf(aborted.response.result().read_model(), "a"), 10);
  EXPECT_EQ(server.storedLog(part).size(), 2U);
}

TEST_F(GrpcTransactionsTest, AnEmptyTransactionCommitsWithoutAnEntry) {
  ASSERT_TRUE(server.begin(session, "Nothing", "b-1").ok());
  auto committed = server.commit(session, "c-1");
  ASSERT_TRUE(committed.ok());
  EXPECT_FALSE(committed.response.result().has_entry());
  EXPECT_EQ(server.storedLog(part).size(), 1U);
}

TEST_F(GrpcTransactionsTest, AnOpenTransactionRefusesDispatchBeginAndUndo) {
  ASSERT_TRUE(server.begin(session, "Edit", "b-1").ok());
  EXPECT_EQ(reasonOf(server.dispatch(session, addBox("b", 1), "op-b").status),
            v1::ERROR_REASON_TRANSACTION_OPEN);
  EXPECT_EQ(reasonOf(server.begin(session, "Again", "b-2").status),
            v1::ERROR_REASON_TRANSACTION_OPEN);
  EXPECT_EQ(reasonOf(server.undo(session, "u-1").status), v1::ERROR_REASON_TRANSACTION_OPEN);
  EXPECT_EQ(reasonOf(server.redo(session, "r-1").status), v1::ERROR_REASON_TRANSACTION_OPEN);
}

TEST_F(GrpcTransactionsTest, StepsWithoutATransactionAreNoTransaction) {
  EXPECT_EQ(reasonOf(server.apply(session, setWidth("a", 20), "a-1").status),
            v1::ERROR_REASON_NO_TRANSACTION);
  EXPECT_EQ(reasonOf(server.applyTransient(session, setWidth("a", 20), "t-1").status),
            v1::ERROR_REASON_NO_TRANSACTION);
  EXPECT_EQ(reasonOf(server.commit(session, "c-1").status), v1::ERROR_REASON_NO_TRANSACTION);
  EXPECT_EQ(reasonOf(server.abort(session, "x-1").status), v1::ERROR_REASON_NO_TRANSACTION);
}

TEST_F(GrpcTransactionsTest, UndoAndRedoWithNothingToDoAreRefused) {
  EXPECT_EQ(reasonOf(server.redo(session, "r-1").status), v1::ERROR_REASON_NOTHING_TO_REDO);
  ASSERT_TRUE(server.undo(session, "u-1").ok());
  EXPECT_EQ(reasonOf(server.undo(session, "u-2").status), v1::ERROR_REASON_NOTHING_TO_UNDO);
  auto redone = server.redo(session, "r-2");
  ASSERT_TRUE(redone.ok());
  EXPECT_EQ(redone.response.result().entry().kind(), v1::LogEntryView::KIND_REDO);
  EXPECT_EQ(redone.response.result().read_model().document().features_size(), 1);
}

TEST_F(GrpcTransactionsTest, UndoAndRedoWorkAfterTheDocumentWasReopened) {
  ASSERT_TRUE(server.dispatch(session, setWidth("a", 20), "op-w").ok());
  ASSERT_TRUE(server.close(session).ok());
  ASSERT_FALSE(server.manager().isLoaded(part));

  auto reopened = server.open(part);
  ASSERT_TRUE(reopened.ok());
  const std::string next = reopened.response.session_id();
  EXPECT_TRUE(reopened.response.read_model().session().can_undo());
  auto undone = server.undo(next, "u-1");
  ASSERT_TRUE(undone.ok());
  EXPECT_EQ(widthOf(undone.response.result().read_model(), "a"), 10);
  EXPECT_TRUE(undone.response.result().read_model().session().can_redo());

  server.restart();
  const std::string afterRestart = server.openOk(part);
  auto redone = server.redo(afterRestart, "r-1");
  ASSERT_TRUE(redone.ok()) << redone.status.error_message();
  EXPECT_EQ(widthOf(redone.response.result().read_model(), "a"), 20);
  EXPECT_EQ(server.storedLog(part).size(), 4U);
}

}  // namespace
}  // namespace tinycad::session
