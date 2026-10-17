// WatchSession through a real gRPC channel (spec 14 "Události", "Testy"; N106, N118): missing
// events after after_seq, resync for an evicted or a future seq, `changed` for a read-only
// session, regen_progress after a change, heartbeats without a seq of their own, the stream
// holding off the idle timeout and its end when the document is unloaded.

#include <gtest/gtest.h>

#include <thread>

#include "session/grpc_harness.hpp"

namespace tinycad::session {
namespace {

using namespace testing;

SessionConfig quickHeartbeat() {
  SessionConfig config;
  config.heartbeat = std::chrono::milliseconds(100);
  return config;
}

class GrpcWatchTest : public ::testing::Test {
 protected:
  TestServer server{quickHeartbeat()};
  document::DocumentId part = server.createDocument("Part");
  v1::OpenSessionResponse opened = server.open(part).response;
  std::string writer = opened.session_id();
};

TEST_F(GrpcWatchTest, AfterSeqDeliversTheMissedChangesInOrder) {
  ASSERT_TRUE(server.dispatch(writer, addBox("a", 0), "op-1").ok());
  ASSERT_TRUE(server.dispatch(writer, addBox("b", 1), "op-2").ok());

  Watcher watch(server.sessions(), writer, opened.event_seq());
  auto first = watch.next();
  ASSERT_TRUE(first.has_value());
  EXPECT_EQ(first->seq(), opened.event_seq() + 1);
  ASSERT_TRUE(first->has_changed());
  EXPECT_EQ(first->changed().generation(), 1U);
  EXPECT_EQ(first->changed().last_seq(), 1U);
  EXPECT_EQ(first->changed().by_session_id(), writer);

  // The regeneration after the change reports the rebuilt feature (N118).
  auto progress = watch.next();
  ASSERT_TRUE(progress.has_value());
  ASSERT_TRUE(progress->has_regen_progress());
  EXPECT_EQ(progress->seq(), first->seq() + 1);
  EXPECT_EQ(progress->regen_progress().feature_id(), "a");
  EXPECT_EQ(progress->regen_progress().generation(), 1U);

  auto second = watch.nextSkippingProgress();
  ASSERT_TRUE(second.has_value());
  ASSERT_TRUE(second->has_changed());
  EXPECT_EQ(second->changed().generation(), 2U);
}

TEST_F(GrpcWatchTest, ARunningStreamGetsNewEventsAndHeartbeatsKeepTheSeq) {
  Watcher watch(server.sessions(), writer, 0);
  auto beat = watch.next();
  ASSERT_TRUE(beat.has_value());
  ASSERT_TRUE(beat->has_heartbeat());
  EXPECT_EQ(beat->seq(), 0U);

  ASSERT_TRUE(server.dispatch(writer, addBox("a", 0), "op-1").ok());
  std::optional<v1::SessionEvent> changed;
  while ((changed = watch.next()) && changed->has_heartbeat()) {
  }
  ASSERT_TRUE(changed.has_value());
  ASSERT_TRUE(changed->has_changed());
  EXPECT_EQ(changed->seq(), 1U);

  // The next heartbeat carries the seq of the last event, it consumes none.
  std::uint64_t last = changed->seq();
  std::optional<v1::SessionEvent> next;
  while ((next = watch.next()) && !next->has_heartbeat()) last = next->seq();
  ASSERT_TRUE(next.has_value());
  EXPECT_EQ(next->seq(), last);
  EXPECT_EQ(
      server.manager().find(writer).value()->document().events().lastSeq(), last);
}

TEST_F(GrpcWatchTest, AnEvictedAfterSeqGetsResyncFirst) {
  ASSERT_TRUE(server.begin(writer, "x", "b-0").ok());
  ASSERT_TRUE(server.abort(writer, "x-0").ok());
  // 2 events per pair on an empty document; 300 events evict the first 44.
  for (int i = 1; i < 150; ++i) {
    ASSERT_TRUE(server.begin(writer, "x", "b-" + std::to_string(i)).ok());
    ASSERT_TRUE(server.abort(writer, "x-" + std::to_string(i)).ok());
  }
  Watcher watch(server.sessions(), writer, 1);
  auto resync = watch.next();
  ASSERT_TRUE(resync.has_value());
  ASSERT_TRUE(resync->has_resync());
  EXPECT_EQ(resync->seq(), 300U);
  auto beat = watch.next();
  ASSERT_TRUE(beat.has_value());
  EXPECT_TRUE(beat->has_heartbeat());
  EXPECT_EQ(beat->seq(), 300U);
}

TEST_F(GrpcWatchTest, AFutureAfterSeqOfAnotherInstanceGetsResync) {
  ASSERT_TRUE(server.dispatch(writer, addBox("a", 0), "op-1").ok());
  const std::uint64_t last =
      server.manager().find(writer).value()->document().events().lastSeq();
  Watcher watch(server.sessions(), writer, last + 100);
  auto resync = watch.next();
  ASSERT_TRUE(resync.has_value());
  ASSERT_TRUE(resync->has_resync());
  EXPECT_EQ(resync->seq(), last);
}

TEST_F(GrpcWatchTest, AReadOnlySessionHearsTheChangesOfTheWriter) {
  auto reader = server.open(part);
  ASSERT_TRUE(reader.ok());
  ASSERT_FALSE(reader.response.read_model().session().writable());
  Watcher watch(server.sessions(), reader.response.session_id(), reader.response.event_seq());

  ASSERT_TRUE(server.dispatch(writer, addBox("a", 0), "op-1").ok());
  std::optional<v1::SessionEvent> event;
  while ((event = watch.next()) && event->has_heartbeat()) {
  }
  ASSERT_TRUE(event.has_value());
  ASSERT_TRUE(event->has_changed());
  EXPECT_EQ(event->changed().by_session_id(), writer);

  auto refreshed = server.readModel(reader.response.session_id());
  ASSERT_TRUE(refreshed.ok());
  EXPECT_EQ(refreshed.response.read_model().regen().generation(), event->changed().generation());
  EXPECT_EQ(refreshed.response.read_model().document().features_size(), 1);
}

TEST_F(GrpcWatchTest, AReadModelWithoutAChangeAddsNoEvents) {
  ASSERT_TRUE(server.dispatch(writer, addBox("a", 0), "op-1").ok());
  const auto& events = server.manager().find(writer).value()->document().events();
  const std::uint64_t last = events.lastSeq();
  ASSERT_TRUE(server.readModel(writer).ok());
  ASSERT_TRUE(server.dispatch(writer, addBox("a", 0), "op-1").ok());  // repeated
  EXPECT_EQ(events.lastSeq(), last);
}

TEST_F(GrpcWatchTest, AnOpenStreamHoldsOffTheIdleTimeout) {
  Watcher watch(server.sessions(), writer, 0);
  ASSERT_TRUE(watch.next().has_value());  // the handler runs: its guard is counted
  server.advance(std::chrono::minutes(11));
  EXPECT_EQ(server.manager().reapIdle(), 0U);

  watch.cancel();
  EXPECT_EQ(watch.finish().error_code(), grpc::StatusCode::CANCELLED);
  // The idle time counts from the end of the stream; wait until the handler has left.
  for (int i = 0; i < 100 && server.manager().reapIdle() == 0; ++i) {
    server.advance(std::chrono::minutes(11));
    std::this_thread::sleep_for(std::chrono::milliseconds(50));
  }
  EXPECT_EQ(server.manager().sessionCount(), 0U);
}

TEST_F(GrpcWatchTest, UnloadingTheDocumentEndsTheStreamWithOk) {
  Watcher watch(server.sessions(), writer, 0);
  ASSERT_TRUE(watch.next().has_value());
  ASSERT_TRUE(server.close(writer).ok());
  EXPECT_TRUE(watch.finish().ok());

  Watcher again(server.sessions(), writer, 0);
  EXPECT_FALSE(again.next().has_value());
  const grpc::Status status = again.finish();
  EXPECT_EQ(status.error_code(), grpc::StatusCode::NOT_FOUND);
  EXPECT_EQ(detailOf(status).reason(), v1::ERROR_REASON_SESSION_NOT_FOUND);
}

TEST_F(GrpcWatchTest, ServerShutdownEndsTheStream) {
  Watcher watch(server.sessions(), writer, 0);
  ASSERT_TRUE(watch.next().has_value());
  // main.cpp calls it before grpc::Server::Shutdown, which then does not wait for the stream.
  server.manager().shutdown();
  EXPECT_TRUE(watch.finish().ok());
}

}  // namespace
}  // namespace tinycad::session
