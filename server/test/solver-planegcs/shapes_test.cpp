// Port of test/unit/solver-planegcs/shapes.test.ts: the rectangles and slots of M31 (spec 12
// "Nové kreslicí nástroje (M31)") against the native planegcs. The shapes are the output of the
// TS shape functions (rectangleCenterShape, slotShape, … with the positions of the TS test),
// recorded as JSON: the construction helpers stay in the client. Each shape has the degrees of
// freedom of the table "Vazby tvarů" without redundant constraints and stays the shape after one
// dimension changes.

#include <gtest/gtest.h>

#include <cmath>
#include <map>
#include <string>
#include <tuple>
#include <utility>

#include "testing.hpp"

namespace tinycad::solver_planegcs {
namespace {

using namespace testing;

constexpr double EPS = 1e-6;

Sketch shape(const char* json, const Json& extra = Json::array()) {
  const Json s = J(json);
  return sketchOf(s.at("entities"), appended(s.at("constraints"), extra));
}

/** The solved points by id; expects an ok solve without conflicts or redundancies. */
std::map<std::string, Vec2> solvedPoints(const SolveResult& result) {
  EXPECT_EQ(result.status, SolveStatus::Ok);
  EXPECT_TRUE(result.conflicting.empty());
  EXPECT_TRUE(result.redundant.empty());
  std::map<std::string, Vec2> out;
  for (const auto& e : result.entities.value_or(std::vector<sketch::EntityPtr>{})) {
    if (e->kind() == sketch::EntityKind::Point) {
      out[e->id().str()] = {e->as<sketch::SketchPoint>().x, e->as<sketch::SketchPoint>().y};
    }
  }
  return out;
}

Vec2 sub(const Vec2& a, const Vec2& b) { return {a[0] - b[0], a[1] - b[1]}; }
double dot(const Vec2& a, const Vec2& b) { return a[0] * b[0] + a[1] * b[1]; }
double cross(const Vec2& a, const Vec2& b) { return a[0] * b[1] - a[1] * b[0]; }
double dist(const Vec2& a, const Vec2& b) { return std::hypot(a[0] - b[0], a[1] - b[1]); }
Vec2 unit(const Vec2& a) {
  const double l = std::hypot(a[0], a[1]);
  return {a[0] / l, a[1] / l};
}

const char* RECTANGLE_CENTER = R"({"entities": [
  {"kind": "point", "id": "a", "x": -2, "y": 0},
  {"kind": "point", "id": "b", "x": 4, "y": 0},
  {"kind": "point", "id": "c", "x": 4, "y": 4},
  {"kind": "point", "id": "d", "x": -2, "y": 4},
  {"kind": "point", "id": "m", "x": 1, "y": 2},
  {"kind": "line", "id": "e1", "p1": "a", "p2": "b"},
  {"kind": "line", "id": "e2", "p1": "b", "p2": "c"},
  {"kind": "line", "id": "e3", "p1": "c", "p2": "d"},
  {"kind": "line", "id": "e4", "p1": "d", "p2": "a"},
  {"kind": "line", "id": "e5", "p1": "a", "p2": "c", "construction": true}
], "constraints": [
  {"kind": "horizontal", "id": "k1", "line": "e1"},
  {"kind": "horizontal", "id": "k2", "line": "e3"},
  {"kind": "vertical", "id": "k3", "line": "e2"},
  {"kind": "vertical", "id": "k4", "line": "e4"},
  {"kind": "midpoint", "id": "k5", "point": "m", "line": "e5"}
]})";

TEST(ShapesRectangleByCentre, Has4DegreesOfFreedom) {
  const SolveResult result = solve(shape(RECTANGLE_CENTER));
  EXPECT_EQ(result.status, SolveStatus::Ok);
  EXPECT_EQ(result.dof, 4);
  EXPECT_TRUE(result.redundant.empty());
}

