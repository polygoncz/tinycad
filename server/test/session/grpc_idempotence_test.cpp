// Idempotence through a real gRPC channel (spec 14 "Idempotence"; N57, N58, N107): durable
// requests in SQLite, transaction steps in the session, the fingerprint of the request, and a
// Commit repeated after a server restart from a new session.

#include <gtest/gtest.h>

#include <future>
#include <thread>

#include "session/grpc_harness.hpp"

namespace tinycad::session {
namespace {

using namespace testing;

class GrpcIdempotenceTest : public ::testing::Test {
 protected:
  TestServer server;
  document::DocumentId part = server.createDocument("Part");
  std::string session = server.openOk(part);
};

TEST_F(GrpcIdempotenceTest, CommitTwiceWithTheSameIdIsOneEntryAndTheSameView) {
  ASSERT_TRUE(server.begin(session, "Add", "b-1").ok());
  ASSERT_TRUE(server.apply(session, addBox("a", 0), "a-1").ok());
  auto first = server.commit(session, "c-1");
  ASSERT_TRUE(first.ok()) << first.status.error_message();
  ASSERT_TRUE(first.response.result().has_entry());

  auto second = server.commit(session, "c-1");
  ASSERT_TRUE(second.ok()) << second.status.error_message();
  EXPECT_EQ(second.response.result().entry().SerializeAsString(),
            first.response.result().entry().SerializeAsString());
  EXPECT_EQ(server.storedLog(part).size(), 1U);
}

TEST_F(GrpcIdempotenceTest, ARepeatedRequestWithOtherKnownMeshesIsTheSameRequest) {
  auto first = server.dispatch(session, addBox("a", 0), "op-1");
  ASSERT_TRUE(first.ok());
  auto second =
      server.dispatch(session, addBox("a", 0), "op-1", knowing(first.response.result().read_model()));
  ASSERT_TRUE(second.ok()) << second.status.error_message();
  EXPECT_EQ(second.response.result().entry().seq(), 1U);
  EXPECT_EQ(server.storedLog(part).size(), 1U);
}

TEST_F(GrpcIdempotenceTest, ApplyTwiceIsAppliedOnce) {
  ASSERT_TRUE(server.begin(session, "Add", "b-1").ok());
  ASSERT_TRUE(server.begin(session, "Add", "b-1").ok());  // a repeated begin, not TRANSACTION_OPEN
  ASSERT_TRUE(server.apply(session, addBox("a", 0), "a-1").ok());
  // Applied again, a second feature.add of 'a' would fail with a duplicate id.
  auto repeated = server.apply(session, addBox("a", 0), "a-1");
  ASSERT_TRUE(repeated.ok()) << repeated.status.error_message();
  EXPECT_EQ(repeated.response.result().read_model().document().features_size(), 1);
  EXPECT_FALSE(repeated.response.result().has_entry());

  auto committed = server.commit(session, "c-1");
  ASSERT_TRUE(committed.ok());
  EXPECT_EQ(committed.response.result().read_model().document().features_size(), 1);
}

TEST_F(GrpcIdempotenceTest, TwoThreadsSendingTheSameApplyApplyItOnce) {
  ASSERT_TRUE(server.begin(session, "Add", "b-1").ok());
  std::promise<void> go;
  const std::shared_future<void> start = go.get_future().share();
  const auto send = [&] {
    start.wait();
    return server.apply(session, addBox("a", 0), "a-1").status;
  };
  auto first = std::async(std::launch::async, send);
  auto second = std::async(std::launch::async, send);
  go.set_value();
  EXPECT_TRUE(first.get().ok());
  EXPECT_TRUE(second.get().ok());
  auto model = server.readModel(session);
  ASSERT_TRUE(model.ok());
  EXPECT_EQ(model.response.read_model().document().features_size(), 1);
}

TEST_F(GrpcIdempotenceTest, TheSameIdWithAnotherOperationIsOperationIdReused) {
  ASSERT_TRUE(server.dispatch(session, addBox("a", 0), "op-1").ok());
  auto reused = server.dispatch(session, addBox("b", 1), "op-1");
  EXPECT_EQ(reused.status.error_code(), grpc::StatusCode::INVALID_ARGUMENT);
  EXPECT_EQ(detailOf(reused.status).reason(), v1::ERROR_REASON_OPERATION_ID_REUSED);

  ASSERT_TRUE(server.begin(session, "Edit", "b-1").ok());
  ASSERT_TRUE(server.apply(session, setWidth("a", 20), "a-1").ok());
  auto reusedStep = server.apply(session, setWidth("a", 30), "a-1");
  EXPECT_EQ(reusedStep.status.error_code(), grpc::StatusCode::INVALID_ARGUMENT);
  EXPECT_EQ(detailOf(reusedStep.status).reason(), v1::ERROR_REASON_OPERATION_ID_REUSED);
  EXPECT_EQ(server.storedLog(part).size(), 1U);
}

TEST_F(GrpcIdempotenceTest, AnEmptyCommitRepeatedSucceedsAgain) {
  ASSERT_TRUE(server.begin(session, "Nothing", "b-1").ok());
  auto first = server.commit(session, "c-1");
  ASSERT_TRUE(first.ok());
  EXPECT_FALSE(first.response.result().has_entry());
  auto second = server.commit(session, "c-1");
  ASSERT_TRUE(second.ok()) << second.status.error_message();
  EXPECT_FALSE(second.response.result().has_entry());
  EXPECT_TRUE(server.storedLog(part).empty());
}

TEST_F(GrpcIdempotenceTest, ACommitRepeatedAfterARestartFindsTheEntryInSqlite) {
  ASSERT_TRUE(server.begin(session, "Add", "b-1").ok());
  ASSERT_TRUE(server.apply(session, addBox("a", 0), "a-1").ok());
  auto first = server.commit(session, "c-1");
  ASSERT_TRUE(first.ok());

  server.restart();
  auto gone = server.commit(session, "c-1");
  EXPECT_EQ(detailOf(gone.status).reason(), v1::ERROR_REASON_SESSION_NOT_FOUND);

  const std::string fresh = server.openOk(part);
  auto repeated = server.commit(fresh, "c-1");
  ASSERT_TRUE(repeated.ok()) << repeated.status.error_message();
  EXPECT_EQ(repeated.response.result().entry().SerializeAsString(),
            first.response.result().entry().SerializeAsString());
  EXPECT_EQ(repeated.response.result().read_model().document().features_size(), 1);
  EXPECT_EQ(server.storedLog(part).size(), 1U);

  // The steps of the lost transaction are gone with it: a new commit has no transaction.
  auto lost = server.commit(fresh, "c-2");
  EXPECT_EQ(detailOf(lost.status).reason(), v1::ERROR_REASON_NO_TRANSACTION);
}

}  // namespace
}  // namespace tinycad::session
