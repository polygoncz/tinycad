// The idle timeout of sessions (spec 14 "Sezení", decision N59): a session without an RPC and
// without an open WatchSession for 10 minutes is closed by reapIdle, as CloseSession would close
// it. The tests move a fake steady clock instead of waiting.

#include <gtest/gtest.h>

#include <chrono>

#include "session/runtime_testing.hpp"
#include "tinycad/session/session_manager.hpp"

namespace tinycad::session {
namespace {

using namespace testing;
using std::chrono::minutes;

class IdleTimeoutTest : public RuntimeFixture {
 protected:
  SteadyTime steadyNow{};
  int nextSession = 0;
  std::unique_ptr<SessionManager> manager = std::make_unique<SessionManager>(
      SessionManager::Dependencies{deps, documents, [this] { return steadyNow; },
                                   [this] { return "s" + std::to_string(++nextSession); },
                                   SessionConfig{}});
  document::DocumentId part = createDocument("Part");
  ReadModelOptions options;

  SessionPtr open() {
    auto opened = manager->open(part, std::nullopt, "");
    EXPECT_TRUE(opened.has_value());
    return opened ? opened->session : nullptr;
  }
};

TEST_F(IdleTimeoutTest, NineMinutesWithoutAnRpcKeepTheSessionTenCloseIt) {
  const SessionPtr session = open();
  steadyNow += minutes(9);
  EXPECT_EQ(manager->reapIdle(), 0U);
  EXPECT_TRUE(manager->find(session->id().str()).has_value());

  // find counted as an RPC: ten minutes from it.
  steadyNow += minutes(9);
  EXPECT_EQ(manager->reapIdle(), 0U);
  steadyNow += minutes(1);
  EXPECT_EQ(manager->reapIdle(), 1U);
  auto gone = manager->find(session->id().str());
  ASSERT_FALSE(gone.has_value());
  EXPECT_EQ(gone.error().reason, ErrorReason::SessionNotFound);
  EXPECT_FALSE(manager->isLoaded(part));
}

TEST_F(IdleTimeoutTest, AnOpenWatchSessionKeepsTheSessionAlive) {
  const SessionPtr session = open();
  {
    auto watch = manager->watch(session->id().str());
    ASSERT_TRUE(watch.has_value());
    steadyNow += minutes(30);
    EXPECT_EQ(manager->reapIdle(), 0U);
    steadyNow += minutes(5);
  }
  // The idle time counts from the end of the stream.
  steadyNow += minutes(9);
  EXPECT_EQ(manager->reapIdle(), 0U);
  steadyNow += minutes(1);
  EXPECT_EQ(manager->reapIdle(), 1U);
}

TEST_F(IdleTimeoutTest, WatchingAClosedSessionIsSessionNotFound) {
  auto watch = manager->watch("nobody");
  ASSERT_FALSE(watch.has_value());
  EXPECT_EQ(watch.error().reason, ErrorReason::SessionNotFound);
}

TEST_F(IdleTimeoutTest, TheTimeoutOfTheWriterDropsItsTransactionAndFreesTheLease) {
  const SessionPtr writer = open();
  ASSERT_TRUE(writer->document().begin(writer->caller(), "T", {writer->recent(), key("b1")},
                                       options));
  ASSERT_TRUE(writer->document().apply(writer->caller(), addBox("a", 0),
                                       {writer->recent(), key("a1")}, options));
  steadyNow += minutes(5);
  const SessionPtr reader = open();
  steadyNow += minutes(5);

  EXPECT_EQ(manager->reapIdle(), 1U);
  EXPECT_FALSE(reader->document().leaseHolder().has_value());
  auto model = reader->document().readModel(reader->caller(), options);
  ASSERT_TRUE(model.has_value());
  EXPECT_FALSE(model->session.transactionLabel.has_value());
  EXPECT_TRUE(storedLog(part).empty());
  EXPECT_FALSE(reader->writable());

  const SessionPtr next = open();
  EXPECT_TRUE(next->writable());
}

}  // namespace
}  // namespace tinycad::session
