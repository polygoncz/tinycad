// One solve of a sketch with planegcs (spec 12 "Řešič vazeb", Adaptér; ADR 0016): port of
// solveSketch, solveOnce and solveWith of src/solver-planegcs/solve.ts.

#include "tinycad/solver_planegcs/planegcs_solver.hpp"

#include <exception>
#include <new>

#include "gcs_wrapper.hpp"
#include "primitives.hpp"
#include "read_back.hpp"
#include "tinycad/core/result.hpp"

namespace tinycad::solver_planegcs {

namespace {

using sketch::SolveResult;
using sketch::SolveStatus;

/** The result of a solve that did not work out: no positions, no degrees of freedom. */
SolveResult failed() { return {}; }

struct Solved {
  SolveResult result;
  /** The points on a spline whose parameter left [0, 1], with the end it passed. */
  Ends ends;
};

Solved solveOnce(const sketch::Sketch& sketch, const std::optional<sketch::Drag>& drag,
                 const Ends& ends) {
  // A new system for every solve (the wrapper cannot remove a constraint); released at the end.
  GcsWrapper w;
  const Primitives built = toPrimitives(sketch, drag, ends);
  if (!built.primitives) return {failed(), {}};
  // Unfixed, so the parameter is a variable; before the constraints that refer to it.
  for (const auto& p : built.params) w.pushSketchParam(p.name, p.value, false);
  for (const auto& p : *built.primitives) w.pushPrimitive(p);

  const GcsStatus status = w.solve();
  const auto rawConflicting = w.conflicting();
  SolveResult result;
  result.conflicting = backToIds(rawConflicting, built.constraintIds);
  result.redundant = backToIds(w.redundant(), built.constraintIds);
  // Temporary drag constraints do not count, so this is the dof without the drag.
  result.dof = w.dof() - unusedSplineParams(*built.primitives);

  // From the raw list: a conflict among internal constraints only is a conflict too (spec 12,
  // Spliny), just with an empty list.
  if (!rawConflicting.empty()) {
    result.status = SolveStatus::Conflict;
    return {result, ends};
  }
  if (status != GcsStatus::Success && status != GcsStatus::Converged) return {failed(), {}};

  w.applySolution();
  auto entities = readEntities(w, sketch.entities());
  if (!entities) return {failed(), {}};
  result.status = SolveStatus::Ok;
  result.entities = std::move(*entities);
  return {result, passedEnds(w, built.params)};
}

}  // namespace

/**
 * A point on a spline has a free curve parameter, which planegcs cannot keep in [0, 1]. When it
 * leaves the range, the sketch is solved once more with every such parameter fixed at the end it
 * passed (spec 12, Spliny, Bod na splinu). The dof is the one of the first solve; a conflict or
 * failure of the second one is the result. What planegcs, Eigen and the wrapper throw for a sketch
 * they cannot take (std::runtime_error and other std::exception) is a failed solve; a bug
 * (core::AssertionError), running out of memory (std::bad_alloc) and anything else propagate
 * (N108).
 */
sketch::SolveResult PlanegcsSolver::solve(const sketch::Sketch& sketch,
                                          const std::optional<sketch::Drag>& drag) {
  try {
    Solved first = solveOnce(sketch, drag, {});
    if (first.ends.empty()) return first.result;
    SolveResult second = solveOnce(sketch, drag, first.ends).result;
    if (second.status == SolveStatus::Failed) return second;
    second.dof = first.result.dof;
    return second;
  } catch (const core::AssertionError&) {
    throw;
  } catch (const std::bad_alloc&) {
    throw;
  } catch (const std::exception&) {
    return failed();
  }
}

}  // namespace tinycad::solver_planegcs