TEST(ShapesRectangleByCentre, StaysAnAxisParallelRectangleAroundItsCentreAfterAWidthDimension) {
  const SolveResult result = solve(shape(
      RECTANGLE_CENTER, J(R"([{"kind": "hDistance", "id": "w", "a": "a", "b": "b", "value": 10}])")));
  EXPECT_EQ(result.dof, 3);
  auto p = solvedPoints(result);
  EXPECT_NEAR(std::abs(p["b"][0] - p["a"][0]), 10, EPS);
  EXPECT_NEAR(p["b"][1], p["a"][1], EPS);
  EXPECT_NEAR(p["c"][0], p["b"][0], EPS);
  EXPECT_NEAR(p["d"][1], p["c"][1], EPS);
  EXPECT_NEAR(p["a"][0], p["d"][0], EPS);
  EXPECT_NEAR(p["m"][0], (p["a"][0] + p["c"][0]) / 2, EPS);
  EXPECT_NEAR(p["m"][1], (p["a"][1] + p["c"][1]) / 2, EPS);
}

const char* RECTANGLE_3 = R"({"entities": [
  {"kind": "point", "id": "a", "x": 1, "y": 1},
  {"kind": "point", "id": "b", "x": 4, "y": 5},
  {"kind": "point", "id": "c", "x": 2.4, "y": 6.2},
  {"kind": "point", "id": "d", "x": -0.6000000000000001, "y": 2.2},
  {"kind": "line", "id": "e1", "p1": "a", "p2": "b"},
  {"kind": "line", "id": "e2", "p1": "b", "p2": "c"},
  {"kind": "line", "id": "e3", "p1": "c", "p2": "d"},
  {"kind": "line", "id": "e4", "p1": "d", "p2": "a"}
], "constraints": [
  {"kind": "perpendicular", "id": "k1", "a": "e1", "b": "e2"},
  {"kind": "parallel", "id": "k2", "a": "e3", "b": "e1"},
  {"kind": "parallel", "id": "k3", "a": "e4", "b": "e2"}
]})";

TEST(ShapesRectangleBy3Points, Has5DegreesOfFreedom) {
  const SolveResult result = solve(shape(RECTANGLE_3));
  EXPECT_EQ(result.status, SolveStatus::Ok);
  EXPECT_EQ(result.dof, 5);
  EXPECT_TRUE(result.redundant.empty());
}

TEST(ShapesRectangleBy3Points, KeepsItsRightAnglesAfterALengthDimension) {
  const SolveResult result = solve(shape(
      RECTANGLE_3, J(R"([{"kind": "distance", "id": "w", "a": "a", "b": "b", "value": 8}])")));
  EXPECT_EQ(result.dof, 4);
  auto p = solvedPoints(result);
  const Vec2 ab = unit(sub(p["b"], p["a"]));
  const Vec2 bc = unit(sub(p["c"], p["b"]));
  const Vec2 cd = unit(sub(p["d"], p["c"]));
  const Vec2 da = unit(sub(p["a"], p["d"]));
  EXPECT_NEAR(dist(p["a"], p["b"]), 8, EPS);
  EXPECT_NEAR(dot(ab, bc), 0, EPS);
  EXPECT_NEAR(dot(bc, cd), 0, EPS);
  EXPECT_NEAR(dot(cd, da), 0, EPS);
  EXPECT_NEAR(dot(da, ab), 0, EPS);
}

/** The straight slot invariants: equal radii r, tangent sides (radius ⟂ side in each point). */
void expectStraightSlot(std::map<std::string, Vec2>& p, double r) {
  for (const auto& [c, q] : {std::pair{"c1", "l1"}, {"c1", "r1"}, {"c2", "l2"}, {"c2", "r2"}}) {
    EXPECT_NEAR(dist(p[c], p[q]), r, EPS) << c << q;
  }
  const Vec2 left = sub(p["l2"], p["l1"]);
  const Vec2 right = sub(p["r1"], p["r2"]);
  EXPECT_NEAR(dot(sub(p["l1"], p["c1"]), left), 0, EPS);
  EXPECT_NEAR(dot(sub(p["l2"], p["c2"]), left), 0, EPS);
  EXPECT_NEAR(dot(sub(p["r2"], p["c2"]), right), 0, EPS);
  EXPECT_NEAR(dot(sub(p["r1"], p["c1"]), right), 0, EPS);
}

