#pragma once

// The server is the authority over sketch data (Q097, Q103, spec 14 "Změny dokumentu"): before an
// operation that writes sketch data enters the dispatcher, the session (M45) passes it through
// SketchOperationSolver. The server solves the sketch with native planegcs and the operation
// carries the SERVER solution; the log stores the solved params, so replay, undo and loading never
// need the solver (decision N47 ⚠: before the handler, not inside it).

#include <optional>
#include <string>
#include <vector>

#include "tinycad/core/json.hpp"
#include "tinycad/core/result.hpp"
#include "tinycad/document/document.hpp"
#include "tinycad/document/schema.hpp"
#include "tinycad/sketch/solver.hpp"

namespace tinycad::features {

/** SKETCH_NOT_SOLVED (errors.proto): issues [{ param: "sketch", code: "sketch.notSolved" }]. */
struct SketchNotSolved {
  /** The sketch feature the solver did not solve. */
  document::FeatureId feature;
  /** Technical text (status, conflicting ids); never compared. */
  std::string message;
  std::vector<document::ParamIssue> issues;
};

class SketchOperationSolver {
 public:
  /** `solver` must outlive this object; not thread-safe (one per session or runtime document). */
  explicit SketchOperationSolver(sketch::ConstraintSolver& solver);

  /**
   * The operation with every sketch it writes replaced by the server solution:
   * - feature.setParams whose target feature in `doc` has type "sketch",
   * - feature.add whose feature has type "sketch",
   * - the same inside a batch (recursively), in order.
   * Only `entities` change (Sketch::entitiesJson of the solved entities); `plane` and
   * `constraints` stay. Every other operation is returned unchanged (the same JSON value).
   * Params that do not parse as a sketch (Sketch::parse fails) are returned unchanged too: the
   * feature is then red with INVALID_PARAMS like today, not an RPC error (spec 14).
   * A sketch whose solve status is not Ok (Conflict or Failed) → SketchNotSolved; the caller
   * leaves the document, the transaction and the log unchanged.
   */
  core::Result<core::Json, SketchNotSolved> solve(const core::Json& operation,
                                                  const document::DocumentReader& doc);

 private:
  sketch::ConstraintSolver& solver_;
};

}  // namespace tinycad::features
