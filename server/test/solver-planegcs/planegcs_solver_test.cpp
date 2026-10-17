// Port of test/unit/solver-planegcs/solve.test.ts: PlanegcsSolver against the native planegcs
// (spec 12 "Řešič vazeb", Adaptér). The cases recorded as shared cases sketch.solve are run by
// test/shared-cases/sketch_cases_test.cpp; here are the others and the adapter's own rules
// (ids back without suffixes, the dof correction of splines, the second solve of a point on a
// spline, failures as a status). Tests of the worker and of WASM traps have no C++ twin.

#include <gtest/gtest.h>

#include <algorithm>
#include <memory>
#include <cmath>
#include <numbers>
#include <set>
#include <string>
#include <vector>

#include "bspline.hpp"
#include "testing.hpp"

namespace tinycad::solver_planegcs {
namespace {

using namespace testing;
using sketch::EntityKind;

const Json WIDTH = J(R"({"kind": "distance", "id": "W", "a": "a", "b": "b", "value": 10})");
const Json HEIGHT = J(R"({"kind": "distance", "id": "H", "a": "b", "b": "c", "value": 5})");
const Json FIX_A = J(R"({"kind": "fix", "id": "fa", "point": "a"})");

Json with(Json item, const Json& patch) {
  for (const auto& [key, value] : patch.items()) item[key] = value;
  return item;
}

// --- degrees of freedom

TEST(PlanegcsSolverDof, ARectangleWithoutDimensionsHas4DegreesOfFreedom) {
  const SolveResult result = solve(rectangle());
  EXPECT_EQ(result.status, SolveStatus::Ok);
  EXPECT_EQ(result.dof, 4);
  EXPECT_TRUE(result.conflicting.empty());
  EXPECT_TRUE(result.redundant.empty());
}

TEST(PlanegcsSolverDof, TwoDimensionsLeave2AFix0) {
  EXPECT_EQ(solve(rectangle(Json::array({WIDTH, HEIGHT}))).dof, 2);
  const SolveResult fixed = solve(rectangle(Json::array({WIDTH, HEIGHT, FIX_A})));
  EXPECT_EQ(fixed.status, SolveStatus::Ok);
  EXPECT_EQ(fixed.dof, 0);
}

TEST(PlanegcsSolverDof, ADragDoesNotChangeTheDegreesOfFreedom) {
  const Sketch data = rectangle(Json::array({WIDTH, FIX_A}));
  EXPECT_EQ(solve(data).dof, 1);
  EXPECT_EQ(solve(data, dragOf("c", {7, 8})).dof, 1);
}

// --- positions

TEST(PlanegcsSolverPositions, AChangedDimensionMovesThePoints) {
  const SolveResult result =
      solve(rectangle(Json::array({with(WIDTH, {{"value", 20}}), HEIGHT, FIX_A})));
  ASSERT_EQ(result.status, SolveStatus::Ok);
  expectPoint(pointOf(result, "a"), 0, 0);
  expectPoint(pointOf(result, "b"), 20, 0);
  expectPoint(pointOf(result, "c"), 20, 5);
  expectPoint(pointOf(result, "d"), 0, 5);
}

TEST(PlanegcsSolverPositions, AFixKeepsThePointOnItsCoordinates) {
  Json entities = RECTANGLE_ENTITIES;
  for (auto& e : entities) {
    if (e.at("kind") == "point") {
      e["x"] = e.at("x").get<double>() + 3;
      e["y"] = e.at("y").get<double>() - 2;
    }
  }
  const Sketch data =
      sketchOf(entities, appended(RECTANGLE_CONSTRAINTS, Json::array({WIDTH, HEIGHT, FIX_A})));
  expectPoint(pointOf(solve(data, dragOf("a", {50, 50})), "a"), 3, -2);
}

TEST(PlanegcsSolverPositions, EntitiesKeepTheirOrderIdsAndFields) {
  Json entities = RECTANGLE_ENTITIES;
  entities[6]["construction"] = true;
  const Sketch data = sketchOf(
      entities, appended(RECTANGLE_CONSTRAINTS, Json::array({with(WIDTH, {{"value", 12}}), FIX_A})));
  const SolveResult result = solve(data);
  ASSERT_EQ(result.status, SolveStatus::Ok);
  ASSERT_TRUE(result.entities.has_value());
  ASSERT_EQ(result.entities->size(), data.entities().size());
  for (std::size_t i = 0; i < data.entities().size(); ++i) {
    const Json got = sketch::entityJson(*(*result.entities)[i]);
    const Json want = sketch::entityJson(*data.entities()[i]);
    EXPECT_EQ(got.at("id"), want.at("id"));
    std::set<std::string> gotKeys, wantKeys;
    for (const auto& [k, v] : got.items()) gotKeys.insert(k);
    for (const auto& [k, v] : want.items()) wantKeys.insert(k);
    EXPECT_EQ(gotKeys, wantKeys) << i;
  }
  // A line has no coordinates: the very same object comes back.
  EXPECT_EQ((*result.entities)[6], data.entities()[6]);
  expectPoint(pointOf(result, "b"), 12, 0);
}

TEST(PlanegcsSolverPositions, ACircleGetsItsRadius) {
  const SolveResult result = solve(sketchOf(J(R"([
    {"kind": "point", "id": "c", "x": 3, "y": 4},
    {"kind": "circle", "id": "C", "center": "c", "radius": 1.7}
  ])"),
                                            J(R"([
    {"kind": "fix", "id": "f", "point": "c"},
    {"kind": "radius", "id": "r", "curve": "C", "value": 2.5}
  ])")));
  ASSERT_EQ(result.status, SolveStatus::Ok);
  EXPECT_EQ(result.dof, 0);
  const auto& circle = (*result.entities)[1];
  ASSERT_EQ(circle->kind(), EntityKind::Circle);
  EXPECT_EQ(circle->as<sketch::SketchCircle>().center.str(), "c");
  EXPECT_NEAR(circle->as<sketch::SketchCircle>().radius, 2.5, 1e-6);
  expectPoint(pointOf(result, "c"), 3, 4);
}

// --- drag

TEST(PlanegcsSolverDrag, WithFreeDegreesTheDraggedPointFollowsTheTarget) {
  const SolveResult result = solve(rectangle(Json::array({WIDTH, FIX_A})), dragOf("c", {7, 8}));
  ASSERT_EQ(result.status, SolveStatus::Ok);
  expectPoint(pointOf(result, "c"), 10, 8);
  expectPoint(pointOf(result, "d"), 0, 8);
}

TEST(PlanegcsSolverDrag, InAFullyDefinedSketchNothingMoves) {
  const SolveResult result =
      solve(rectangle(Json::array({WIDTH, HEIGHT, FIX_A})), dragOf("c", {20, 20}));
  ASSERT_EQ(result.status, SolveStatus::Ok);
  EXPECT_EQ(result.dof, 0);
  EXPECT_TRUE(result.conflicting.empty());
  expectPoint(pointOf(result, "c"), 10, 5);
}

TEST(PlanegcsSolverDrag, DraggingAPointThatDoesNotExistFails) {
  const SolveResult result = solve(rectangle(), dragOf("ghost", {1, 1}));
  EXPECT_EQ(result.status, SolveStatus::Failed);
  EXPECT_FALSE(result.entities.has_value());
  EXPECT_FALSE(result.dof.has_value());
  EXPECT_TRUE(result.conflicting.empty());
  EXPECT_TRUE(result.redundant.empty());
}

TEST(PlanegcsSolverDrag, DraggingALineIsAFailedSolve) {
  EXPECT_EQ(solve(rectangle(), dragOf("ab", {1, 1})).status, SolveStatus::Failed);
}

// --- exceptions (N108)

TEST(PlanegcsSolverExceptions, ABugInTheAdapterPropagatesInsteadOfAFailedSolve) {
  // A constraint of kind pointOnCurve that is not a PointOnCurveConstraint: Sketch::parse never
  // builds one, so reading it is a bug (as<T>() asserts), not a sketch the solver cannot take.
  const Sketch valid = sketchOf(RECTANGLE_ENTITIES, RECTANGLE_CONSTRAINTS);
  std::vector<sketch::ConstraintPtr> constraints = valid.constraints();
  constraints.push_back(std::make_shared<const sketch::PairConstraint>(
      sketch::ConstraintKind::PointOnCurve, sketch::SketchConstraintId("broken"),
      sketch::SketchEntityId("a"), sketch::SketchEntityId("cd")));
  const Sketch broken(valid.entities(), constraints);
  PlanegcsSolver solver;
  EXPECT_THROW((void)solver.solve(broken, std::nullopt), core::AssertionError);
}

// --- conflicts and redundancy

TEST(PlanegcsSolverConflicts, AThirdDimensionOnTheDiagonalIsAConflictWithItsId) {
  const Json diagonal = J(R"({"kind": "distance", "id": "diag", "a": "a", "b": "c", "value": 30})");
  const SolveResult result = solve(rectangle(Json::array({WIDTH, HEIGHT, FIX_A, diagonal})));
  EXPECT_EQ(result.status, SolveStatus::Conflict);
  EXPECT_FALSE(result.entities.has_value());
  const auto ids = strings(result.conflicting);
  EXPECT_NE(std::find(ids.begin(), ids.end(), "diag"), ids.end());
}

TEST(PlanegcsSolverConflicts, ADimensionBetweenTwoFixedPointsWithAWrongValueIsAConflict) {
  const Json fixB = J(R"({"kind": "fix", "id": "fb", "point": "b"})");
  const SolveResult result = solve(rectangle(Json::array({FIX_A, fixB, with(WIDTH, {{"value", 12}})})));
  EXPECT_EQ(result.status, SolveStatus::Conflict);
  const auto ids = strings(result.conflicting);
  EXPECT_NE(std::find(ids.begin(), ids.end(), "W"), ids.end());
  // Fix ids come back without the :x/:y suffix, once each.
  for (const auto& id : ids) EXPECT_EQ(id.find(':'), std::string::npos) << id;
  EXPECT_EQ(std::set<std::string>(ids.begin(), ids.end()).size(), ids.size());
}

TEST(PlanegcsSolverConflicts, ASecondHorizontalOnTheSameLineIsOkWithARedundancy) {
  const SolveResult result =
      solve(rectangle(Json::array({J(R"({"kind": "horizontal", "id": "h1bis", "line": "ab"})")})));
  EXPECT_EQ(result.status, SolveStatus::Ok);
  EXPECT_TRUE(result.entities.has_value());
  EXPECT_FALSE(result.redundant.empty());
  for (const auto& id : strings(result.redundant)) EXPECT_TRUE(id == "h1" || id == "h1bis") << id;
}

// --- failures

TEST(PlanegcsSolverFailures, AReferenceToAMissingEntityIsAFailedSolveNotAnException) {
  // The constraint refers to a point the (unchecked) sketch does not have.
  const Sketch valid = sketchOf(appended(RECTANGLE_ENTITIES, J(R"([{"kind": "point", "id": "x",
                                                                    "x": 1, "y": 1}])")),
                                J(R"([{"kind": "distance", "id": "dx", "a": "a", "b": "x",
                                       "value": 3}])"));
  const Sketch broken = rectangle();
  const Sketch input(broken.entities(), valid.constraints());
  const SolveResult result = solve(input);
  EXPECT_EQ(result.status, SolveStatus::Failed);
  EXPECT_FALSE(result.entities.has_value());
  EXPECT_FALSE(result.dof.has_value());
}

