// The runner of the shared cases sketch.solve and sketch.derived (spec 13, "Druhy případů"; Q109;
// the TypeScript twin is test/integration/shared-cases/sketch.test.ts): the native planegcs
// solver on a SolveInput, and the derived curves of a sketch (patternCopies, textCurves,
// regionCurves). A sketch.solve case compares status, dof and the sorted conflicting and redundant
// ids always, the whole entities only at dof 0; at dof > 0 the entities without their numbers and
// the dragged point, and the solved entities must be a fixed point of the solver (they go to the
// solver again without the drag and must not move).

#include <gtest/gtest.h>

#include <algorithm>
#include <limits>
#include <optional>
#include <stdexcept>
#include <string>

#include "support/compare.hpp"
#include "support/shared_cases.hpp"
#include "tinycad/core/json.hpp"
#include "tinycad/sketch/sketch.hpp"
#include "tinycad/sketch/solver.hpp"
#include "tinycad/solver_planegcs/planegcs_solver.hpp"

namespace tinycad::testing {
namespace {

using core::Json;
using sketch::Sketch;

/** A sketch.solve input: the parsed sketch and the optional drag. */
struct SolveInput {
  Sketch sketch;
  std::optional<sketch::Drag> drag;
};

/** { entities, constraints } through Sketch::parse; a broken sketch is a broken case. */
Sketch sketchOf(const Json& input, const std::vector<std::string>& keys) {
  if (!input.is_object()) throw std::runtime_error("the input is not an object");
  for (const auto& [key, value] : input.items()) {
    if (std::find(keys.begin(), keys.end(), key) == keys.end()) {
      throw std::runtime_error("unknown property '" + key + "' of the input");
    }
  }
  const Json none;
  auto parsed = Sketch::parse(input.value("entities", none), input.value("constraints", none));
  if (!parsed) throw std::runtime_error("invalid sketch: " + input.dump());
  return std::move(*parsed);
}

SolveInput solveInputOf(const Json& input) {
  SolveInput out{sketchOf(input, {"entities", "constraints", "drag"}), std::nullopt};
  if (!input.contains("drag")) return out;
  const Json& drag = input.at("drag");
  const auto to = core::readVec2(drag.value("to", Json()));
  if (!drag.contains("point") || !drag.at("point").is_string() || !to) {
    throw std::runtime_error("input.drag must be { point: string, to: [x, y] }");
  }
  out.drag = sketch::Drag{sketch::SketchEntityId(drag.at("point").get<std::string>()), *to};
  return out;
}

Json idsJson(std::vector<sketch::SketchConstraintId> ids) {
  // The solver reports them in no defined order (spec 13: lists sorted).
  std::sort(ids.begin(), ids.end());
  Json out = Json::array();
  for (const auto& id : ids) out.push_back(id.str());
  return out;
}

const char* statusName(sketch::SolveStatus status) {
  switch (status) {
    case sketch::SolveStatus::Ok:
      return "ok";
    case sketch::SolveStatus::Conflict:
      return "conflict";
    case sketch::SolveStatus::Failed:
      break;
  }
  return "failed";
}

/** The output of sketch.solve: the SolveResult with conflicting and redundant sorted. */
Json solveOutput(const Sketch& sketch, const std::optional<sketch::Drag>& drag) {
  solver_planegcs::PlanegcsSolver solver;
  const sketch::SolveResult result = solver.solve(sketch, drag);
  Json entities = nullptr;
  if (result.entities) {
    entities = Json::array();
    for (const auto& e : *result.entities) entities.push_back(sketch::entityJson(*e));
  }
  return {{"status", statusName(result.status)},
          {"dof", result.dof ? Json(*result.dof) : Json(nullptr)},
          {"conflicting", idsJson(result.conflicting)},
          {"redundant", idsJson(result.redundant)},
          {"entities", entities}};
}

Json curvesJson(const std::vector<sketch::Curve2>& curves) {
  Json out = Json::array();
  for (const auto& c : curves) out.push_back(core::curve2Json(c));
  return out;
}

Json derivedOutput(const Json& input) {
  const Sketch sketch = sketchOf(input, {"entities", "constraints"});
  Json copies = Json::array();
  for (const auto& e : sketch.patternCopies()) copies.push_back(sketch::entityJson(*e));
  return {{"ok",
           {{"copies", copies},
            {"textCurves", curvesJson(sketch.textCurves())},
            {"regionCurves", curvesJson(sketch.regionCurves())}}}};
}

/** The entities compared with every number ignored: unlimited tolerances (spec 13, Q109). */
std::optional<std::string> structureDifference(const Json& expected, const Json& actual) {
  constexpr double any = std::numeric_limits<double>::infinity();
  return firstDifference(expected, actual, Tolerance{any, any, any}, "expected.ok.entities");
}

/** The dragged point of a drag case against its recorded coordinates within `length`. */
std::optional<std::string> draggedPointDifference(const Json& expected, const Json& actual,
                                                  const SolveInput& input,
                                                  const Tolerance& tolerance) {
  if (!input.drag) return std::nullopt;
  const std::string& id = input.drag->point.str();
  for (std::size_t i = 0; i < expected.size(); ++i) {
    if (expected[i].value("id", "") != id) continue;
    // The structure matched already, so the actual entity sits at the same index.
    return firstDifference(expected[i], actual[i], tolerance,
                           "expected.ok.entities[" + std::to_string(i) + "]");
  }
  return "expected.ok.entities: no dragged point '" + id + "'";
}

/** Why the solved data is not a fixed point of the solver, or nullopt when it is. */
std::optional<std::string> fixedPointDifference(const Json& solvedEntities,
                                                const Json& constraints, const Json& dof,
                                                const Tolerance& tolerance) {
  const Sketch solved =
      sketchOf({{"entities", solvedEntities}, {"constraints", constraints}},
               {"entities", "constraints"});
  const Json again = solveOutput(solved, std::nullopt);
  if (again.at("status") != "ok") {
    return "fixed point: the second solve is '" + again.at("status").get<std::string>() + "'";
  }
  if (again.at("dof") != dof) {
    return "fixed point: dof " + dof.dump() + " ≠ " + again.at("dof").dump();
  }
  const auto moved =
      firstDifference(solved.entitiesJson(), again.at("entities"), tolerance,
                      "fixedPoint.entities");
  if (moved) return "fixed point: " + *moved;
  return std::nullopt;
}

/** The comparison of sketch.solve (spec 13, Q109); see the header comment. */
std::optional<std::string> verifySolve(const Json& expected, const Json& actual,
                                       const Json& rawInput, const Tolerance& tolerance) {
  if (!expected.contains("ok") || !actual.contains("ok")) {
    return firstDifference(expected, actual, tolerance);
  }
  const Json& want = expected.at("ok");
  const Json& got = actual.at("ok");
  if (want.at("dof") == 0 || want.at("dof").is_null()) {
    return firstDifference(expected, actual, tolerance);
  }
  Json wantRest = want;
  Json gotRest = got;
  wantRest.erase("entities");
  gotRest.erase("entities");
  if (auto d = firstDifference(Json{{"ok", wantRest}}, Json{{"ok", gotRest}}, tolerance)) return d;
  const Json& wantEntities = want.at("entities");
  const Json& gotEntities = got.at("entities");
  if (wantEntities.is_null() != gotEntities.is_null()) {
    return std::string("expected.ok.entities: ") + (wantEntities.is_null() ? "null" : "entities") +
           " ≠ " + (gotEntities.is_null() ? "null" : "entities");
  }
  if (gotEntities.is_null()) return std::nullopt;
  if (auto d = structureDifference(wantEntities, gotEntities)) return d;
  const SolveInput input = solveInputOf(rawInput);
  if (auto d = draggedPointDifference(wantEntities, gotEntities, input, tolerance)) return d;
  return fixedPointDifference(gotEntities, input.sketch.constraintsJson(), got.at("dof"),
                              tolerance);
}

class SketchSharedCase : public ::testing::TestWithParam<std::string> {};

TEST_P(SketchSharedCase, MatchesExpected) {
  const Json sharedCase = loadCase("sketch", GetParam());
  const std::string kind = sharedCase.at("kind").get<std::string>();
  ASSERT_TRUE(sharedCase.contains("expected")) << "'expected' is missing";
  const Json& input = sharedCase.at("input");
  const Tolerance tolerance = resolveTolerance(sharedCase.value("tolerance", Json(nullptr)));

  std::optional<std::string> difference;
  Json actual;
  if (kind == "sketch.solve") {
    const SolveInput solveInput = solveInputOf(input);
    actual = {{"ok", solveOutput(solveInput.sketch, solveInput.drag)}};
    difference = verifySolve(sharedCase.at("expected"), actual, input, tolerance);
  } else if (kind == "sketch.derived") {
    actual = derivedOutput(input);
    difference = firstDifference(sharedCase.at("expected"), actual, tolerance);
  } else {
    FAIL() << "a case of another kind: " << kind;
  }
  EXPECT_FALSE(difference.has_value())
      << GetParam() << ".json: " << sharedCase.at("description").get<std::string>() << "\n"
      << difference.value_or("") << "\nactual: " << actual.dump();
}

std::string testName(const ::testing::TestParamInfo<std::string>& info) {
  std::string name = info.param;
  for (char& c : name) {
    if (c == '-') c = '_';
  }
  return name;
}

INSTANTIATE_TEST_SUITE_P(Sketch, SketchSharedCase, ::testing::ValuesIn(caseNames("sketch")),
                         testName);

// No folder or no case would leave the suite empty and green.
TEST(SketchSharedCases, AreFound) { EXPECT_FALSE(caseNames("sketch").empty()); }

}  // namespace
}  // namespace tinycad::testing
