#pragma once

// Operations (spec 04, src/ops/operation.ts): plain JSON objects { type, v, …payload } whose
// shape the handler of the type checks. KISS (decision N18): in C++ an operation stays JSON, the
// very JSON that goes into the log on disk (ADR 0005); typed are only the handlers that read it.

#include <array>
#include <string>
#include <string_view>
#include <utility>

#include "tinycad/core/json.hpp"

namespace tinycad::ops {

using core::Json;

/** { type, v, … } – an operation of spec 04. */
using Operation = core::Json;

/**
 * A problem of an operation from outside (a stored log, a client): where in the operation, with a
 * path relative to the checked value ('feature.params', 'ops[1].v'), and a technical text that is
 * never compared (spec 13). Returned by validate, upcastOperation, parseLogEntry and
 * applyOperation.
 */
struct OperationLoadError {
  std::string path;
  std::string message;
};

/**
 * The current schema version of every operation type (OP_VERSION in operation.ts), in one place:
 * the handlers (their version and the `v` of the inverses they make), applyOperation and upcast.
 */
inline constexpr std::array<std::pair<std::string_view, int>, 13> OP_VERSION = {{
    {"feature.add", 1},
    {"feature.remove", 1},
    // 2 since M10.1: carries typeVersion (Q035).
    {"feature.setParams", 2},
    {"feature.rename", 1},
    {"feature.suppress", 1},
    {"feature.move", 1},
    {"studio.setRollback", 1},
    {"body.rename", 1},
    {"body.setVisible", 1},
    {"body.setColor", 1},
    {"body.setMaterial", 1},
    {"document.rename", 1},
    {"batch", 1},
}};

/** The version of a type of OP_VERSION; a type that is not there throws AssertionError. */
int opVersion(std::string_view type);

/**
 * The operation renames the document (M19.2): the one test of the rule "the name is outside
 * undo"; checks the name too, because a store reads entries no handler has validated.
 */
bool isDocumentRename(const Operation& op);

/** The `type` of an operation, "" when it has none (an unchecked value). */
std::string typeOf(const Operation& op);

}  // namespace tinycad::ops
