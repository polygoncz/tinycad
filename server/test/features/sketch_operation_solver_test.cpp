// SketchOperationSolver (sketch_solve.hpp, decision N47, Q103) over the native PlanegcsSolver:
// the sketches an operation writes carry the server solution, an unsolvable sketch is
// SketchNotSolved, every other operation passes as the same JSON value.

#include "tinycad/features/sketch_solve.hpp"

#include <gtest/gtest.h>

#include <string>

#include "document/testing.hpp"
#include "tinycad/solver_planegcs/planegcs_solver.hpp"

namespace tinycad::features::test {
namespace {

using core::Json;

const Json RECTANGLE = Json::parse(R"([
  {"kind": "point", "id": "a", "x": 0, "y": 0},
  {"kind": "point", "id": "b", "x": 10, "y": 0},
  {"kind": "point", "id": "c", "x": 10, "y": 5},
  {"kind": "point", "id": "d", "x": 0, "y": 5},
  {"kind": "line", "id": "ab", "p1": "a", "p2": "b"},
  {"kind": "line", "id": "bc", "p1": "b", "p2": "c"},
  {"kind": "line", "id": "cd", "p1": "c", "p2": "d"},
  {"kind": "line", "id": "da", "p1": "d", "p2": "a"}
])");

/** The rectangle with its dimensions and a fixed corner: DOF 0. */
const Json DIMENSIONED = Json::parse(R"([
  {"kind": "horizontal", "id": "h1", "line": "ab"},
  {"kind": "vertical", "id": "v1", "line": "bc"},
  {"kind": "horizontal", "id": "h2", "line": "cd"},
  {"kind": "vertical", "id": "v2", "line": "da"},
  {"kind": "distance", "id": "W", "a": "a", "b": "b", "value": 10},
  {"kind": "distance", "id": "H", "a": "b", "b": "c", "value": 5},
  {"kind": "fix", "id": "fa", "point": "a"}
])");

Json planeList() {
  return Json::array({{{"kind", "plane"}, {"plane", "origin/plane:xy"}}});
}

Json sketchParams(const Json& entities, const Json& constraints) {
  return {{"plane", planeList()}, {"entities", entities}, {"constraints", constraints}};
}

/** The rectangle as a client sends it: the corners b and c moved by 1e-7. */
Json nudgedRectangle() {
  Json entities = RECTANGLE;
  entities[1]["x"] = 10 + 1e-7;
  entities[2]["x"] = 10 + 1e-7;
  entities[2]["y"] = 5 - 1e-7;
  return entities;
}

/** The constraints with the diagonal a–c of 30, which the rectangle 10 × 5 cannot have. */
Json conflicting() {
  Json constraints = DIMENSIONED;
  constraints.push_back(
      {{"kind", "distance"}, {"id", "diag"}, {"a", "a"}, {"b", "c"}, {"value", 30}});
  return constraints;
}

Json setParams(const std::string& id, const Json& params) {
  return {{"type", "feature.setParams"},
          {"v", 2},
          {"featureId", id},
          {"typeVersion", 1},
          {"params", params}};
}

Json featureAdd(const std::string& id, const std::string& type, const Json& params) {
  return {{"type", "feature.add"},
          {"v", 1},
          {"feature",
           {{"id", id}, {"type", type}, {"typeVersion", 1}, {"name", id}, {"params", params}}},
          {"index", 0}};
}

/** A document with the sketch s1 (the plain rectangle) and the box b1. */
std::unique_ptr<document::Document> aSketchDocument() {
  testing::FeatureOverrides sketch;
  sketch.id = "s1";
  sketch.type = "sketch";
  sketch.params = sketchParams(RECTANGLE, Json::array());
  testing::DocumentOptions options;
  options.features = {testing::aFeature(sketch), testing::aFeature("b1")};
  return testing::aDocument(options);
}

/** The point `id` of entities JSON as [x, y]. */
core::Vec2 pointOf(const Json& entities, const std::string& id) {
  for (const auto& e : entities) {
    if (e.at("id") == id) return {e.at("x").get<double>(), e.at("y").get<double>()};
  }
  throw std::runtime_error("no point " + id);
}