TEST(PlanegcsSolverFailures, AnEmptySketchSolvesWithNoDegreesOfFreedom) {
  const SolveResult result = solve(Sketch({}, {}));
  EXPECT_EQ(result.status, SolveStatus::Ok);
  EXPECT_EQ(result.dof, 0);
  EXPECT_TRUE(result.entities.has_value() && result.entities->empty());
}

// --- splines

/** Four points for a cubic spline. */
const std::vector<Vec2> FIT = {{0, 0}, {1, 1}, {3, 0}, {4, 2}};

/** Sketch points `<prefix>0…` at FIT. */
Json pointsAt(const std::string& prefix, std::size_t n = 4) {
  Json out = Json::array();
  for (std::size_t i = 0; i < n; ++i) {
    out.push_back({{"kind", "point"},
                   {"id", prefix + std::to_string(i)},
                   {"x", FIT[i][0]},
                   {"y", FIT[i][1]}});
  }
  return out;
}

/** A cubic bspline 'S' with control points p0…p3 at FIT. */
Json controlSpline() {
  return appended(pointsAt("p"), J(R"([{"kind": "bspline", "id": "S", "degree": 3,
    "poles": ["p0", "p1", "p2", "p3"], "knots": [0, 0, 0, 0, 1, 1, 1, 1]}])"));
}

