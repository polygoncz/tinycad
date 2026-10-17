#pragma once

// Loading a log entry from outside (persistence, spec 05; src/ops/parse-entry.ts).

#include "tinycad/core/result.hpp"
#include "tinycad/ops/handler.hpp"
#include "tinycad/ops/log.hpp"

namespace tinycad::ops {

/**
 * Raw data → LogEntry. seq a whole number >= 1, kind 'do' | 'undo' | 'redo', target absent for
 * 'do' and a whole number in 1..seq−1 otherwise, label a string, time a finite number; op and
 * inverse go through upcastOperation (paths 'op.…', 'inverse.…'). Whether target points at a 'do'
 * entry is left to rebuildUndoStacks. Only the known fields are kept.
 */
core::Result<LogEntry, OperationLoadError> parseLogEntry(const OpHandlerRegistry& handlers,
                                                         const Json& raw);

}  // namespace tinycad::ops
