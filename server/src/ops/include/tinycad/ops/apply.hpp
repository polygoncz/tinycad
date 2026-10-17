#pragma once

// The one place where an operation reaches the document (spec 04 "applyOperation",
// src/ops/apply.ts): shared by the dispatcher, transactions and replayLog, so validation, batch
// inverses and restoring the rollback bar are handled the same everywhere.

#include "tinycad/core/result.hpp"
#include "tinycad/document/document.hpp"
#include "tinycad/ops/handler.hpp"
#include "tinycad/ops/operation.hpp"

namespace tinycad::ops {

/**
 * Applies the operation and returns its inverse, or the error with the document unchanged.
 *
 * - Envelope and validation: an object with a known `type`, `v` equal to the current version
 *   (upcast belongs to loading only) and a payload the handler's validate accepts – the same
 *   checks as loading, so what is written can always be read back (M19.1). The error path is
 *   the first problem's path.
 * - A batch is atomic: when a sub-operation fails, the applied ones are reverted and the error
 *   path is prefixed with 'ops[i]'. Its inverse is a batch of the inverses in reverse order.
 * - When the handler moved the rollback bar or changed the count or order of features (except
 *   studio.setRollback), the inverse is a batch of the handler's inverse and a studio.setRollback
 *   back to the old bar: the mutators shift the bar by rules that are not exactly invertible (Q029).
 */
core::Result<Operation, OperationLoadError> applyOperation(document::DocumentWriter& doc,
                                                           const OpHandlerRegistry& handlers,
                                                           const Operation& op);

}  // namespace tinycad::ops