/** A fitSpline 'F' through the first n of FIT (bspline.interpolate of TS, recorded). */
Json fitSpline(std::size_t n = 4) {
  if (n == 2) {
    return appended(pointsAt("f", 2), J(R"([{"kind": "fitSpline", "id": "F", "degree": 1,
      "fit": ["f0", "f1"], "params": [0, 1], "poles": [[0, 0], [1, 1]], "knots": [0, 0, 1, 1]}])"));
  }
  if (n == 3) {
    return appended(pointsAt("f", 3), J(R"([{"kind": "fitSpline", "id": "F", "degree": 2,
      "fit": ["f0", "f1", "f2"], "params": [0, 0.38742588672279316, 1],
      "poles": [[0, 0], [1.1581138830084186, 2.1067971810589325], [3, 0]],
      "knots": [0, 0, 0, 1, 1, 1]}])"));
  }
  return appended(pointsAt("f"), J(R"([{"kind": "fitSpline", "id": "F", "degree": 3,
    "fit": ["f0", "f1", "f2", "f3"], "params": [0, 0.24025307335204216, 0.620126536676021, 1],
    "poles": [[0, 0], [0.9846500352828186, 3.3252906740954153],
              [4.06564641782601, -3.125290674095415], [4, 2]],
    "knots": [0, 0, 0, 0, 1, 1, 1, 1]}])"));
}