const char* SLOT = R"({"entities": [
  {"kind": "point", "id": "c1", "x": 1, "y": 1},
  {"kind": "point", "id": "c2", "x": 9, "y": 4},
  {"kind": "point", "id": "l1", "x": -0.27397260273972623, "y": 4.397260273972603},
  {"kind": "point", "id": "l2", "x": 7.726027397260274, "y": 7.397260273972603},
  {"kind": "point", "id": "r2", "x": 10.273972602739725, "y": 0.602739726027397},
  {"kind": "point", "id": "r1", "x": 2.2739726027397262, "y": -2.397260273972603},
  {"kind": "line", "id": "e1", "p1": "l1", "p2": "l2"},
  {"kind": "line", "id": "e2", "p1": "r2", "p2": "r1"},
  {"kind": "arc", "id": "e3", "center": "c2", "start": "r2", "end": "l2"},
  {"kind": "arc", "id": "e4", "center": "c1", "start": "l1", "end": "r1"},
  {"kind": "line", "id": "e5", "p1": "c1", "p2": "c2", "construction": true}
], "constraints": [
  {"kind": "tangent", "id": "k1", "a": "e1", "b": "e4"},
  {"kind": "tangent", "id": "k2", "a": "e1", "b": "e3"},
  {"kind": "tangent", "id": "k3", "a": "e2", "b": "e3"},
  {"kind": "tangent", "id": "k4", "a": "e2", "b": "e4"},
  {"kind": "equal", "id": "k5", "a": "e3", "b": "e4"}
]})";

TEST(ShapesSlotCentreToCentre, Has5DegreesOfFreedom) {
  const SolveResult result = solve(shape(SLOT));
  EXPECT_EQ(result.status, SolveStatus::Ok);
  EXPECT_EQ(result.dof, 5);
  EXPECT_TRUE(result.redundant.empty());
}

TEST(ShapesSlotCentreToCentre, StaysASlotAfterARadiusDimension) {
  const SolveResult result = solve(
      shape(SLOT, J(R"([{"kind": "radius", "id": "r", "curve": "e4", "value": 1.5}])")));
  EXPECT_EQ(result.dof, 4);
  auto p = solvedPoints(result);
  expectStraightSlot(p, 1.5);
}

const char* SLOT_OVERALL = R"({"entities": [
  {"kind": "point", "id": "p1", "x": 0, "y": 0},
  {"kind": "point", "id": "p2", "x": 12, "y": 5},
  {"kind": "point", "id": "c1", "x": 1.4911242603550294, "y": 0.621301775147929},
  {"kind": "point", "id": "c2", "x": 10.50887573964497, "y": 4.378698224852071},
  {"kind": "point", "id": "l1", "x": 0.8698224852071005, "y": 2.1124260355029585},
  {"kind": "point", "id": "l2", "x": 9.887573964497042, "y": 5.8698224852071},
  {"kind": "point", "id": "r2", "x": 11.1301775147929, "y": 2.887573964497042},
  {"kind": "point", "id": "r1", "x": 2.1124260355029585, "y": -0.8698224852071005},
  {"kind": "line", "id": "e1", "p1": "l1", "p2": "l2"},
  {"kind": "line", "id": "e2", "p1": "r2", "p2": "r1"},
  {"kind": "arc", "id": "e3", "center": "c2", "start": "r2", "end": "l2"},
  {"kind": "arc", "id": "e4", "center": "c1", "start": "l1", "end": "r1"},
  {"kind": "line", "id": "e5", "p1": "p1", "p2": "p2", "construction": true}
], "constraints": [
  {"kind": "tangent", "id": "k1", "a": "e1", "b": "e4"},
  {"kind": "tangent", "id": "k2", "a": "e1", "b": "e3"},
  {"kind": "tangent", "id": "k3", "a": "e2", "b": "e3"},
  {"kind": "tangent", "id": "k4", "a": "e2", "b": "e4"},
  {"kind": "equal", "id": "k5", "a": "e3", "b": "e4"},
  {"kind": "pointOnCurve", "id": "k6", "point": "p1", "curve": "e4"},
  {"kind": "pointOnCurve", "id": "k7", "point": "p2", "curve": "e3"},
  {"kind": "pointOnCurve", "id": "k8", "point": "c1", "curve": "e5"},
  {"kind": "pointOnCurve", "id": "k9", "point": "c2", "curve": "e5"}
]})";

TEST(ShapesSlotByOverallLength, Has5DegreesOfFreedom) {
  const SolveResult result = solve(shape(SLOT_OVERALL));
  EXPECT_EQ(result.status, SolveStatus::Ok);
  EXPECT_EQ(result.dof, 5);
  EXPECT_TRUE(result.redundant.empty());
}

