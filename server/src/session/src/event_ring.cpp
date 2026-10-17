#include "tinycad/session/event_ring.hpp"

#include <utility>

#include "tinycad/core/result.hpp"

namespace tinycad::session {

namespace {

/**
 * The events with seq > afterSeq of a ring holding `events` up to `lastSeq`, or nullopt for
 * resync (see EventRing::after). Called under the mutex of the ring.
 */
std::optional<std::vector<SessionEvent>> eventsAfter(
    const std::deque<SessionEvent>& events, std::uint64_t lastSeq,
    std::uint64_t afterSeq) {
  if (afterSeq > lastSeq) return std::nullopt;  // a seq of another instance
  // The kept events are seq oldest..lastSeq; afterSeq = oldest - 1 still misses nothing.
  const std::uint64_t oldest = lastSeq - events.size() + 1;
  if (afterSeq + 1 < oldest) return std::nullopt;  // evicted
  std::vector<SessionEvent> out;
  for (const auto& event : events) {
    if (event.seq > afterSeq) out.push_back(event);
  }
  return out;
}

}  // namespace

EventRing::EventRing(std::size_t capacity) : capacity_(capacity) {
  TINYCAD_ASSERT(capacity >= 1, "EventRing needs a capacity of at least 1");
}

std::uint64_t EventRing::append(SessionEvent event) {
  std::uint64_t seq = 0;
  {
    const std::lock_guard lock(mutex_);
    seq = ++lastSeq_;
    event.seq = seq;
    events_.push_back(std::move(event));
    while (events_.size() > capacity_) events_.pop_front();
  }
  changed_.notify_all();
  return seq;
}

std::uint64_t EventRing::lastSeq() const {
  const std::lock_guard lock(mutex_);
  return lastSeq_;
}

std::optional<std::vector<SessionEvent>> EventRing::after(
    std::uint64_t afterSeq) const {
  const std::lock_guard lock(mutex_);
  return eventsAfter(events_, lastSeq_, afterSeq);
}

std::optional<std::vector<SessionEvent>> EventRing::waitAfter(
    std::uint64_t afterSeq, std::chrono::steady_clock::time_point deadline) const {
  std::unique_lock lock(mutex_);
  // afterSeq != lastSeq_: either there are newer events (or evicted ones, resync) or afterSeq is
  // from the future (resync); in every such case the answer is ready without waiting.
  changed_.wait_until(lock, deadline, [&] { return closed_ || afterSeq != lastSeq_; });
  return eventsAfter(events_, lastSeq_, afterSeq);
}

void EventRing::close() {
  {
    const std::lock_guard lock(mutex_);
    closed_ = true;
  }
  changed_.notify_all();
}

bool EventRing::closed() const {
  const std::lock_guard lock(mutex_);
  return closed_;
}

}  // namespace tinycad::session