/** The curve of a spline of the solved entities (or of a sketch). */
core::BSplineShape curveOf(const std::vector<sketch::EntityPtr>& entities, const std::string& id) {
  const auto find = [&](const std::string& pid) -> Vec2 {
    for (const auto& e : entities) {
      if (e->id().str() == pid) return {e->as<sketch::SketchPoint>().x, e->as<sketch::SketchPoint>().y};
    }
    ADD_FAILURE() << "no point " << pid;
    return {0, 0};
  };
  for (const auto& e : entities) {
    if (e->id().str() != id) continue;
    if (e->kind() == EntityKind::FitSpline) {
      const auto& f = e->as<sketch::SketchFitSpline>();
      return {f.degree, f.poles, f.knots};
    }
    const auto& b = e->as<sketch::SketchBSpline>();
    std::vector<Vec2> poles;
    for (const auto& p : b.poles) poles.push_back(find(p.str()));
    return {b.degree, poles, b.knots};
  }
  ADD_FAILURE() << "no spline " << id;
  return {};
}

/** The distance of p from the curve: dense samples, then a ternary search around the nearest. */
double distanceToCurve(const core::BSplineShape& curve, const Vec2& p) {
  const auto d = [&](double t) {
    const Vec2 c = bspline::evaluate(curve, t);
    return std::hypot(c[0] - p[0], c[1] - p[1]);
  };
  constexpr int SAMPLES = 2000;
  int best = 0;
  for (int i = 1; i <= SAMPLES; ++i) {
    if (d(double(i) / SAMPLES) < d(double(best) / SAMPLES)) best = i;
  }
  double lo = std::max(0.0, double(best - 1) / SAMPLES);
  double hi = std::min(1.0, double(best + 1) / SAMPLES);
  for (int i = 0; i < 200; ++i) {
    const double m1 = lo + (hi - lo) / 3;
    const double m2 = hi - (hi - lo) / 3;
    if (d(m1) < d(m2)) {
      hi = m2;
    } else {
      lo = m1;
    }
  }
  return d((lo + hi) / 2);
}

double sine(const Vec2& a, const Vec2& b) {
  return (a[0] * b[1] - a[1] * b[0]) / (std::hypot(a[0], a[1]) * std::hypot(b[0], b[1]));
}

TEST(PlanegcsSolverSplines, ABSplineAddsOnlyItsControlPoints) {
  const SolveResult result = solve(sketchOf(controlSpline()));
  EXPECT_EQ(result.status, SolveStatus::Ok);
  EXPECT_EQ(result.dof, 8);
}

TEST(PlanegcsSolverSplines, ADraggedControlPointFollowsTheTargetTheRestStays) {
  const Sketch data = sketchOf(controlSpline());
  const SolveResult result = solve(data, dragOf("p1", {5, 5}));
  ASSERT_EQ(result.status, SolveStatus::Ok);
  EXPECT_EQ(result.dof, 8);
  expectPoint(pointOf(result, "p1"), 5, 5);
  expectPoint(pointOf(result, "p2"), 3, 0);
  EXPECT_EQ((*result.entities)[4], data.entities()[4]);
}

TEST(PlanegcsSolverSplines, AFitSplineHas2DegreesOfFreedomPerFitPoint) {
  EXPECT_EQ(solve(sketchOf(fitSpline())).dof, 8);
  EXPECT_EQ(solve(sketchOf(fitSpline(3))).dof, 6);
  EXPECT_EQ(solve(sketchOf(fitSpline(2))).dof, 4);
}

