#pragma once

// Helpers of the PlanegcsSolver tests (port of the helpers of
// test/unit/solver-planegcs/solve.test.ts): sketches from JSON, the rectangle of
// src/sketch/testing.ts, solving and reading solved points.

#include <gtest/gtest.h>

#include <optional>
#include <string>

#include "tinycad/sketch/sketch.hpp"
#include "tinycad/sketch/solver.hpp"
#include "tinycad/solver_planegcs/planegcs_solver.hpp"

namespace tinycad::solver_planegcs::testing {

using sketch::Json;
using sketch::Sketch;
using sketch::SolveResult;
using sketch::SolveStatus;
using core::Vec2;

inline Json J(const char* text) { return Json::parse(text); }

/** The array `base` with `more` appended (not `concat`: ADL would find nlohmann's). */
inline Json appended(Json base, const Json& more) {
  for (const auto& item : more) base.push_back(item);
  return base;
}

/** A sketch from valid data; fails the test for invalid data. */
inline Sketch sketchOf(const Json& entities, const Json& constraints = Json::array()) {
  auto parsed = Sketch::parse(entities, constraints);
  if (!parsed) {
    ADD_FAILURE() << "invalid test sketch: " << entities.dump() << " " << constraints.dump();
    return Sketch({}, {});
  }
  return std::move(*parsed);
}

/** The rectangle 10 × 5 from [0, 0] (rectangleData): points a b c d, lines ab bc cd da. */
inline const Json RECTANGLE_ENTITIES = J(R"([
  {"kind": "point", "id": "a", "x": 0, "y": 0},
  {"kind": "point", "id": "b", "x": 10, "y": 0},
  {"kind": "point", "id": "c", "x": 10, "y": 5},
  {"kind": "point", "id": "d", "x": 0, "y": 5},
  {"kind": "line", "id": "ab", "p1": "a", "p2": "b"},
  {"kind": "line", "id": "bc", "p1": "b", "p2": "c"},
  {"kind": "line", "id": "cd", "p1": "c", "p2": "d"},
  {"kind": "line", "id": "da", "p1": "d", "p2": "a"}
])");
inline const Json RECTANGLE_CONSTRAINTS = J(R"([
  {"kind": "horizontal", "id": "h1", "line": "ab"},
  {"kind": "vertical", "id": "v1", "line": "bc"},
  {"kind": "horizontal", "id": "h2", "line": "cd"},
  {"kind": "vertical", "id": "v2", "line": "da"}
])");

/** The rectangle plus extra constraints. */
inline Sketch rectangle(const Json& extra = Json::array()) {
  return sketchOf(RECTANGLE_ENTITIES, appended(RECTANGLE_CONSTRAINTS, extra));
}

inline SolveResult solve(const Sketch& sketch, const std::optional<sketch::Drag>& drag = {}) {
  PlanegcsSolver solver;
  return solver.solve(sketch, drag);
}

inline sketch::Drag dragOf(const std::string& point, Vec2 to) {
  return {sketch::SketchEntityId(point), to};
}

/** The solved point `id`; fails the test when there is none. */
inline Vec2 pointOf(const SolveResult& result, const std::string& id) {
  if (result.entities) {
    for (const auto& e : *result.entities) {
      if (e->id().str() == id && e->kind() == sketch::EntityKind::Point) {
        return {e->as<sketch::SketchPoint>().x, e->as<sketch::SketchPoint>().y};
      }
    }
  }
  ADD_FAILURE() << "no point " << id;
  return {0, 0};
}

inline void expectPoint(const Vec2& p, double x, double y) {
  EXPECT_NEAR(p[0], x, 1e-6);
  EXPECT_NEAR(p[1], y, 1e-6);
}

/** The ids of a list as strings. */
inline std::vector<std::string> strings(const std::vector<sketch::SketchConstraintId>& ids) {
  std::vector<std::string> out;
  for (const auto& id : ids) out.push_back(id.str());
  return out;
}

}  // namespace tinycad::solver_planegcs::testing
