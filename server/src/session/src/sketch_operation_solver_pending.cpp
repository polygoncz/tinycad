// TEMPORARY (M45 task 3): features::SketchOperationSolver is implemented by M44.1 in parallel and
// is not on this branch yet. This pass-through definition lets tinycad_session link meanwhile:
// every operation comes back unchanged, so no sketch is re-solved. DELETE this file (and its line
// in CMakeLists.txt) when M44.1 merges, otherwise it would shadow the real solver.
#include "tinycad/features/sketch_solve.hpp"

namespace tinycad::features {

SketchOperationSolver::SketchOperationSolver(sketch::ConstraintSolver& solver) : solver_(solver) {}

core::Result<core::Json, SketchNotSolved> SketchOperationSolver::solve(
    const core::Json& operation, const document::DocumentReader& /*doc*/) {
  return operation;
}

}  // namespace tinycad::features