TEST(PlanegcsSolverSplines, ADraggedFitPointTheSplinePassesThroughAllFitPoints) {
  const Sketch data = sketchOf(fitSpline(), J(R"([{"kind": "fix", "id": "f0fix", "point": "f0"}])"));
  const SolveResult result = solve(data, dragOf("f1", {2, 3}));
  ASSERT_EQ(result.status, SolveStatus::Ok);
  EXPECT_EQ(result.dof, 6);
  expectPoint(pointOf(result, "f1"), 2, 3);
  expectPoint(pointOf(result, "f0"), 0, 0);
  const auto& before = data.entities()[4]->as<sketch::SketchFitSpline>();
  const auto& after = (*result.entities)[4]->as<sketch::SketchFitSpline>();
  EXPECT_NE(after.poles, before.poles);
  EXPECT_EQ(after.params, before.params);
  EXPECT_EQ(after.knots, before.knots);
  EXPECT_EQ(after.fit, before.fit);
  const auto curve = curveOf(*result.entities, "F");
  for (std::size_t i = 0; i < after.params.size(); ++i) {
    const Vec2 at = bspline::evaluate(curve, after.params[i]);
    expectPoint(pointOf(result, "f" + std::to_string(i)), at[0], at[1]);
  }
}

TEST(PlanegcsSolverSplines, ALineTangentAtTheStartOfABSplineFollowsTheEndTangent) {
  const Sketch data = sketchOf(
      appended(controlSpline(), J(R"([{"kind": "point", "id": "q", "x": -3, "y": 1},
                                      {"kind": "line", "id": "L", "p1": "q", "p2": "p0"}])")),
      J(R"([{"kind": "fix", "id": "fq", "point": "q"},
            {"kind": "tangent", "id": "t", "a": "S", "b": "L"}])"));
  const SolveResult result = solve(data);
  ASSERT_EQ(result.status, SolveStatus::Ok);
  EXPECT_EQ(result.dof, 7);
  const Vec2 q = pointOf(result, "q");
  const Vec2 p0 = pointOf(result, "p0");
  const Vec2 d = bspline::derivative(curveOf(*result.entities, "S"), 0, 1);
  EXPECT_NEAR(sine(d, {p0[0] - q[0], p0[1] - q[1]}), 0, 1e-6);
}

TEST(PlanegcsSolverSplines, ALineTangentAtTheEndOfAFitSplineFollowsTheEndTangent) {
  const Sketch data = sketchOf(
      appended(fitSpline(), J(R"([{"kind": "point", "id": "q", "x": 6, "y": 1},
                                  {"kind": "line", "id": "L", "p1": "f3", "p2": "q"}])")),
      J(R"([{"kind": "fix", "id": "fq", "point": "q"},
            {"kind": "tangent", "id": "t", "a": "L", "b": "F"}])"));
  const SolveResult result = solve(data);
  ASSERT_EQ(result.status, SolveStatus::Ok);
  EXPECT_EQ(result.dof, 7);
  const Vec2 q = pointOf(result, "q");
  const Vec2 f3 = pointOf(result, "f3");
  const auto curve = curveOf(*result.entities, "F");
  EXPECT_NEAR(sine(bspline::derivative(curve, 1, 1), {q[0] - f3[0], q[1] - f3[1]}), 0, 1e-6);
  const Vec2 end = bspline::evaluate(curve, 1);
  expectPoint(f3, end[0], end[1]);
}

TEST(PlanegcsSolverSplines, AConflictWithTheFitPointConstraintsHasNoInternalIds) {
  // Fixed fit points determine the curve; a tangent through a fixed point contradicts it.
  const Sketch data = sketchOf(
      appended(fitSpline(), J(R"([{"kind": "point", "id": "q", "x": -3, "y": 1},
                                  {"kind": "line", "id": "L", "p1": "q", "p2": "f0"}])")),
      J(R"([{"kind": "fix", "id": "fix-f0", "point": "f0"},
            {"kind": "fix", "id": "fix-f1", "point": "f1"},
            {"kind": "fix", "id": "fix-f2", "point": "f2"},
            {"kind": "fix", "id": "fix-f3", "point": "f3"},
            {"kind": "fix", "id": "fix-q", "point": "q"},
            {"kind": "tangent", "id": "t", "a": "L", "b": "F"}])"));
  const SolveResult result = solve(data);
  EXPECT_EQ(result.status, SolveStatus::Conflict);
  std::set<std::string> constraintIds;
  for (const auto& c : data.constraints()) constraintIds.insert(c->id().str());
  for (const auto& id : strings(result.conflicting)) EXPECT_TRUE(constraintIds.contains(id)) << id;
  for (const auto& id : strings(result.redundant)) EXPECT_TRUE(constraintIds.contains(id)) << id;
}