void expectExactRectangle(const Json& entities) {
  EXPECT_NEAR(pointOf(entities, "a")[0], 0, 1e-12);
  EXPECT_NEAR(pointOf(entities, "b")[0], 10, 1e-10);
  EXPECT_NEAR(pointOf(entities, "c")[0], 10, 1e-10);
  EXPECT_NEAR(pointOf(entities, "c")[1], 5, 1e-10);
  EXPECT_NEAR(pointOf(entities, "d")[1], 5, 1e-10);
}

/** A solver port that always answers `status` (planegcs cannot be made to fail on purpose). */
class FixedStatusSolver final : public sketch::ConstraintSolver {
 public:
  explicit FixedStatusSolver(sketch::SolveStatus status) : status_(status) {}
  sketch::SolveResult solve(const sketch::Sketch& /*sketch*/,
                            const std::optional<sketch::Drag>& /*drag*/) override {
    ++calls;
    sketch::SolveResult result;
    result.status = status_;
    return result;
  }
  int calls = 0;

 private:
  sketch::SolveStatus status_;
};

TEST(SketchOperationSolver, SetParamsOfASolvableSketchCarriesTheEntitiesOfTheSolver) {
  solver_planegcs::PlanegcsSolver planegcs;
  SketchOperationSolver solver(planegcs);
  const auto doc = aSketchDocument();
  const Json op = setParams("s1", sketchParams(nudgedRectangle(), DIMENSIONED));

  const auto solved = solver.solve(op, *doc);

  ASSERT_TRUE(solved.has_value()) << solved.error().message;
  expectExactRectangle(solved->at("params").at("entities"));
  // Only the entities change: plane, constraints and the rest of the operation stay.
  Json rest = *solved;
  rest["params"]["entities"] = op["params"]["entities"];
  EXPECT_EQ(rest, op);
}

TEST(SketchOperationSolver, ConflictingDimensionsAreSketchNotSolved) {
  solver_planegcs::PlanegcsSolver planegcs;
  SketchOperationSolver solver(planegcs);
  const auto doc = aSketchDocument();

  const auto solved = solver.solve(setParams("s1", sketchParams(RECTANGLE, conflicting())), *doc);

  ASSERT_FALSE(solved.has_value());
  EXPECT_EQ(solved.error().feature.str(), "s1");
  EXPECT_FALSE(solved.error().message.empty());
  EXPECT_EQ(solved.error().issues,
            (std::vector<document::ParamIssue>{{"sketch", "sketch.notSolved", Json()}}));
}

TEST(SketchOperationSolver, AFailedSolveIsSketchNotSolvedToo) {
  FixedStatusSolver failing(sketch::SolveStatus::Failed);
  SketchOperationSolver solver(failing);
  const auto doc = aSketchDocument();

  const auto solved = solver.solve(setParams("s1", sketchParams(RECTANGLE, DIMENSIONED)), *doc);

  ASSERT_FALSE(solved.has_value());
  EXPECT_EQ(solved.error().feature.str(), "s1");
  EXPECT_EQ(solved.error().issues,
            (std::vector<document::ParamIssue>{{"sketch", "sketch.notSolved", Json()}}));
  EXPECT_EQ(failing.calls, 1);
}

TEST(SketchOperationSolver, SolvesASketchInABatchBehindTheFeatureAddOfTheSameSketch) {
  solver_planegcs::PlanegcsSolver planegcs;
  SketchOperationSolver solver(planegcs);
  const auto doc = aSketchDocument();
  const Json add = featureAdd("s2", "sketch", sketchParams(Json::array(), Json::array()));
  const Json edit = setParams("s2", sketchParams(nudgedRectangle(), DIMENSIONED));
  const Json op = {{"type", "batch"}, {"v", 1}, {"ops", Json::array({add, edit})}};

  const auto solved = solver.solve(op, *doc);

  ASSERT_TRUE(solved.has_value()) << solved.error().message;
  EXPECT_EQ(solved->at("ops").at(0), op["ops"][0]);
  expectExactRectangle(solved->at("ops").at(1).at("params").at("entities"));
}

