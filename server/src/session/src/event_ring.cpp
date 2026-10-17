// Stub of M45 task 1, made minimally working by task 3 so the runtime document can append and
// close events in its tests (the ring itself is task 2's: its implementation replaces this file
// when the tasks merge).
#include "tinycad/session/event_ring.hpp"

#include <utility>

#include "tinycad/core/result.hpp"

namespace tinycad::session {

EventRing::EventRing(std::size_t capacity) : capacity_(capacity) {
  TINYCAD_ASSERT(capacity >= 1, "EventRing needs a capacity of at least 1");
}

std::uint64_t EventRing::append(tinycad::v1::SessionEvent event) {
  std::uint64_t seq = 0;
  {
    const std::lock_guard lock(mutex_);
    seq = ++lastSeq_;
    event.set_seq(seq);
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

std::optional<std::vector<tinycad::v1::SessionEvent>> EventRing::after(
    std::uint64_t afterSeq) const {
  const std::lock_guard lock(mutex_);
  if (afterSeq > lastSeq_) return std::nullopt;
  const std::uint64_t oldest = events_.empty() ? lastSeq_ + 1 : events_.front().seq();
  if (afterSeq + 1 < oldest) return std::nullopt;
  std::vector<tinycad::v1::SessionEvent> out;
  for (const auto& event : events_) {
    if (event.seq() > afterSeq) out.push_back(event);
  }
  return out;
}

std::optional<std::vector<tinycad::v1::SessionEvent>> EventRing::waitAfter(
    std::uint64_t afterSeq, std::chrono::steady_clock::time_point deadline) const {
  {
    std::unique_lock lock(mutex_);
    changed_.wait_until(lock, deadline, [&] { return closed_ || lastSeq_ > afterSeq; });
  }
  return after(afterSeq);
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
