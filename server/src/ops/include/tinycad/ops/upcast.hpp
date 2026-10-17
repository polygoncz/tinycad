#pragma once

// Loading an operation from outside (spec 04 "Verzování operací", src/ops/upcast.ts).

#include "tinycad/core/result.hpp"
#include "tinycad/ops/handler.hpp"
#include "tinycad/ops/operation.hpp"

namespace tinycad::ops {

/**
 * The deepest nesting of batches loading accepts (N113): a log or file from outside may nest
 * without limit and the check recurses. Writes have no limit; what they produce (an operation
 * from a client, limited by protobuf, plus the batches of inverses and transactions) stays far
 * below it.
 */
inline constexpr int MAX_BATCH_DEPTH = 64;

/**
 * Raw data from outside → an operation of the current version. Checks the envelope, upcasts an
 * older version and lets the handler validate the payload (Q032), the first problem wins; a batch
 * recursively, with the paths 'ops[i].…'; a batch nested deeper than MAX_BATCH_DEPTH
 * (the outermost batch is depth 1) fails at its own path. An upcast returning another version than the current
 * one is a programmer error (AssertionError).
 */
core::Result<Operation, OperationLoadError> upcastOperation(const OpHandlerRegistry& handlers,
                                                            const Json& raw);

}  // namespace tinycad::ops
