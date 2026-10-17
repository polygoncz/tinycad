#pragma once

// The planegcs adapter of ConstraintSolver (spec 12 "Řešič vazeb", Adaptér; src/solver-planegcs).
// planegcs is vendored in server/third_party/planegcs from Salusoft89/planegcs v1.3.0 – the same
// C++ sources as the WASM build the client uses, so results match the shared cases (decision N21).

#include <optional>

#include "tinycad/sketch/solver.hpp"

namespace tinycad::solver_planegcs {

/**
 * Builds a new GCS::System for every solve and destroys it at the end (RAII), like solveSketch in
 * TS, including the second solve that sticks a point on a spline to the end it passed. Holds no
 * state between solves.
 */
class PlanegcsSolver final : public sketch::ConstraintSolver {
 public:
  sketch::SolveResult solve(const sketch::Sketch& sketch,
                            const std::optional<sketch::Drag>& drag) override;
};

}  // namespace tinycad::solver_planegcs