/** A point 'q' on the spline `id` at its middle with a pointOnCurve, plus extra constraints. */
Sketch onSpline(const Json& spline, const std::string& id, const Json& extra = Json::array()) {
  const Sketch plain = sketchOf(spline);
  const Vec2 q = bspline::evaluate(curveOf(plain.entities(), id), 0.5);
  return sketchOf(appended(spline, Json::array({{{"kind", "point"}, {"id", "q"}, {"x", q[0]},
                                                 {"y", q[1]}}})),
                  appended(Json::array({{{"kind", "pointOnCurve"},
                                         {"id", "on"},
                                         {"point", "q"},
                                         {"curve", id}}}),
                           extra));
}

Json fixes(const std::vector<std::string>& points) {
  Json out = Json::array();
  for (const auto& p : points) out.push_back({{"kind", "fix"}, {"id", "fix-" + p}, {"point", p}});
  return out;
}

struct SplineCase {
  const char* name;
  std::string id;
  Json spline;
  std::vector<std::string> points;
};

std::vector<SplineCase> splineCases() {
  return {{"bspline", "S", controlSpline(), {"p0", "p1", "p2", "p3"}},
          {"fitSpline", "F", fitSpline(), {"f0", "f1", "f2", "f3"}}};
}

TEST(PlanegcsSolverPointOnSpline, TakesOneDegreeOfFreedomOffThePoint) {
  for (const auto& c : splineCases()) {
    const SolveResult free = solve(onSpline(c.spline, c.id));
    EXPECT_EQ(free.status, SolveStatus::Ok) << c.name;
    EXPECT_EQ(free.dof, 9) << c.name;
    const SolveResult fixed = solve(onSpline(c.spline, c.id, fixes(c.points)));
    EXPECT_EQ(fixed.status, SolveStatus::Ok) << c.name;
    EXPECT_EQ(fixed.dof, 1) << c.name;
  }
}

TEST(PlanegcsSolverPointOnSpline, StaysOnTheCurveWhenThePointIsDragged) {
  for (const auto& c : splineCases()) {
    const Sketch data = onSpline(c.spline, c.id, fixes(c.points));
    const SolveResult result = solve(data, dragOf("q", {2, 1}));
    ASSERT_EQ(result.status, SolveStatus::Ok) << c.name;
    EXPECT_EQ(result.dof, 1) << c.name;
    const Vec2 q = pointOf(result, "q");
    EXPECT_LT(distanceToCurve(curveOf(*result.entities, c.id), q), 1e-6) << c.name;
    const auto& before = data.findPoint(sketch::SketchEntityId("q"));
    EXPECT_FALSE(std::abs(q[0] - before->x) < 1e-9 && std::abs(q[1] - before->y) < 1e-9);
  }
}

TEST(PlanegcsSolverPointOnSpline, StaysOnTheCurveWhenAPointOfTheSplineIsDragged) {
  for (const auto& c : splineCases()) {
    std::vector<std::string> fixed = c.points;
    const std::string second = fixed[1];
    fixed.erase(fixed.begin() + 1);
    const SolveResult result =
        solve(onSpline(c.spline, c.id, fixes(fixed)), dragOf(second, {1.5, 3}));
    ASSERT_EQ(result.status, SolveStatus::Ok) << c.name;
    EXPECT_EQ(result.dof, 3) << c.name;
    expectPoint(pointOf(result, second), 1.5, 3);
    EXPECT_LT(distanceToCurve(curveOf(*result.entities, c.id), pointOf(result, "q")), 1e-6)
        << c.name;
  }
}

TEST(PlanegcsSolverPointOnSpline, DraggedPastAnEndItStopsAtTheEndOfTheCurve) {
  for (const auto& c : splineCases()) {
    const Sketch data = onSpline(c.spline, c.id, fixes(c.points));
    const auto curve = curveOf(data.entities(), c.id);
    for (const auto& [to, t] : {std::pair<Vec2, double>{{10, 10}, 1}, {{-3, -2}, 0}}) {
      const SolveResult result = solve(data, dragOf("q", to));
      ASSERT_EQ(result.status, SolveStatus::Ok) << c.name;
      EXPECT_EQ(result.dof, 1) << c.name;
      const Vec2 end = bspline::evaluate(curve, t);
      expectPoint(pointOf(result, "q"), end[0], end[1]);
    }
  }
}

