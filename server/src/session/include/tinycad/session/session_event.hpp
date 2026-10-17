#pragma once

// A stored event of a runtime document (spec 14 "Události") as domain data: what the EventRing
// keeps. `resync` and `heartbeat` are no stored events; WatchSession of the rpc layer makes them
// itself, and converts the stored ones by rpc::sessionEventToProto.

#include <cstdint>
#include <string>

#include "tinycad/document/model.hpp"
#include "tinycad/regen/state.hpp"

namespace tinycad::session {

struct SessionEvent {
  enum class Kind { Changed, RegenProgress };

  Kind kind = Kind::Changed;
  /** Assigned by EventRing::append. */
  std::uint64_t seq = 0;
  /** The change counter of the runtime document (N55). */
  std::uint64_t generation = 0;
  /** Changed: seq of the last log entry. */
  std::int64_t lastSeq = 0;
  /** Changed: the session that made the change; "" = DocumentService (rename) or a reload. */
  std::string bySessionId;
  /** RegenProgress: the feature that was built. */
  document::FeatureId featureId;
  /** RegenProgress: its status. */
  regen::FeatureStatus status;
};

}  // namespace tinycad::session
