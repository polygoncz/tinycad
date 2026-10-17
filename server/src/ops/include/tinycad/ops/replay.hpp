#pragma once

// Replaying a log into a document (spec 04, src/ops/replay.ts): loading a document from its
// snapshot and the entries after it (M41) and the property test of determinism (N28).

#include <cstdint>
#include <vector>

#include "tinycad/core/result.hpp"
#include "tinycad/document/document.hpp"
#include "tinycad/ops/handler.hpp"
#include "tinycad/ops/log.hpp"

namespace tinycad::ops {

/** The entry whose op failed, and why. */
struct ReplayError {
  std::int64_t seq = 0;
  OperationLoadError error;
};

/**
 * Applies entry.op of every entry in order (for undo and redo entries op is exactly what was
 * applied). Stops at the first failing entry; the entries before it stay applied.
 */
core::Result<void, ReplayError> replayLog(document::DocumentWriter& doc,
                                          const OpHandlerRegistry& handlers,
                                          const std::vector<LogEntry>& entries);

}  // namespace tinycad::ops