TEST(PlanegcsSolverPointOnSpline, ASecondSolveThatSticksThePointToAnEndCanEndInAConflict) {
  // A fixed line x = 4.5 misses the fixed spline (it ends at [4, 2]) but crosses its polynomial
  // extension: the first solve puts q there with t > 1, the second one fixes t = 1 and q at
  // [4, 2] cannot lie on the line.
  const Json spline = appended(controlSpline(), J(R"([
    {"kind": "point", "id": "l1", "x": 4.5, "y": -5},
    {"kind": "point", "id": "l2", "x": 4.5, "y": 10},
    {"kind": "line", "id": "L", "p1": "l1", "p2": "l2"}])"));
  const Sketch data = onSpline(spline, "S",
                               appended(fixes({"p0", "p1", "p2", "p3", "l1", "l2"}),
                                        J(R"([{"kind": "pointOnCurve", "id": "onL", "point": "q",
                                               "curve": "L"}])")));
  Json entities = data.entitiesJson();
  for (auto& e : entities) {
    if (e.at("id") == "q") {
      e["x"] = 4.4;
      e["y"] = 2.8;
    }
  }
  const SolveResult result = solve(sketchOf(entities, data.constraintsJson()));
  EXPECT_EQ(result.status, SolveStatus::Conflict);
  EXPECT_FALSE(result.entities.has_value());
  EXPECT_EQ(result.dof, 0);
  EXPECT_FALSE(result.conflicting.empty());
  std::set<std::string> constraintIds;
  for (const auto& c : data.constraints()) constraintIds.insert(c->id().str());
  for (const auto& id : strings(result.conflicting)) EXPECT_TRUE(constraintIds.contains(id)) << id;
  for (const auto& id : strings(result.redundant)) EXPECT_TRUE(constraintIds.contains(id)) << id;
}

// --- mirror and patterns (M36), xline (M31)

TEST(PlanegcsSolverPatterns, ReturnsThePatternEntitiesUnchangedInTheirPlace) {
  const Sketch data = sketchOf(J(R"([
    {"kind": "point", "id": "o", "x": 0, "y": 0},
    {"kind": "point", "id": "u", "x": 0, "y": 5},
    {"kind": "line", "id": "L", "p1": "o", "p2": "u"},
    {"kind": "point", "id": "a", "x": 2, "y": 1},
    {"kind": "point", "id": "b", "x": 4, "y": 3},
    {"kind": "point", "id": "c", "x": 20, "y": 0},
    {"kind": "line", "id": "ab", "p1": "a", "p2": "b"},
    {"kind": "mirror", "id": "m", "sources": ["ab"], "axis": "L"},
    {"kind": "linearPattern", "id": "lp", "sources": ["a", "ab"],
     "direction1": {"angle": 0, "count": 3, "spacing": 5},
     "direction2": {"angle": 1.5707963267948966, "count": 2, "spacing": 4}},
    {"kind": "circularPattern", "id": "cp", "sources": ["ab"], "center": "c", "count": 4,
     "angle": 3.141592653589793}
  ])"),
                               J(R"([{"kind": "symmetric", "id": "s", "a": "a", "b": "b",
                                      "axis": "L"}])"));
  const SolveResult result = solve(data);
  ASSERT_EQ(result.status, SolveStatus::Ok);
  for (std::size_t i = 7; i < 10; ++i) EXPECT_EQ((*result.entities)[i], data.entities()[i]);
}

TEST(PlanegcsSolverXLine, APointOnAnXlineStaysOnItOutsideTheSegment) {
  const Sketch data = sketchOf(J(R"([
    {"kind": "point", "id": "p", "x": 0, "y": 0},
    {"kind": "point", "id": "q", "x": 10, "y": 0},
    {"kind": "xline", "id": "X", "p1": "p", "p2": "q", "construction": true},
    {"kind": "point", "id": "m", "x": 4, "y": 0}
  ])"),
                               J(R"([{"kind": "fix", "id": "fp", "point": "p"},
                                     {"kind": "fix", "id": "fq", "point": "q"},
                                     {"kind": "pointOnCurve", "id": "on", "point": "m",
                                      "curve": "X"}])"));
  const SolveResult result = solve(data, dragOf("m", {50, 3}));
  ASSERT_EQ(result.status, SolveStatus::Ok);
  expectPoint(pointOf(result, "m"), 50, 0);
  EXPECT_EQ(sketch::entityJson(*(*result.entities)[2]),
            J(R"({"kind": "xline", "id": "X", "p1": "p", "p2": "q", "construction": true})"));
}

// --- offset (port of solve-offset.test.ts, the cases not recorded as shared cases)