TEST(SketchOperationSolver, AConflictInsideABatchFailsTheWholeOperation) {
  solver_planegcs::PlanegcsSolver planegcs;
  SketchOperationSolver solver(planegcs);
  const auto doc = aSketchDocument();
  const Json solvable = setParams("s1", sketchParams(nudgedRectangle(), DIMENSIONED));
  const Json inner = {{"type", "batch"},
                      {"v", 1},
                      {"ops", Json::array({setParams("s1", sketchParams(RECTANGLE, conflicting()))})}};
  const Json op = {{"type", "batch"}, {"v", 1}, {"ops", Json::array({solvable, inner})}};

  const auto solved = solver.solve(op, *doc);

  ASSERT_FALSE(solved.has_value());
  EXPECT_EQ(solved.error().feature.str(), "s1");
}

TEST(SketchOperationSolver, FeatureAddOfASketchIsSolved) {
  solver_planegcs::PlanegcsSolver planegcs;
  SketchOperationSolver solver(planegcs);
  const auto doc = aSketchDocument();
  const Json op = featureAdd("s2", "sketch", sketchParams(nudgedRectangle(), DIMENSIONED));

  const auto solved = solver.solve(op, *doc);

  ASSERT_TRUE(solved.has_value()) << solved.error().message;
  expectExactRectangle(solved->at("feature").at("params").at("entities"));
}

TEST(SketchOperationSolver, FeatureAddOfAnEmptySketchPasses) {
  solver_planegcs::PlanegcsSolver planegcs;
  SketchOperationSolver solver(planegcs);
  const auto doc = aSketchDocument();
  const Json op = featureAdd("s2", "sketch", sketchParams(Json::array(), Json::array()));

  const auto solved = solver.solve(op, *doc);

  ASSERT_TRUE(solved.has_value()) << solved.error().message;
  EXPECT_EQ(*solved, op);
}

TEST(SketchOperationSolver, OtherOperationsPassAsTheSameValueWithoutCallingTheSolver) {
  FixedStatusSolver failing(sketch::SolveStatus::Failed);
  SketchOperationSolver solver(failing);
  const auto doc = aSketchDocument();
  const Json box = {{"origin", {0, 0, 0}}, {"width", 1}, {"depth", 1}, {"height", 1}};
  const std::vector<Json> ops = {
      {{"type", "feature.rename"}, {"v", 1}, {"featureId", "s1"}, {"name", "Profile"}},
      setParams("b1", box),
      featureAdd("b2", "box", box),
      // An unknown target feature: the feature will be red, the validation decides.
      setParams("nope", sketchParams(RECTANGLE, Json::array())),
      {{"type", "batch"}, {"v", 1}, {"ops", Json::array({setParams("b1", box)})}},
  };
  for (const auto& op : ops) {
    const auto solved = solver.solve(op, *doc);
    ASSERT_TRUE(solved.has_value()) << op.dump();
    EXPECT_EQ(*solved, op);
  }
  EXPECT_EQ(failing.calls, 0);
}

TEST(SketchOperationSolver, ParamsThatAreNoSketchPassUnchanged) {
  FixedStatusSolver failing(sketch::SolveStatus::Failed);
  SketchOperationSolver solver(failing);
  const auto doc = aSketchDocument();
  const std::vector<Json> ops = {
      setParams("s1", sketchParams(Json::parse(R"([{"kind": "nope"}])"), Json::array())),
      setParams("s1", {{"plane", planeList()}, {"entities", RECTANGLE}}),
      setParams("s1", Json::array()),
      featureAdd("s2", "sketch", {{"entities", 5}, {"constraints", Json::array()}}),
  };
  for (const auto& op : ops) {
    const auto solved = solver.solve(op, *doc);
    ASSERT_TRUE(solved.has_value()) << op.dump();
    EXPECT_EQ(*solved, op);
  }
  EXPECT_EQ(failing.calls, 0);
}

}  // namespace
}  // namespace tinycad::features::test
