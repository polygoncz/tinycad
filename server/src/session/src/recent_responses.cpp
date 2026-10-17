#include "tinycad/session/recent_responses.hpp"

#include "tinycad/core/result.hpp"

namespace tinycad::session {

RecentResponses::RecentResponses(std::size_t capacity) : capacity_(capacity) {
  TINYCAD_ASSERT(capacity >= 1, "RecentResponses needs a capacity of at least 1");
}

RecentResponses::Lookup RecentResponses::lookup(const storage::OperationKey& key) const {
  const auto found = fingerprints_.find(key.id);
  if (found == fingerprints_.end()) return Lookup::New;
  return found->second == key.fingerprint ? Lookup::Repeated : Lookup::Reused;
}

void RecentResponses::remember(const storage::OperationKey& key) {
  const auto found = fingerprints_.find(key.id);
  if (found != fingerprints_.end()) {
    // Already kept (the caller remembers only New keys, but stay a set of ids in any case).
    found->second = key.fingerprint;
    return;
  }
  order_.push_back(key.id);
  fingerprints_.emplace(key.id, key.fingerprint);
  while (order_.size() > capacity_) {
    fingerprints_.erase(order_.front());
    order_.pop_front();
  }
}

}  // namespace tinycad::session
