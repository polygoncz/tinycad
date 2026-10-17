// The ring of session events (spec 14 "Události", event_ring.hpp).

#include "tinycad/session/event_ring.hpp"

#include <gtest/gtest.h>

#include <chrono>
#include <cstdint>
#include <optional>
#include <thread>
#include <vector>

#include "tinycad/core/result.hpp"

namespace tinycad::session {
namespace {

using std::chrono::milliseconds;
using std::chrono::steady_clock;

SessionEvent changed(std::uint64_t generation) {
  SessionEvent event;
  event.kind = SessionEvent::Kind::Changed;
  event.generation = generation;
  return event;
}

std::vector<std::uint64_t> seqsOf(const std::vector<SessionEvent>& events) {
  std::vector<std::uint64_t> out;
  for (const auto& e : events) out.push_back(e.seq);
  return out;
}

TEST(EventRing, StartsEmptyAtSeqZero) {
  const EventRing ring;
  EXPECT_EQ(ring.lastSeq(), 0U);
  const auto events = ring.after(0);
  ASSERT_TRUE(events.has_value());
  EXPECT_TRUE(events->empty());
  EXPECT_FALSE(ring.closed());
}

TEST(EventRing, RefusesAZeroCapacity) {
  EXPECT_THROW(EventRing(0), core::AssertionError);
}

TEST(EventRing, NumbersEventsFromOneAndOverwritesTheirSeq) {
  EventRing ring;
  auto first = changed(1);
  first.seq = 42;
  EXPECT_EQ(ring.append(first), 1U);
  EXPECT_EQ(ring.append(changed(2)), 2U);
  EXPECT_EQ(ring.lastSeq(), 2U);
  const auto events = ring.after(0);
  ASSERT_TRUE(events.has_value());
  EXPECT_EQ(seqsOf(*events), (std::vector<std::uint64_t>{1, 2}));
  EXPECT_EQ((*events)[0].generation, 1U);
  EXPECT_EQ((*events)[1].generation, 2U);
}

TEST(EventRing, ReturnsOnlyTheEventsAfterTheSeqInOrder) {
  EventRing ring;
  for (std::uint64_t g = 1; g <= 5; ++g) ring.append(changed(g));
  EXPECT_EQ(seqsOf(*ring.after(3)), (std::vector<std::uint64_t>{4, 5}));
  const auto none = ring.after(5);
  ASSERT_TRUE(none.has_value());
  EXPECT_TRUE(none->empty());
}

TEST(EventRing, DropsTheOldestBeyondCapacity) {
  EventRing ring(256);
  for (std::uint64_t g = 1; g <= 300; ++g) ring.append(changed(g));
  EXPECT_EQ(ring.lastSeq(), 300U);
  // Kept: 45..300. after(44) misses nothing, after(43) misses seq 44.
  const auto kept = ring.after(44);
  ASSERT_TRUE(kept.has_value());
  EXPECT_EQ(kept->size(), 256U);
  EXPECT_EQ(kept->front().seq, 45U);
  EXPECT_EQ(kept->back().seq, 300U);
  EXPECT_FALSE(ring.after(43).has_value());
  EXPECT_FALSE(ring.after(0).has_value());
}

TEST(EventRing, AsksForResyncWithASeqFromTheFuture) {
  EventRing ring;
  ring.append(changed(1));
  EXPECT_FALSE(ring.after(2).has_value());
  const EventRing fresh;
  EXPECT_FALSE(fresh.after(7).has_value());
}

TEST(EventRing, WaitAfterReturnsAtOnceWhenEventsOrResyncAreReady) {
  EventRing ring(2);
  for (std::uint64_t g = 1; g <= 4; ++g) ring.append(changed(g));
  const auto far = steady_clock::now() + std::chrono::hours(1);
  EXPECT_EQ(seqsOf(*ring.waitAfter(3, far)), (std::vector<std::uint64_t>{4}));
  EXPECT_FALSE(ring.waitAfter(1, far).has_value());  // evicted
  EXPECT_FALSE(ring.waitAfter(9, far).has_value());  // future
}

TEST(EventRing, WaitAfterReturnsEmptyAtTheDeadline) {
  EventRing ring;
  ring.append(changed(1));
  const auto events = ring.waitAfter(1, steady_clock::now() + milliseconds(20));
  ASSERT_TRUE(events.has_value());
  EXPECT_TRUE(events->empty());
}

TEST(EventRing, WaitAfterWakesUpOnAppend) {
  EventRing ring;
  std::optional<std::vector<SessionEvent>> got;
  std::thread watcher([&] { got = ring.waitAfter(0, steady_clock::now() + std::chrono::hours(1)); });
  std::this_thread::sleep_for(milliseconds(20));
  ring.append(changed(1));
  watcher.join();
  ASSERT_TRUE(got.has_value());
  EXPECT_EQ(seqsOf(*got), (std::vector<std::uint64_t>{1}));
}

TEST(EventRing, CloseWakesEveryWaiterForGood) {
  EventRing ring;
  std::vector<std::optional<std::vector<SessionEvent>>> got(2);
  std::vector<std::thread> watchers;
  for (auto& slot : got) {
    watchers.emplace_back(
        [&ring, &slot] { slot = ring.waitAfter(0, steady_clock::now() + std::chrono::hours(1)); });
  }
  std::this_thread::sleep_for(milliseconds(20));
  ring.close();
  for (auto& w : watchers) w.join();
  for (const auto& slot : got) {
    ASSERT_TRUE(slot.has_value());
    EXPECT_TRUE(slot->empty());
  }
  EXPECT_TRUE(ring.closed());
  // After close a wait returns at once.
  const auto start = steady_clock::now();
  EXPECT_TRUE(ring.waitAfter(0, start + std::chrono::hours(1))->empty());
  EXPECT_LT(steady_clock::now() - start, std::chrono::seconds(1));
}

}  // namespace
}  // namespace tinycad::session
