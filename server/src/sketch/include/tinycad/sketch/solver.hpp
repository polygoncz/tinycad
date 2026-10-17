#pragma once

// The constraint solver port (spec 12 "Řešič vazeb", ADR 0016, src/sketch/solver.ts). The planegcs
// adapter is the class PlanegcsSolver in tinycad_solver_planegcs (server/src/solver-planegcs,
// decision N21). Synchronous like the kernel (N10); a failed solve is a status, never an exception.

#include <optional>
#include <vector>

#include "tinycad/core/math.hpp"
#include "tinycad/sketch/sketch.hpp"

namespace tinycad::sketch {

struct Drag {
  /** The dragged sketch point. */
  SketchEntityId point;
  /** Its target in the sketch plane; a temporary constraint that yields to the others. */
  core::Vec2 to{};
};

/** JSON "ok" | "conflict" | "failed". */
enum class SolveStatus { Ok, Conflict, Failed };

struct SolveResult {
  SolveStatus status = SolveStatus::Failed;
  /** Only Ok: the input entities in the same order, ids and fields, with new coordinates and radii. */
  std::optional<std::vector<EntityPtr>> entities;
  /** Degrees of freedom without the drag; nullopt for Failed. May be negative for a conflict. */
  std::optional<int> dof;
  /** A constraint may be in both lists (planegcs). JSON output sorts them (spec 13). */
  std::vector<SketchConstraintId> conflicting;
  std::vector<SketchConstraintId> redundant;
};

class ConstraintSolver {
 public:
  virtual ~ConstraintSolver() = default;
  /** Never throws for a sketch it cannot solve: that is SolveStatus::Failed. */
  virtual SolveResult solve(const Sketch& sketch, const std::optional<Drag>& drag) = 0;
};

}  // namespace tinycad::sketch
