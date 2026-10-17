#include "tinycad/ops/replay.hpp"

#include "tinycad/ops/apply.hpp"

namespace tinycad::ops {

core::Result<void, ReplayError> replayLog(document::DocumentWriter& doc,
                                          const OpHandlerRegistry& handlers,
                                          const std::vector<LogEntry>& entries) {
  for (const LogEntry& entry : entries) {
    auto applied = applyOperation(doc, handlers, entry.op);
    if (!applied) return core::fail(ReplayError{entry.seq, applied.error()});
  }
  return {};
}

}  // namespace tinycad::ops
