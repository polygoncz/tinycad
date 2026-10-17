#pragma once

// In-memory idempotence of the transaction steps (spec 14 "Idempotence", decision N58):
// BeginTransaction, Apply, ApplyTransient and Abort never reach the log, so their operation ids
// live in the session, the last 64 of them. Durable requests (Dispatch, Commit, Undo, Redo) are
// PersistentDocument's (SQLite, N34), not this cache's.
//
// Only successes are remembered: a step that failed is executed again on retry and fails the same
// way (or succeeds, when the document moved on – a retry after an error is a new attempt). A hit
// returns nothing to replay: the step had no log entry, the caller answers with the CURRENT read
// model, so a repeated Apply is applied once.
//
// A plain bounded FIFO (KISS): a deque of ids in arrival order and a map id → fingerprint. Owned by
// one Session; the SessionManager calls it under the document lock, so it has no lock of its own.

#include <cstddef>
#include <deque>
#include <string>
#include <unordered_map>

#include "tinycad/storage/store.hpp"

namespace tinycad::session {

class RecentResponses {
 public:
  enum class Lookup {
    /** Not seen (or already evicted): execute the step, then remember() it. */
    New,
    /** Seen with the same fingerprint: do not execute, answer with the current read model. */
    Repeated,
    /** Seen with another fingerprint: OPERATION_ID_REUSED. */
    Reused,
  };

  /** capacity >= 1 (TINYCAD_ASSERT); spec 14: 64. */
  explicit RecentResponses(std::size_t capacity = 64);

  [[nodiscard]] Lookup lookup(const storage::OperationKey& key) const;

  /** After a successful step. The oldest id leaves once more than `capacity` are kept. */
  void remember(const storage::OperationKey& key);

  [[nodiscard]] std::size_t size() const { return order_.size(); }

 private:
  std::size_t capacity_;
  std::deque<std::string> order_;
  std::unordered_map<std::string, std::string> fingerprints_;
};

}  // namespace tinycad::session
