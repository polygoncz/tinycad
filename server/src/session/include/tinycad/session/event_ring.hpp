#pragma once

// The events of one runtime document for WatchSession (spec 14 "Události", Q094 principle 3):
// a ring of the last 256 SessionEvents with seq growing by 1 per event of the document (not the
// seq of the log: an Apply in a transaction makes a new generation without an entry).
//
// The only class of the session layer that is shared between threads WITHOUT the document lock:
// a WatchSession handler blocks in waitAfter() on its own gRPC thread while changes append on
// others. So it has its own mutex and condition variable (decision N54); append never blocks on a
// watcher.
//
// seq starts at 1 for the first event of a RuntimeDocument instance and restarts when the
// document is unloaded and loaded again (every session of it was closed, so no client holds an
// old seq of it; a client with a seq from a previous instance gets resync, see after()).

#include <chrono>
#include <condition_variable>
#include <cstddef>
#include <cstdint>
#include <deque>
#include <mutex>
#include <optional>
#include <vector>

#include "tinycad/session/session_event.hpp"

namespace tinycad::session {

class EventRing {
 public:
  /** capacity >= 1 (TINYCAD_ASSERT); spec 14: 256. */
  explicit EventRing(std::size_t capacity = 256);

  /**
   * Stores the event with seq = lastSeq() + 1 (the seq field of `event` is overwritten), drops the
   * oldest beyond capacity and wakes every waiter. Returns the seq.
   */
  std::uint64_t append(SessionEvent event);

  /** 0 before the first event (OpenSessionResponse.event_seq). */
  [[nodiscard]] std::uint64_t lastSeq() const;

  /**
   * The events with seq > afterSeq, in order (empty when none yet). nullopt = the client needs
   * `resync`: afterSeq is older than the oldest kept event minus one (evicted), or newer than
   * lastSeq() (a seq of another instance).
   */
  [[nodiscard]] std::optional<std::vector<SessionEvent>> after(
      std::uint64_t afterSeq) const;

  /**
   * Blocks until an event with seq > afterSeq exists, close() was called or `deadline` passed
   * (the heartbeat interval of the caller); then returns after(afterSeq) (possibly empty).
   */
  [[nodiscard]] std::optional<std::vector<SessionEvent>> waitAfter(
      std::uint64_t afterSeq, std::chrono::steady_clock::time_point deadline) const;

  /** Wakes every waiter for good: the document is being unloaded. waitAfter returns at once. */
  void close();
  [[nodiscard]] bool closed() const;

 private:
  std::size_t capacity_;
  mutable std::mutex mutex_;
  mutable std::condition_variable changed_;
  std::deque<SessionEvent> events_;
  std::uint64_t lastSeq_ = 0;
  bool closed_ = false;
};

}  // namespace tinycad::session