TEST(PlanegcsSolverOffset, AnOffsetFullyDefinesTheCopyOfAFullyDefinedRectangle) {
  const Sketch data = sketchOf(J(R"([
    {"kind": "point", "id": "a", "x": 0, "y": 0}, {"kind": "point", "id": "b", "x": 10, "y": 0},
    {"kind": "point", "id": "c", "x": 10, "y": 5}, {"kind": "point", "id": "d", "x": 0, "y": 5},
    {"kind": "line", "id": "ab", "p1": "a", "p2": "b"},
    {"kind": "line", "id": "bc", "p1": "b", "p2": "c"},
    {"kind": "line", "id": "cd", "p1": "c", "p2": "d"},
    {"kind": "line", "id": "da", "p1": "d", "p2": "a"},
    {"kind": "point", "id": "A", "x": -1, "y": -1}, {"kind": "point", "id": "B", "x": 11, "y": -1},
    {"kind": "point", "id": "C", "x": 11, "y": 6}, {"kind": "point", "id": "D", "x": -1, "y": 6},
    {"kind": "line", "id": "AB", "p1": "A", "p2": "B"},
    {"kind": "line", "id": "BC", "p1": "B", "p2": "C"},
    {"kind": "line", "id": "CD", "p1": "C", "p2": "D"},
    {"kind": "line", "id": "DA", "p1": "D", "p2": "A"}
  ])"),
                               J(R"([
    {"kind": "horizontal", "id": "h1", "line": "ab"}, {"kind": "vertical", "id": "v1", "line": "bc"},
    {"kind": "horizontal", "id": "h2", "line": "cd"}, {"kind": "vertical", "id": "v2", "line": "da"},
    {"kind": "distance", "id": "W", "a": "a", "b": "b", "value": 10},
    {"kind": "distance", "id": "H", "a": "b", "b": "c", "value": 5},
    {"kind": "fix", "id": "fa", "point": "a"},
    {"kind": "offset", "id": "off", "value": 1, "pairs": [{"source": "ab", "copy": "AB"},
      {"source": "bc", "copy": "BC"}, {"source": "cd", "copy": "CD"},
      {"source": "da", "copy": "DA"}]}
  ])"));
  const SolveResult result = solve(data);
  EXPECT_EQ(result.status, SolveStatus::Ok);
  EXPECT_EQ(result.dof, 0);
  EXPECT_TRUE(result.conflicting.empty());
  EXPECT_TRUE(result.redundant.empty());
}

TEST(PlanegcsSolverOffset, TheEditOfTheOffsetToolKeepsTheDegreesOfFreedomOfTheOriginal) {
  // offsetEdit of the TS sketcher on rectangleData (chain of ab, distance 1), recorded.
  const Sketch edit = sketchOf(
      appended(RECTANGLE_ENTITIES, J(R"([
        {"kind": "point", "id": "n1", "x": -1, "y": -1},
        {"kind": "point", "id": "n2", "x": 11, "y": -1},
        {"kind": "point", "id": "n3", "x": 11, "y": 6},
        {"kind": "point", "id": "n4", "x": -1, "y": 6},
        {"kind": "line", "id": "n5", "p1": "n1", "p2": "n2"},
        {"kind": "line", "id": "n6", "p1": "n2", "p2": "n3"},
        {"kind": "line", "id": "n7", "p1": "n3", "p2": "n4"},
        {"kind": "line", "id": "n8", "p1": "n4", "p2": "n1"}])")),
      appended(RECTANGLE_CONSTRAINTS, J(R"([{"kind": "offset", "id": "k1", "value": 1,
        "pairs": [{"source": "ab", "copy": "n5"}, {"source": "bc", "copy": "n6"},
                  {"source": "cd", "copy": "n7"}, {"source": "da", "copy": "n8"}]}])")));
  const SolveResult before = solve(rectangle());
  const SolveResult after = solve(edit);
  ASSERT_EQ(after.status, SolveStatus::Ok);
  EXPECT_TRUE(after.conflicting.empty());
  EXPECT_TRUE(after.redundant.empty());
  EXPECT_EQ(after.dof, before.dof);
  // Nothing moves: the copy is where the kernel put it.
  expectPoint(pointOf(after, "n1"), -1, -1);
  expectPoint(pointOf(after, "n2"), 11, -1);
  expectPoint(pointOf(after, "n3"), 11, 6);
  expectPoint(pointOf(after, "n4"), -1, 6);
}

}  // namespace
}  // namespace tinycad::solver_planegcs