TEST(ShapesSlotByOverallLength, StaysASlotWithItsEndsOnTheAxisAfterALengthDimension) {
  const SolveResult result = solve(shape(
      SLOT_OVERALL, J(R"([{"kind": "distance", "id": "L", "a": "p1", "b": "p2", "value": 20}])")));
  EXPECT_EQ(result.dof, 4);
  auto p = solvedPoints(result);
  const double r = dist(p["c1"], p["l1"]);
  expectStraightSlot(p, r);
  EXPECT_NEAR(dist(p["p1"], p["p2"]), 20, EPS);
  const Vec2 axis = sub(p["p2"], p["p1"]);
  EXPECT_NEAR(cross(axis, sub(p["c1"], p["p1"])), 0, EPS);
  EXPECT_NEAR(cross(axis, sub(p["c2"], p["p1"])), 0, EPS);
  EXPECT_NEAR(dist(p["p1"], p["c1"]), r, EPS);
  EXPECT_NEAR(dist(p["p2"], p["c2"]), r, EPS);
}

const char* ARC_SLOT = R"({"entities": [
  {"kind": "point", "id": "o", "x": 1, "y": 2},
  {"kind": "point", "id": "s", "x": 11, "y": 2},
  {"kind": "point", "id": "e", "x": 1, "y": 12},
  {"kind": "point", "id": "is", "x": 10, "y": 2},
  {"kind": "point", "id": "ie", "x": 1, "y": 11},
  {"kind": "point", "id": "os", "x": 12, "y": 2},
  {"kind": "point", "id": "oe", "x": 1, "y": 13},
  {"kind": "arc", "id": "e1", "center": "o", "start": "is", "end": "ie"},
  {"kind": "arc", "id": "e2", "center": "o", "start": "os", "end": "oe"},
  {"kind": "arc", "id": "e3", "center": "s", "start": "is", "end": "os"},
  {"kind": "arc", "id": "e4", "center": "e", "start": "oe", "end": "ie"}
], "constraints": [
  {"kind": "tangent", "id": "k1", "a": "e3", "b": "e1"},
  {"kind": "tangent", "id": "k2", "a": "e3", "b": "e2"},
  {"kind": "tangent", "id": "k3", "a": "e4", "b": "e2"},
  {"kind": "tangent", "id": "k4", "a": "e4", "b": "e1"}
]})";

TEST(ShapesArcSlot, Has6DegreesOfFreedom) {
  const SolveResult result = solve(shape(ARC_SLOT));
  EXPECT_EQ(result.status, SolveStatus::Ok);
  EXPECT_EQ(result.dof, 6);
  EXPECT_TRUE(result.redundant.empty());
}

TEST(ShapesArcSlot, StaysAnArcSlotOfTheNewWidthAfterAnEndArcRadiusDimension) {
  const SolveResult result =
      solve(shape(ARC_SLOT, J(R"([{"kind": "radius", "id": "w", "curve": "e3", "value": 2}])")));
  EXPECT_EQ(result.dof, 5);
  auto p = solvedPoints(result);
  const double inner = dist(p["o"], p["is"]);
  const double outer = dist(p["o"], p["os"]);
  EXPECT_NEAR(dist(p["o"], p["ie"]), inner, EPS);
  EXPECT_NEAR(dist(p["o"], p["oe"]), outer, EPS);
  EXPECT_NEAR(outer - inner, 4, EPS);
  // Both end arcs have the half width as radius and are tangent: their centres lie on the ray
  // from the centre through their shared points, in the middle of the axis circle.
  for (const auto& [c, a, b] : {std::tuple{"s", "is", "os"}, {"e", "ie", "oe"}}) {
    EXPECT_NEAR(dist(p[c], p[a]), 2, EPS);
    EXPECT_NEAR(dist(p[c], p[b]), 2, EPS);
    EXPECT_NEAR(cross(sub(p[a], p["o"]), sub(p[c], p["o"])), 0, EPS);
    EXPECT_NEAR(dist(p["o"], p[c]), (inner + outer) / 2, EPS);
  }
}

}  // namespace
}  // namespace tinycad::solver_planegcs
