// SessionService through a real gRPC channel (spec 14 "Sezení", "Chyby", "Testy"; Q102, N56,
// N59, N70): opening, the edit lease, the idle timeout, closing, resume, errors with their
// ErrorDetail, history and STEP export.

#include <gtest/gtest.h>

#include "session/grpc_harness.hpp"

namespace tinycad::session {
namespace {

using namespace testing;

class GrpcSessionTest : public ::testing::Test {
 protected:
  TestServer server;
  document::DocumentId part = server.createDocument("Part");
};

TEST_F(GrpcSessionTest, OpenReturnsTheFeatureTypesTheLeaseAndTheEventSeq) {
  auto opened = server.open(part);
  ASSERT_TRUE(opened.ok()) << opened.status.error_message();
  const auto& response = opened.response;
  EXPECT_FALSE(response.session_id().empty());
  EXPECT_EQ(response.feature_types_size(),
            static_cast<int>(describeFeatureTypes(Registries::server().schemas).size()));
  EXPECT_GE(response.feature_types_size(), 9);
  EXPECT_TRUE(response.read_model().session().writable());
  EXPECT_EQ(response.read_model().document().document_id(), part.str());
  EXPECT_EQ(response.read_model().document().name(), "Part");
  EXPECT_EQ(response.event_seq(), 0U);

  ASSERT_TRUE(server.dispatch(response.session_id(), addBox("a", 0), "op-1").ok());
  auto second = server.open(part);
  ASSERT_TRUE(second.ok());
  EXPECT_GT(second.response.event_seq(), 0U);
  EXPECT_EQ(second.response.event_seq(), server.manager()
                                             .find(second.response.session_id())
                                             .value()
                                             ->document()
                                             .events()
                                             .lastSeq());
}

TEST_F(GrpcSessionTest, OpeningAMissingDocumentIsDocumentNotFound) {
  auto opened = server.open(document::DocumentId("nope"));
  EXPECT_EQ(opened.status.error_code(), grpc::StatusCode::NOT_FOUND);
  EXPECT_EQ(detailOf(opened.status).reason(), v1::ERROR_REASON_DOCUMENT_NOT_FOUND);
}

TEST_F(GrpcSessionTest, TheSecondSessionIsReadOnly) {
  const std::string writer = server.openOk(part);
  auto second = server.open(part);
  ASSERT_TRUE(second.ok());
  EXPECT_FALSE(second.response.read_model().session().writable());

  auto refused = server.dispatch(second.response.session_id(), addBox("a", 0), "op-1");
  EXPECT_EQ(refused.status.error_code(), grpc::StatusCode::FAILED_PRECONDITION);
  EXPECT_EQ(detailOf(refused.status).reason(), v1::ERROR_REASON_READ_ONLY);
  auto begin = server.begin(second.response.session_id(), "Edit", "b-1");
  EXPECT_EQ(detailOf(begin.status).reason(), v1::ERROR_REASON_READ_ONLY);
  EXPECT_TRUE(server.dispatch(writer, addBox("a", 0), "op-2").ok());
}

TEST_F(GrpcSessionTest, TheIdleTimeoutDropsTheTransactionAndFreesTheLease) {
  const std::string writer = server.openOk(part);
  const std::string reader = server.openOk(part);
  ASSERT_TRUE(server.begin(writer, "Edit", "b-1").ok());
  ASSERT_TRUE(server.apply(writer, addBox("a", 0), "a-1").ok());

  server.advance(std::chrono::minutes(9));
  ASSERT_TRUE(server.readModel(reader).ok());  // the reader stays active
  EXPECT_EQ(server.manager().reapIdle(), 0U);
  server.advance(std::chrono::minutes(1));
  EXPECT_EQ(server.manager().reapIdle(), 1U);

  auto gone = server.readModel(writer);
  EXPECT_EQ(gone.status.error_code(), grpc::StatusCode::NOT_FOUND);
  EXPECT_EQ(detailOf(gone.status).reason(), v1::ERROR_REASON_SESSION_NOT_FOUND);

  // The transaction was aborted; the reader stays read-only, a new session gets the lease.
  auto seen = server.readModel(reader);
  ASSERT_TRUE(seen.ok());
  EXPECT_EQ(seen.response.read_model().document().features_size(), 0);
  EXPECT_FALSE(seen.response.read_model().session().has_transaction());
  EXPECT_FALSE(seen.response.read_model().session().writable());
  auto next = server.open(part);
  ASSERT_TRUE(next.ok());
  EXPECT_TRUE(next.response.read_model().session().writable());
  EXPECT_TRUE(server.dispatch(next.response.session_id(), addBox("a", 0), "op-1").ok());
}

TEST_F(GrpcSessionTest, CloseIsIdempotentAndAClosedSessionIsNotFound) {
  EXPECT_TRUE(server.close("unknown").ok());
  const std::string session = server.openOk(part);
  EXPECT_TRUE(server.close(session).ok());
  EXPECT_TRUE(server.close(session).ok());
  EXPECT_FALSE(server.manager().isLoaded(part));

  auto gone = server.dispatch(session, addBox("a", 0), "op-1");
  EXPECT_EQ(gone.status.error_code(), grpc::StatusCode::NOT_FOUND);
  EXPECT_EQ(detailOf(gone.status).reason(), v1::ERROR_REASON_SESSION_NOT_FOUND);
}

TEST_F(GrpcSessionTest, ResumeReturnsTheSameSessionWithItsLease) {
  const std::string session = server.openOk(part);
  ASSERT_TRUE(server.begin(session, "Edit", "b-1").ok());
  auto resumed = server.open(part, session);
  ASSERT_TRUE(resumed.ok());
  EXPECT_EQ(resumed.response.session_id(), session);
  EXPECT_TRUE(resumed.response.read_model().session().writable());
  EXPECT_TRUE(resumed.response.read_model().session().has_transaction());
  EXPECT_EQ(server.manager().sessionCount(), 1U);
}

TEST_F(GrpcSessionTest, ResumeOfAForeignOrDeadSessionOpensANewOne) {
  const std::string writer = server.openOk(part);
  const document::DocumentId other = server.createDocument("Other");
  const std::string foreign = server.openOk(other);

  auto opened = server.open(part, foreign);
  ASSERT_TRUE(opened.ok());
  EXPECT_NE(opened.response.session_id(), foreign);
  EXPECT_NE(opened.response.session_id(), writer);
  EXPECT_FALSE(opened.response.read_model().session().writable());

  auto dead = server.open(part, "r1-s999");
  ASSERT_TRUE(dead.ok());
  EXPECT_NE(dead.response.session_id(), "r1-s999");
}

// --- errors -----------------------------------------------------------------------------------

TEST_F(GrpcSessionTest, AnInvalidOperationCarriesThePathOfTheHandler) {
  const std::string session = server.openOk(part);
  auto invalid = server.dispatch(session, setWidth("zzz", 5), "op-1");
  EXPECT_EQ(invalid.status.error_code(), grpc::StatusCode::INVALID_ARGUMENT);
  const v1::ErrorDetail detail = detailOf(invalid.status);
  EXPECT_EQ(detail.reason(), v1::ERROR_REASON_INVALID_OPERATION);
  EXPECT_FALSE(detail.path().empty());
  EXPECT_TRUE(server.storedLog(part).empty());
}

TEST_F(GrpcSessionTest, AnEmptyOperationOrAMissingOperationIdIsInvalid) {
  const std::string session = server.openOk(part);
  v1::DispatchRequest request;
  request.set_session_id(session);
  request.set_operation_id("op-1");
  v1::DispatchResponse response;
  grpc::ClientContext context;
  const grpc::Status empty = server.sessions().Dispatch(&context, request, &response);
  EXPECT_EQ(empty.error_code(), grpc::StatusCode::INVALID_ARGUMENT);
  EXPECT_EQ(detailOf(empty).path(), "op");

  auto missing = server.dispatch(session, addBox("a", 0), "");
  EXPECT_EQ(missing.status.error_code(), grpc::StatusCode::INVALID_ARGUMENT);
  EXPECT_EQ(detailOf(missing.status).reason(), v1::ERROR_REASON_INVALID_OPERATION);
  EXPECT_EQ(detailOf(missing.status).path(), "operation_id");
  auto commit = server.commit(session, "");
  EXPECT_EQ(detailOf(commit.status).path(), "operation_id");
}

Json sketchWithCircle() {
  return {{"id", "s"},
          {"type", "sketch"},
          {"typeVersion", 1},
          {"name", "s"},
          {"params",
           {{"plane", Json::array({{{"kind", "plane"}, {"plane", "origin/plane:xy"}}})},
            {"entities",
             Json::array({{{"kind", "point"}, {"id", "c"}, {"x", 3}, {"y", 4}},
                          {{"kind", "circle"}, {"id", "C"}, {"center", "c"}, {"radius", 1.7}}})},
            {"constraints",
             Json::array({{{"kind", "fix"}, {"id", "f"}, {"point", "c"}},
                          {{"kind", "radius"}, {"id", "r"}, {"curve", "C"}, {"value", 2.5}}})}}},
          {"suppressed", false}};
}

/** Two fixed points 10 apart and a distance of 12 between them: planegcs reports a conflict. */
Json conflictingSketchParams() {
  return {{"plane", Json::array({{{"kind", "plane"}, {"plane", "origin/plane:xy"}}})},
          {"entities",
           Json::array({{{"kind", "point"}, {"id", "a"}, {"x", 0}, {"y", 0}},
                        {{"kind", "point"}, {"id", "b"}, {"x", 10}, {"y", 0}}})},
          {"constraints",
           Json::array({{{"kind", "fix"}, {"id", "fa"}, {"point", "a"}},
                        {{"kind", "fix"}, {"id", "fb"}, {"point", "b"}},
                        {{"kind", "distance"}, {"id", "W"}, {"a", "a"}, {"b", "b"},
                         {"value", 12}}})}};
}

TEST_F(GrpcSessionTest, ASketchTheServerCannotSolveIsSketchNotSolved) {
  if (!Registries::server().knows("sketch")) GTEST_SKIP() << "no sketch schema";
  const std::string session = server.openOk(part);
  const Json add{{"type", "feature.add"}, {"v", 1}, {"feature", sketchWithCircle()}, {"index", 0}};
  auto added = server.dispatch(session, add, "op-1");
  ASSERT_TRUE(added.ok()) << added.status.error_message();
  // The server solved the sketch: the read model carries its radius, not the drawn one.
  const auto* sketch = featureOf(added.response.result().read_model(), "s");
  ASSERT_NE(sketch, nullptr);
  EXPECT_DOUBLE_EQ(sketch->params()
                       .fields()
                       .at("entities")
                       .list_value()
                       .values(1)
                       .struct_value()
                       .fields()
                       .at("radius")
                       .number_value(),
                   2.5);

  ASSERT_TRUE(server.begin(session, "Edit sketch", "b-1").ok());
  const Json edit{{"type", "feature.setParams"}, {"v", 2},         {"featureId", "s"},
                  {"typeVersion", 1},            {"params", conflictingSketchParams()}};
  auto refused = server.apply(session, edit, "a-1");
  EXPECT_EQ(refused.status.error_code(), grpc::StatusCode::FAILED_PRECONDITION);
  const v1::ErrorDetail detail = detailOf(refused.status);
  EXPECT_EQ(detail.reason(), v1::ERROR_REASON_SKETCH_NOT_SOLVED);
  ASSERT_EQ(detail.issues_size(), 1);
  EXPECT_EQ(detail.issues(0).code(), "sketch.notSolved");
}

// --- history and export -----------------------------------------------------------------------

TEST_F(GrpcSessionTest, HistoryListsTheEntriesAndTheUndoStacks) {
  const std::string session = server.openOk(part);
  ASSERT_TRUE(server.dispatch(session, addBox("a", 0), "op-1").ok());
  ASSERT_TRUE(server.dispatch(session, addBox("b", 1), "op-2").ok());
  ASSERT_TRUE(server.undo(session, "u-1").ok());

  auto history = server.history(session);
  ASSERT_TRUE(history.ok());
  ASSERT_EQ(history.response.entries_size(), 3);
  EXPECT_EQ(history.response.entries(2).kind(), v1::LogEntryView::KIND_UNDO);
  EXPECT_EQ(history.response.entries(2).target(), 2U);
  ASSERT_EQ(history.response.undo_stack_size(), 1);
  EXPECT_EQ(history.response.undo_stack(0), 1U);
  ASSERT_EQ(history.response.redo_stack_size(), 1);
  EXPECT_EQ(history.response.redo_stack(0), 2U);

  auto tail = server.history(session, 3);
  ASSERT_TRUE(tail.ok());
  EXPECT_EQ(tail.response.entries_size(), 1);
}

TEST_F(GrpcSessionTest, ExportStepReturnsTheStepTextAndTheFileName) {
  const std::string session = server.openOk(part);
  ASSERT_TRUE(server.dispatch(session, addBox("a", 0), "op-1").ok());
  auto step = server.exportStep(session);
  ASSERT_TRUE(step.ok()) << step.status.error_message();
  EXPECT_TRUE(step.response.content().starts_with("ISO-10303-21;"));
  EXPECT_EQ(step.response.file_name(), "Part.step");
}

}  // namespace
}  // namespace tinycad::session
