#pragma once

// Loading an operation from outside (spec 04 "Verzování operací", src/ops/upcast.ts).

#include "tinycad/core/result.hpp"
#include "tinycad/ops/handler.hpp"
#include "tinycad/ops/operation.hpp"

namespace tinycad::ops {

/**
 * Raw data from outside → an operation of the current version. Checks the envelope, upcasts an
 * older version and lets the handler validate the payload (Q032), the first problem wins; a batch
 * recursively, with the paths 'ops[i].…'. An upcast returning another version than the current
 * one is a programmer error (AssertionError).
 */
core::Result<Operation, OperationLoadError> upcastOperation(const OpHandlerRegistry& handlers,
                                                            const Json& raw);

}  // namespace tinycad::ops
