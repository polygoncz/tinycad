// Port of test/unit/sketch/parse.test.ts: the data check of Sketch::parse (spec 12 "Kontrola
// dat"). Every case keeps the name of its TS twin; values JSON cannot hold (NaN, ±∞) are set in
// code.

#include <gtest/gtest.h>

#include <limits>
#include <numbers>
#include <string>
#include <utility>
#include <vector>

#include "testing.hpp"

namespace tinycad::sketch {
namespace {

using namespace testing;
using Issues = std::vector<SketchIssue>;
using Cases = std::vector<std::pair<std::string, Json>>;

constexpr double PI = std::numbers::pi;
const double NaN = std::numeric_limits<double>::quiet_NaN();
const double INF = std::numeric_limits<double>::infinity();

/** Points a, b, c, d of a 10 × 10 square, its lines ab and bc, a circle and an arc (all valid). */
const Json ENTITIES = J(R"([
  {"kind": "point", "id": "a", "x": 0, "y": 0},
  {"kind": "point", "id": "b", "x": 10, "y": 0},
  {"kind": "point", "id": "c", "x": 10, "y": 10},
  {"kind": "point", "id": "d", "x": 0, "y": 10},
  {"kind": "line", "id": "ab", "p1": "a", "p2": "b"},
  {"kind": "line", "id": "bc", "p1": "b", "p2": "c", "construction": true},
  {"kind": "circle", "id": "k", "center": "a", "radius": 2},
  {"kind": "arc", "id": "q", "center": "a", "start": "b", "end": "d"}
])");
const int N = static_cast<int>(ENTITIES.size());

Issues entityIssues(const Json& entities) { return issuesOf(entities, Json::array()); }
Issues constraintIssues(const Json& constraints) { return issuesOf(ENTITIES, constraints); }

const Json FIX = J(R"({"kind": "fix", "id": "f", "point": "a"})");

/** Each bad constraint after a valid fix is reported at index 1, and only it. */
void expectBadConstraints(const Json& entities, const Cases& cases,
                          const Json& first = J(R"({"kind": "fix", "id": "f", "point": "a"})")) {
  for (const auto& [name, bad] : cases) {
    EXPECT_EQ(issuesOf(entities, Json::array({first, bad})), Issues{constraintIssue(1)})
        << name << ": " << bad.dump();
  }
}

/** Each bad entity appended to `entities` is reported at its index, and only it. */
void expectBadEntities(const Json& entities, const Cases& cases) {
  const int index = static_cast<int>(entities.size());
  for (const auto& [name, bad] : cases) {
    Json all = entities;
    all.push_back(bad);
    EXPECT_EQ(entityIssues(all), Issues{entityIssue(index)}) << name << ": " << bad.dump();
  }
}

// --- valid data

TEST(ParseValidData, ReturnsTheSameValuesTyped) {
  const Json constraints = J(R"([{"kind": "horizontal", "id": "h", "line": "ab"}])");
  const auto parsed = Sketch::parse(ENTITIES, constraints);
  ASSERT_TRUE(parsed.has_value());
  EXPECT_EQ(parsed->entitiesJson(), ENTITIES);
  EXPECT_EQ(parsed->constraintsJson(), constraints);
  ASSERT_EQ(parsed->entities().size(), ENTITIES.size());
  const auto& arc = parsed->entities()[7]->as<SketchArc>();
  EXPECT_EQ(parsed->entities()[7]->kind(), EntityKind::Arc);
  EXPECT_EQ(arc.start.str(), "b");
  EXPECT_TRUE(parsed->entities()[5]->as<SketchLine>().construction);
  EXPECT_EQ(parsed->constraints()[0]->as<LineConstraint>().line.str(), "ab");
}

TEST(ParseValidData, AcceptsEmptyArrays) {
  EXPECT_TRUE(Sketch::parse(Json::array(), Json::array()).has_value());
}

TEST(ParseValidData, AcceptsAReferenceToAPointDefinedLaterInTheArray) {
  EXPECT_EQ(entityIssues(J(R"([{"kind": "line", "id": "l", "p1": "a", "p2": "b"},
    {"kind": "point", "id": "a", "x": 0, "y": 0}, {"kind": "point", "id": "b", "x": 1, "y": 0}])")),
            Issues{});
}

TEST(ParseValidData, AcceptsEveryConstraintKindWithValidTargets) {
  EXPECT_EQ(constraintIssues(J(R"([
    {"kind": "coincident", "id": "c1", "a": "a", "b": "b"},
    {"kind": "horizontal", "id": "c2", "line": "ab"},
    {"kind": "vertical", "id": "c3", "line": "bc"},
    {"kind": "parallel", "id": "c4", "a": "ab", "b": "bc"},
    {"kind": "perpendicular", "id": "c5", "a": "ab", "b": "bc"},
    {"kind": "equal", "id": "c6", "a": "ab", "b": "bc"},
    {"kind": "equal", "id": "c7", "a": "k", "b": "q"},
    {"kind": "tangent", "id": "c8", "a": "ab", "b": "k"},
    {"kind": "tangent", "id": "c9", "a": "q", "b": "ab"},
    {"kind": "tangent", "id": "c10", "a": "k", "b": "q"},
    {"kind": "fix", "id": "c11", "point": "a"},
    {"kind": "distance", "id": "c12", "a": "a", "b": "c", "value": 5},
    {"kind": "radius", "id": "c13", "curve": "k", "value": 3},
    {"kind": "radius", "id": "c14", "curve": "q", "value": 3},
    {"kind": "pointOnCurve", "id": "c15", "point": "c", "curve": "ab"},
    {"kind": "pointOnCurve", "id": "c16", "point": "d", "curve": "k"},
    {"kind": "pointOnCurve", "id": "c17", "point": "c", "curve": "q"},
    {"kind": "midpoint", "id": "c18", "point": "c", "line": "ab"},
    {"kind": "hAlign", "id": "c19", "a": "c", "b": "d"},
    {"kind": "vAlign", "id": "c20", "a": "d", "b": "a"}
  ])")),
            Issues{});
}

TEST(ParseValidData, AcceptsEveryDimensionKindWithoutPlacement) {
  Json constraints = J(R"([
    {"kind": "hDistance", "id": "d1", "a": "a", "b": "c", "value": 10},
    {"kind": "vDistance", "id": "d2", "a": "a", "b": "c", "value": 10},
    {"kind": "pointLineDistance", "id": "d3", "point": "c", "line": "ab", "value": 10},
    {"kind": "angle", "id": "d4", "a": "ab", "b": "bc", "value": 1.5707963267948966},
    {"kind": "angle", "id": "d5", "a": "ab", "b": "bc", "value": 1, "reverseA": true,
     "reverseB": true},
    {"kind": "diameter", "id": "d6", "curve": "k", "value": 4},
    {"kind": "diameter", "id": "d7", "curve": "q", "value": 20}
  ])");
  EXPECT_EQ(constraintIssues(constraints), Issues{});
}

TEST(ParseValidData, AcceptsAPlacementOfTheMatchingKindOnEveryDimension) {
  EXPECT_EQ(constraintIssues(J(R"([
    {"kind": "distance", "id": "d1", "a": "a", "b": "c", "value": 5,
     "placement": {"kind": "linear", "offset": -3, "along": 2.5}},
    {"kind": "hDistance", "id": "d2", "a": "a", "b": "c", "value": 10,
     "placement": {"kind": "linear", "offset": -3, "along": 2.5}},
    {"kind": "vDistance", "id": "d3", "a": "a", "b": "c", "value": 10,
     "placement": {"kind": "linear", "offset": -3, "along": 2.5}},
    {"kind": "pointLineDistance", "id": "d4", "point": "c", "line": "ab", "value": 10,
     "placement": {"kind": "linear", "offset": -3, "along": 2.5}},
    {"kind": "angle", "id": "d5", "a": "ab", "b": "bc", "value": 1,
     "placement": {"kind": "angular", "radius": 4, "t": 0}},
    {"kind": "angle", "id": "d6", "a": "ab", "b": "bc", "value": 1,
     "placement": {"kind": "angular", "radius": 4, "t": 1}},
    {"kind": "radius", "id": "d7", "curve": "k", "value": 2,
     "placement": {"kind": "radial", "angle": -1, "distance": 7}},
    {"kind": "diameter", "id": "d8", "curve": "q", "value": 20,
     "placement": {"kind": "radial", "angle": -1, "distance": 7}}
  ])")),
            Issues{});
}

// --- entities

TEST(ParseEntities, ReportsANonArrayWithIndexMinusOne) {
  EXPECT_EQ(entityIssues(Json::object()), Issues{entityIssue(-1)});
  EXPECT_EQ(issuesOf(Json::array(), "nope"), Issues{constraintIssue(-1)});
  EXPECT_EQ(issuesOf(Json(), Json()), (Issues{entityIssue(-1), constraintIssue(-1)}));
}

TEST(ParseEntities, ReportsABadEntityAtItsIndex) {
  // z1 and z2 sit on a: an arc around a through them has radius 0.
  const Json base = appended(ENTITIES, Json::array({P("z1"), P("z2")}));
  expectBadEntities(base, {
      {"not an object", 42},
      {"null", nullptr},
      {"an array", Json::array()},
      {"unknown kind", J(R"({"kind": "spline", "id": "x"})")},
      {"missing property", J(R"({"kind": "point", "id": "x", "x": 0})")},
      {"extra property", J(R"({"kind": "point", "id": "x", "x": 0, "y": 0, "z": 0})")},
      {"empty id", P("")},
      {"id not a string", J(R"({"kind": "point", "id": 7, "x": 0, "y": 0})")},
      {"non-finite coordinate", with(P("x"), {{"x", NaN}})},
      {"infinite coordinate", with(P("x"), {{"y", INF}})},
      {"coordinate not a number", J(R"({"kind": "point", "id": "x", "x": "1", "y": 0})")},
      {"zero radius", J(R"({"kind": "circle", "id": "x", "center": "a", "radius": 0})")},
      {"negative radius", J(R"({"kind": "circle", "id": "x", "center": "a", "radius": -1})")},
      {"non-finite radius",
       with(J(R"({"kind": "circle", "id": "x", "center": "a"})"), {{"radius", INF}})},
      {"construction false",
       J(R"({"kind": "line", "id": "x", "p1": "a", "p2": "b", "construction": false})")},
      {"construction null",
       J(R"({"kind": "line", "id": "x", "p1": "a", "p2": "b", "construction": null})")},
      {"reference to a missing point", J(R"({"kind": "line", "id": "x", "p1": "a", "p2": "zz"})")},
      {"reference to a line", J(R"({"kind": "line", "id": "x", "p1": "a", "p2": "ab"})")},
      {"p1 equal to p2", J(R"({"kind": "line", "id": "x", "p1": "a", "p2": "a"})")},
      {"arc with repeated point",
       J(R"({"kind": "arc", "id": "x", "center": "a", "start": "b", "end": "b"})")},
      {"arc with center = start",
       J(R"({"kind": "arc", "id": "x", "center": "a", "start": "a", "end": "b"})")},
      {"arc with unequal radii",
       J(R"({"kind": "arc", "id": "x", "center": "a", "start": "b", "end": "c"})")},
      {"arc with zero radius",
       J(R"({"kind": "arc", "id": "x", "center": "a", "start": "z1", "end": "z2"})")},
  });
}

TEST(ParseEntities, AcceptsAnArcWhoseRadiiDifferWithinTheTolerance) {
  const Json arc = J(R"({"kind": "arc", "id": "x", "center": "o", "start": "s", "end": "e"})");
  EXPECT_EQ(entityIssues(Json::array({P("o"), P("s", 100, 0), P("e", 0, 100 + 5e-5), arc})),
            Issues{});
  EXPECT_EQ(entityIssues(Json::array({P("o"), P("s", 100, 0), P("e", 0, 100 + 2e-4), arc})),
            Issues{entityIssue(3)});
}

TEST(ParseEntities, ReportsADuplicateIdAtTheLaterOccurrence) {
  EXPECT_EQ(entityIssues(Json::array({P("a"), P("b", 1), P("a", 2)})), Issues{entityIssue(2)});
}

TEST(ParseEntities, ReportsAllProblemsNotJustTheFirst) {
  EXPECT_EQ(entityIssues(Json::array({P("a"), 1, with(P("b"), {{"x", NaN}}), P("c")})),
            (Issues{entityIssue(1), entityIssue(2)}));
}

// --- constraints

TEST(ParseConstraints, ReportsABadConstraintAtItsIndex) {
  expectBadConstraints(ENTITIES, {
      {"not an object", "x"},
      {"unknown kind", J(R"({"kind": "concentric", "id": "x", "a": "a", "b": "b"})")},
      {"missing property", J(R"({"kind": "horizontal", "id": "x"})")},
      {"extra property", J(R"({"kind": "fix", "id": "x", "point": "a", "value": 1})")},
      {"empty id", J(R"({"kind": "fix", "id": "", "point": "a"})")},
      {"id used by an entity", J(R"({"kind": "fix", "id": "ab", "point": "a"})")},
      {"coincident on a line", J(R"({"kind": "coincident", "id": "x", "a": "a", "b": "ab"})")},
      {"coincident a = b", J(R"({"kind": "coincident", "id": "x", "a": "a", "b": "a"})")},
      {"horizontal on a point", J(R"({"kind": "horizontal", "id": "x", "line": "a"})")},
      {"vertical on a circle", J(R"({"kind": "vertical", "id": "x", "line": "k"})")},
      {"parallel with an arc", J(R"({"kind": "parallel", "id": "x", "a": "ab", "b": "q"})")},
      {"perpendicular a = b", J(R"({"kind": "perpendicular", "id": "x", "a": "ab", "b": "ab"})")},
      {"equal line and circle", J(R"({"kind": "equal", "id": "x", "a": "ab", "b": "k"})")},
      {"tangent two lines", J(R"({"kind": "tangent", "id": "x", "a": "ab", "b": "bc"})")},
      {"tangent with a point", J(R"({"kind": "tangent", "id": "x", "a": "a", "b": "k"})")},
      {"fix on a line", J(R"({"kind": "fix", "id": "x", "point": "ab"})")},
      {"fix on a missing entity", J(R"({"kind": "fix", "id": "x", "point": "zz"})")},
      {"distance between lines",
       J(R"({"kind": "distance", "id": "x", "a": "ab", "b": "bc", "value": 1})")},
      {"distance zero", J(R"({"kind": "distance", "id": "x", "a": "a", "b": "b", "value": 0})")},
      {"distance NaN",
       with(J(R"({"kind": "distance", "id": "x", "a": "a", "b": "b"})"), {{"value", NaN}})},
      {"distance a = b", J(R"({"kind": "distance", "id": "x", "a": "a", "b": "a", "value": 1})")},
      {"radius on a line", J(R"({"kind": "radius", "id": "x", "curve": "ab", "value": 1})")},
      {"radius negative", J(R"({"kind": "radius", "id": "x", "curve": "k", "value": -1})")},
      {"pointOnCurve on a point",
       J(R"({"kind": "pointOnCurve", "id": "x", "point": "c", "curve": "d"})")},
      {"pointOnCurve of a line",
       J(R"({"kind": "pointOnCurve", "id": "x", "point": "bc", "curve": "ab"})")},
      {"pointOnCurve of an end",
       J(R"({"kind": "pointOnCurve", "id": "x", "point": "a", "curve": "ab"})")},
      {"pointOnCurve of a centre",
       J(R"({"kind": "pointOnCurve", "id": "x", "point": "a", "curve": "k"})")},
      {"pointOnCurve of an arc end",
       J(R"({"kind": "pointOnCurve", "id": "x", "point": "d", "curve": "q"})")},
      {"pointOnCurve missing curve",
       J(R"({"kind": "pointOnCurve", "id": "x", "point": "c", "curve": "zz"})")},
      {"midpoint on a circle", J(R"({"kind": "midpoint", "id": "x", "point": "c", "line": "k"})")},
      {"midpoint of an end", J(R"({"kind": "midpoint", "id": "x", "point": "b", "line": "ab"})")},
      {"midpoint of a line", J(R"({"kind": "midpoint", "id": "x", "point": "bc", "line": "ab"})")},
      {"hAlign a = b", J(R"({"kind": "hAlign", "id": "x", "a": "c", "b": "c"})")},
      {"hAlign with a line", J(R"({"kind": "hAlign", "id": "x", "a": "c", "b": "ab"})")},
      {"vAlign with a circle", J(R"({"kind": "vAlign", "id": "x", "a": "k", "b": "c"})")},
      {"vAlign extra property",
       J(R"({"kind": "vAlign", "id": "x", "a": "c", "b": "d", "line": "ab"})")},
      {"hDistance between lines",
       J(R"({"kind": "hDistance", "id": "x", "a": "ab", "b": "bc", "value": 1})")},
      {"vDistance zero", J(R"({"kind": "vDistance", "id": "x", "a": "a", "b": "b", "value": 0})")},
      {"vDistance a = b", J(R"({"kind": "vDistance", "id": "x", "a": "a", "b": "a", "value": 1})")},
      {"pointLineDistance to a point",
       J(R"({"kind": "pointLineDistance", "id": "x", "point": "c", "line": "a", "value": 1})")},
      {"pointLineDistance from a line",
       J(R"({"kind": "pointLineDistance", "id": "x", "point": "bc", "line": "ab", "value": 1})")},
      {"pointLineDistance from an end",
       J(R"({"kind": "pointLineDistance", "id": "x", "point": "b", "line": "ab", "value": 1})")},
      {"pointLineDistance negative",
       J(R"({"kind": "pointLineDistance", "id": "x", "point": "c", "line": "ab", "value": -1})")},
      {"angle a = b", J(R"({"kind": "angle", "id": "x", "a": "ab", "b": "ab", "value": 1})")},
      {"angle with a circle", J(R"({"kind": "angle", "id": "x", "a": "ab", "b": "k", "value": 1})")},
      {"angle zero", J(R"({"kind": "angle", "id": "x", "a": "ab", "b": "bc", "value": 0})")},
      {"angle π",
       with(J(R"({"kind": "angle", "id": "x", "a": "ab", "b": "bc"})"), {{"value", PI}})},
      {"angle over π", J(R"({"kind": "angle", "id": "x", "a": "ab", "b": "bc", "value": 4})")},
      {"angle reverseA false",
       J(R"({"kind": "angle", "id": "x", "a": "ab", "b": "bc", "value": 1, "reverseA": false})")},
      {"angle reverseB not true",
       J(R"({"kind": "angle", "id": "x", "a": "ab", "b": "bc", "value": 1, "reverseB": 1})")},
      {"reverseA on a distance",
       J(R"({"kind": "distance", "id": "x", "a": "a", "b": "c", "value": 1, "reverseA": true})")},
      {"diameter on a point", J(R"({"kind": "diameter", "id": "x", "curve": "a", "value": 1})")},
      {"diameter infinite",
       with(J(R"({"kind": "diameter", "id": "x", "curve": "k"})"), {{"value", INF}})},
  });
}

TEST(ParseConstraints, ReportsABadPlacementAtItsIndex) {
  const Json linear = J(R"({"kind": "linear", "offset": 1, "along": 0})");
  const Json radial = J(R"({"kind": "radial", "angle": 0, "distance": 1})");
  const Json angular = J(R"({"kind": "angular", "radius": 1, "t": 0.5})");
  const auto dist = [](const Json& placement) {
    return with(J(R"({"kind": "distance", "id": "x", "a": "a", "b": "c", "value": 1})"),
                {{"placement", placement}});
  };
  const auto rad = [](const Json& placement) {
    return with(J(R"({"kind": "radius", "id": "x", "curve": "k", "value": 1})"),
                {{"placement", placement}});
  };
  const auto ang = [](const Json& placement) {
    return with(J(R"({"kind": "angle", "id": "x", "a": "ab", "b": "bc", "value": 1})"),
                {{"placement", placement}});
  };
  expectBadConstraints(ENTITIES, {
      {"placement not an object", dist("linear")},
      {"placement null", dist(nullptr)},
      {"radial on a distance", dist(radial)},
      {"angular on a distance", dist(angular)},
      {"linear on a radius", rad(linear)},
      {"angular on a diameter", with(rad(angular), {{"kind", "diameter"}})},
      {"linear on an angle", ang(linear)},
      {"radial on a pointLineDistance",
       with(J(R"({"kind": "pointLineDistance", "id": "x", "point": "c", "line": "ab",
                  "value": 1})"),
            {{"placement", radial}})},
      {"unknown placement kind", dist(J(R"({"kind": "polar", "offset": 1, "along": 0})"))},
      {"placement with a missing property", dist(J(R"({"kind": "linear", "offset": 1})"))},
      {"placement with an extra property", dist(with(linear, {{"side", 1}}))},
      {"linear offset NaN", dist(with(linear, {{"offset", NaN}}))},
      {"linear along infinite", dist(with(linear, {{"along", -INF}}))},
      {"linear offset not a number", dist(with(linear, {{"offset", "1"}}))},
      {"radial angle infinite", rad(with(radial, {{"angle", INF}}))},
      {"radial distance zero", rad(with(radial, {{"distance", 0}}))},
      {"radial distance negative", rad(with(radial, {{"distance", -1}}))},
      {"angular radius zero", ang(with(angular, {{"radius", 0}}))},
      {"angular radius NaN", ang(with(angular, {{"radius", NaN}}))},
      {"angular t below 0", ang(with(angular, {{"t", -0.01}}))},
      {"angular t above 1", ang(with(angular, {{"t", 1.01}}))},
      {"placement on a geometric constraint",
       with(J(R"({"kind": "fix", "id": "x", "point": "a"})"), {{"placement", linear}})},
  });
}

TEST(ParseConstraints, ReportsADuplicateConstraintIdAtTheLaterOccurrence) {
  EXPECT_EQ(constraintIssues(J(R"([{"kind": "fix", "id": "f", "point": "a"},
                                   {"kind": "fix", "id": "f", "point": "b"}])")),
            Issues{constraintIssue(1)});
}

TEST(ParseConstraints, ReportsEntityAndConstraintIssuesTogether) {
  EXPECT_EQ(issuesOf(Json::array({P("a"), 5}), J(R"([{"kind": "fix", "id": "f", "point": "zz"}])")),
            (Issues{entityIssue(1), constraintIssue(0)}));
}

// --- splines

/**
 * Points of an open polyline a b c d e and two splines on them (both valid): a cubic control point
 * spline s through poles a b c d, a quadratic fit point spline f through c d e; lines ae, bc, bd.
 */
const Json SPLINE_ENTITIES = J(R"([
  {"kind": "point", "id": "a", "x": 0, "y": 0},
  {"kind": "point", "id": "b", "x": 1, "y": 2},
  {"kind": "point", "id": "c", "x": 3, "y": 2},
  {"kind": "point", "id": "d", "x": 4, "y": 0},
  {"kind": "point", "id": "e", "x": 6, "y": 1},
  {"kind": "line", "id": "ae", "p1": "a", "p2": "e"},
  {"kind": "line", "id": "bc", "p1": "b", "p2": "c"},
  {"kind": "line", "id": "bd", "p1": "b", "p2": "d"},
  {"kind": "circle", "id": "k", "center": "a", "radius": 2},
  {"kind": "bspline", "id": "s", "degree": 3, "poles": ["a", "b", "c", "d"],
   "knots": [0, 0, 0, 0, 1, 1, 1, 1]},
  {"kind": "fitSpline", "id": "f", "degree": 2, "fit": ["c", "d", "e"], "params": [0, 0.4, 1],
   "poles": [[3, 2], [4.5, -0.5], [6, 1]], "knots": [0, 0, 0, 1, 1, 1], "construction": true}
])");

Json splinePoints() {
  Json out = Json::array();
  for (int i = 0; i < 5; ++i) out.push_back(SPLINE_ENTITIES[i]);
  return out;
}

const Json BSPLINE = J(R"({"kind": "bspline", "id": "x", "degree": 3,
  "poles": ["a", "b", "c", "d", "e"], "knots": [0, 0, 0, 0, 0.5, 1, 1, 1, 1]})");
const Json FIT_SPLINE = J(R"({"kind": "fitSpline", "id": "x", "degree": 1, "fit": ["a", "e"],
  "params": [0, 1], "poles": [[0, 0], [6, 1]], "knots": [0, 0, 1, 1]})");

TEST(ParseSplines, AcceptsAControlPointSplineAndAFitPointSpline) {
  EXPECT_EQ(entityIssues(SPLINE_ENTITIES), Issues{});
  EXPECT_EQ(entityIssues(appended(splinePoints(), Json::array({BSPLINE}))), Issues{});
  EXPECT_EQ(entityIssues(appended(splinePoints(), Json::array({FIT_SPLINE}))), Issues{});
}

TEST(ParseSplines, AcceptsLowerDegreesAndInteriorKnotsRepeatedUpToTheDegree) {
  EXPECT_EQ(entityIssues(appended(splinePoints(), J(R"([
    {"kind": "bspline", "id": "x1", "degree": 1, "poles": ["a", "b"], "knots": [0, 0, 1, 1]},
    {"kind": "bspline", "id": "x2", "degree": 2, "poles": ["a", "b", "c"],
     "knots": [0, 0, 0, 1, 1, 1]},
    {"kind": "bspline", "id": "x3", "degree": 3, "poles": ["e", "d", "c", "b", "a"],
     "knots": [0, 0, 0, 0, 0.5, 1, 1, 1, 1]}
  ])"))),
            Issues{});
  // Six poles of degree 3 have two interior knots: they may coincide (multiplicity 2 ≤ 3).
  EXPECT_EQ(entityIssues(appended(splinePoints(), J(R"([
    {"kind": "point", "id": "g", "x": 7, "y": 3},
    {"kind": "bspline", "id": "x", "degree": 3, "poles": ["a", "b", "c", "d", "e", "g"],
     "knots": [0, 0, 0, 0, 0.5, 0.5, 1, 1, 1, 1]}
  ])"))),
            Issues{});
}

TEST(ParseSplines, ReportsABadControlPointSplineAtItsIndex) {
  expectBadEntities(splinePoints(), {
      {"missing property", without(BSPLINE, "knots")},
      {"extra property", with(BSPLINE, J(R"({"params": [0, 1]})"))},
      {"construction false", with(BSPLINE, {{"construction", false}})},
      {"degree not matching the poles",
       with(BSPLINE, J(R"({"degree": 2, "knots": [0, 0, 0, 0.3, 0.6, 1, 1, 1]})"))},
      {"degree not a number", with(BSPLINE, {{"degree", "3"}})},
      {"poles not an array", with(BSPLINE, {{"poles", "abcde"}})},
      {"a single pole", with(BSPLINE, J(R"({"degree": 0, "poles": ["a"], "knots": [0, 1]})"))},
      {"a pole to a missing point", with(BSPLINE, J(R"({"poles": ["a", "b", "c", "d", "zz"]})"))},
      {"a pole to a line", with(BSPLINE, J(R"({"poles": ["a", "b", "c", "d", "ae"]})"))},
      {"a pole not a string", with(BSPLINE, J(R"({"poles": ["a", "b", "c", "d", 5]})"))},
      {"repeated poles", with(BSPLINE, J(R"({"poles": ["a", "b", "c", "b", "e"]})"))},
      {"knots not an array", with(BSPLINE, {{"knots", 0}})},
      {"knots too short", with(BSPLINE, J(R"({"knots": [0, 0, 0, 0, 1, 1, 1, 1]})"))},
      {"knots too long", with(BSPLINE, J(R"({"knots": [0, 0, 0, 0, 0.3, 0.6, 1, 1, 1, 1]})"))},
      {"knots not clamped at 0", with(BSPLINE, J(R"({"knots": [0, 0, 0, 0.1, 0.5, 1, 1, 1, 1]})"))},
      {"knots not clamped at 1", with(BSPLINE, J(R"({"knots": [0, 0, 0, 0, 0.5, 0.9, 1, 1, 1]})"))},
      {"knots not starting at 0",
       with(BSPLINE, J(R"({"knots": [-1, -1, -1, -1, 0.5, 1, 1, 1, 1]})"))},
      {"knots not ending at 1", with(BSPLINE, J(R"({"knots": [0, 0, 0, 0, 0.5, 2, 2, 2, 2]})"))},
      {"an interior knot at an end", with(BSPLINE, J(R"({"knots": [0, 0, 0, 0, 1, 1, 1, 1, 1]})"))},
      {"a non-finite knot",
       with(BSPLINE, {{"knots", Json::array({0, 0, 0, 0, NaN, 1, 1, 1, 1})}})},
      {"a knot not a number", with(BSPLINE, J(R"({"knots": [0, 0, 0, 0, "0.5", 1, 1, 1, 1]})"))},
  });
}

TEST(ParseSplines, ReportsDecreasingKnotsAndAnInteriorKnotRepeatedMoreThanTheDegree) {
  const Json six = J(R"(["a", "b", "c", "d", "e", "g"])");
  EXPECT_EQ(entityIssues(appended(splinePoints(),
                                Json::array({P("g", 7, 3),
                                             with(BSPLINE, {{"poles", six},
                                                            {"knots", J("[0, 0, 0, 0, 0.6, 0.4, "
                                                                        "1, 1, 1, 1]")}})}))),
            Issues{entityIssue(6)});
  // Eight poles of degree 3 have four interior knots; all four equal is multiplicity 4 > 3.
  EXPECT_EQ(entityIssues(appended(
                splinePoints(),
                Json::array({P("g", 7, 3), P("h", 8, 0), P("i", 9, 1),
                             with(BSPLINE, J(R"({"poles": ["a", "b", "c", "d", "e", "g", "h", "i"],
                               "knots": [0, 0, 0, 0, 0.5, 0.5, 0.5, 0.5, 1, 1, 1, 1]})"))}))),
            Issues{entityIssue(8)});
}

TEST(ParseSplines, ReportsABadFitPointSplineAtItsIndex) {
  expectBadEntities(splinePoints(), {
      {"missing property", without(FIT_SPLINE, "params")},
      {"extra property", with(FIT_SPLINE, {{"radius", 1}})},
      {"construction false", with(FIT_SPLINE, {{"construction", false}})},
      {"degree not matching the fit points", with(FIT_SPLINE, {{"degree", 2}})},
      {"a single fit point",
       with(FIT_SPLINE,
            J(R"({"degree": 0, "fit": ["a"], "params": [0], "poles": [[0, 0]], "knots": [0, 1]})"))},
      {"a fit point to a missing point", with(FIT_SPLINE, J(R"({"fit": ["a", "zz"]})"))},
      {"a fit point to a line", with(FIT_SPLINE, J(R"({"fit": ["a", "ae"]})"))},
      {"repeated fit points", with(FIT_SPLINE, J(R"({"fit": ["a", "a"]})"))},
      {"params of a wrong length", with(FIT_SPLINE, J(R"({"params": [0, 0.5, 1]})"))},
      {"params not starting at 0", with(FIT_SPLINE, J(R"({"params": [0.1, 1]})"))},
      {"params not ending at 1", with(FIT_SPLINE, J(R"({"params": [0, 0.9]})"))},
      {"a non-finite param", with(FIT_SPLINE, {{"params", Json::array({0, INF})}})},
      {"poles of a wrong length", with(FIT_SPLINE, J(R"({"poles": [[0, 0], [3, 0], [6, 1]]})"))},
      {"a pole not a pair", with(FIT_SPLINE, J(R"({"poles": [[0, 0], [6]]})"))},
      {"a pole with three coordinates", with(FIT_SPLINE, J(R"({"poles": [[0, 0], [6, 1, 0]]})"))},
      {"a pole not an array", with(FIT_SPLINE, J(R"({"poles": [[0, 0], "e"]})"))},
      {"a non-finite pole coordinate",
       with(FIT_SPLINE, {{"poles", Json::array({Json::array({0, 0}), Json::array({NaN, 1})})}})},
      {"knots of a wrong length", with(FIT_SPLINE, J(R"({"knots": [0, 0, 0.5, 1, 1]})"))},
      {"knots not clamped", with(FIT_SPLINE, J(R"({"knots": [0, 0.5, 1, 1]})"))},
  });
}

TEST(ParseSplines, ReportsParamsThatDoNotIncrease) {
  const Json fit = J(R"({"kind": "fitSpline", "id": "x", "degree": 2, "fit": ["a", "b", "c"],
    "poles": [[0, 0], [1, 3], [3, 2]], "knots": [0, 0, 0, 1, 1, 1]})");
  const auto issues = [&](const char* params) {
    return entityIssues(appended(splinePoints(), Json::array({with(fit, {{"params", J(params)}})})));
  };
  EXPECT_EQ(issues("[0, 0.5, 1]"), Issues{});
  EXPECT_EQ(issues("[0, 0, 1]"), Issues{entityIssue(5)});
  EXPECT_EQ(issues("[0, 1, 1]"), Issues{entityIssue(5)});
  EXPECT_EQ(issues("[0, 1.2, 1]"), Issues{entityIssue(5)});
}

TEST(ParseSplines, AcceptsTangentBetweenALineAndASplineSharingAnEndPointInEitherOrder) {
  // ae shares a with the first pole of s, e with the last fit point of f.
  EXPECT_EQ(issuesOf(SPLINE_ENTITIES, J(R"([
    {"kind": "tangent", "id": "t1", "a": "ae", "b": "s"},
    {"kind": "tangent", "id": "t2", "a": "f", "b": "ae"},
    {"kind": "coincident", "id": "t3", "a": "a", "b": "d"}
  ])")),
            Issues{});
}

TEST(ParseSplines, AcceptsPointOnCurveOfAPointThatIsNotAPointOfTheSpline) {
  EXPECT_EQ(issuesOf(SPLINE_ENTITIES, J(R"([
    {"kind": "pointOnCurve", "id": "o1", "point": "e", "curve": "s"},
    {"kind": "pointOnCurve", "id": "o2", "point": "a", "curve": "f"}
  ])")),
            Issues{});
}

TEST(ParseSplines, ReportsBadSplineConstraints) {
  const Json fix = J(R"({"kind": "fix", "id": "g", "point": "a"})");
  expectBadConstraints(SPLINE_ENTITIES, {
      {"pointOnCurve of an end pole",
       J(R"({"kind": "pointOnCurve", "id": "x", "point": "a", "curve": "s"})")},
      {"pointOnCurve of an interior pole",
       J(R"({"kind": "pointOnCurve", "id": "x", "point": "b", "curve": "s"})")},
      {"pointOnCurve of a fit point",
       J(R"({"kind": "pointOnCurve", "id": "x", "point": "d", "curve": "f"})")},
      {"pointOnCurve of a spline on a spline",
       J(R"({"kind": "pointOnCurve", "id": "x", "point": "f", "curve": "s"})")},
      // bc shares b and c with s only at interior poles; bd shares d with f at its middle.
      {"tangent with a line not at an end", J(R"({"kind": "tangent", "id": "x", "a": "bc", "b": "s"})")},
      {"tangent with a line at the fit spline middle",
       J(R"({"kind": "tangent", "id": "x", "a": "f", "b": "bd"})")},
      {"tangent spline–circle", J(R"({"kind": "tangent", "id": "x", "a": "s", "b": "k"})")},
      {"tangent spline–spline", J(R"({"kind": "tangent", "id": "x", "a": "s", "b": "f"})")},
      {"equal two splines", J(R"({"kind": "equal", "id": "x", "a": "s", "b": "f"})")},
      {"equal line and spline", J(R"({"kind": "equal", "id": "x", "a": "ae", "b": "s"})")},
      {"parallel with a spline", J(R"({"kind": "parallel", "id": "x", "a": "ae", "b": "s"})")},
      {"horizontal on a spline", J(R"({"kind": "horizontal", "id": "x", "line": "s"})")},
      {"radius on a spline", J(R"({"kind": "radius", "id": "x", "curve": "f", "value": 1})")},
      {"coincident with a spline", J(R"({"kind": "coincident", "id": "x", "a": "a", "b": "s"})")},
  }, fix);
}

// --- xline (M31)

/** The square, xlines x through a and c and y through b and d, a spline s from a. */
Json xlineEntities() {
  return appended(ENTITIES, J(R"([
    {"kind": "point", "id": "e", "x": 5, "y": 3},
    {"kind": "xline", "id": "x", "p1": "a", "p2": "c", "construction": true},
    {"kind": "xline", "id": "y", "p1": "b", "p2": "d", "construction": true},
    {"kind": "bspline", "id": "s", "degree": 1, "poles": ["a", "e"], "knots": [0, 0, 1, 1]}
  ])"));
}

TEST(ParseXLine, AcceptsAnXlineThroughTwoDistinctPoints) {
  EXPECT_EQ(entityIssues(xlineEntities()), Issues{});
}

TEST(ParseXLine, ReportsABadXline) {
  expectBadEntities(J(R"([{"kind": "point", "id": "a", "x": 0, "y": 0},
                         {"kind": "point", "id": "b", "x": 1, "y": 0},
                         {"kind": "circle", "id": "k", "center": "a", "radius": 1}])"),
                    {
      {"without construction", J(R"({"kind": "xline", "id": "x", "p1": "a", "p2": "b"})")},
      {"with construction false",
       J(R"({"kind": "xline", "id": "x", "p1": "a", "p2": "b", "construction": false})")},
      {"with p1 = p2",
       J(R"({"kind": "xline", "id": "x", "p1": "a", "p2": "a", "construction": true})")},
      {"with a missing point",
       J(R"({"kind": "xline", "id": "x", "p1": "a", "p2": "z", "construction": true})")},
      {"with a non-point p2",
       J(R"({"kind": "xline", "id": "x", "p1": "a", "p2": "k", "construction": true})")},
      {"with an extra field",
       J(R"({"kind": "xline", "id": "x", "p1": "a", "p2": "b", "construction": true, "radius": 1})")},
  });
}

TEST(ParseXLine, AcceptsTheConstraintsThatTakeALineAsACarrierLineOnAnXline) {
  EXPECT_EQ(issuesOf(xlineEntities(), J(R"([
    {"kind": "horizontal", "id": "c1", "line": "x"},
    {"kind": "vertical", "id": "c2", "line": "x"},
    {"kind": "parallel", "id": "c3", "a": "x", "b": "ab"},
    {"kind": "parallel", "id": "c4", "a": "x", "b": "y"},
    {"kind": "perpendicular", "id": "c5", "a": "ab", "b": "x"},
    {"kind": "angle", "id": "c6", "a": "x", "b": "ab", "value": 1},
    {"kind": "pointLineDistance", "id": "c7", "point": "e", "line": "x", "value": 1},
    {"kind": "pointOnCurve", "id": "c8", "point": "e", "curve": "x"},
    {"kind": "tangent", "id": "c9", "a": "x", "b": "k"},
    {"kind": "tangent", "id": "c10", "a": "q", "b": "x"}
  ])")),
            Issues{});
}

TEST(ParseXLine, ReportsConstraintsThatNeedALengthOrEndsOnAnXline) {
  expectBadConstraints(xlineEntities(), {
      {"midpoint", J(R"({"kind": "midpoint", "id": "z", "point": "e", "line": "x"})")},
      {"equal of two xlines", J(R"({"kind": "equal", "id": "z", "a": "x", "b": "y"})")},
      {"equal of an xline and a line", J(R"({"kind": "equal", "id": "z", "a": "x", "b": "ab"})")},
      // x shares a with the first pole of s: allowed for a line, not for an xline.
      {"tangent with a spline", J(R"({"kind": "tangent", "id": "z", "a": "x", "b": "s"})")},
      {"tangent of two xlines", J(R"({"kind": "tangent", "id": "z", "a": "x", "b": "y"})")},
      {"pointOnCurve of its own point",
       J(R"({"kind": "pointOnCurve", "id": "z", "point": "a", "curve": "x"})")},
      {"pointLineDistance of its own point",
       J(R"({"kind": "pointLineDistance", "id": "z", "point": "c", "line": "x", "value": 1})")},
      {"radius", J(R"({"kind": "radius", "id": "z", "curve": "x", "value": 1})")},
      {"coincident", J(R"({"kind": "coincident", "id": "z", "a": "e", "b": "x"})")},
  }, J(R"({"kind": "fix", "id": "g", "point": "a"})"));
}

// --- mirror and patterns (M36)

const Json DIR = J(R"({"angle": 0, "count": 3, "spacing": 5})");
const Json MIRROR = J(R"({"kind": "mirror", "id": "m", "sources": ["ab", "k"], "axis": "bc"})");
const Json LINEAR = J(R"({"kind": "linearPattern", "id": "lp", "sources": ["ab", "c"],
  "direction1": {"angle": 0, "count": 3, "spacing": 5}})");
const Json CIRCULAR = J(R"({"kind": "circularPattern", "id": "cp", "sources": ["q", "ab"],
  "center": "c", "count": 4, "angle": 6.283185307179586})");

TEST(ParsePatterns, AcceptsAMirrorLinearPatternsWithOneAndTwoDirectionsAndACircularPattern) {
  EXPECT_EQ(entityIssues(appended(
                ENTITIES,
                Json::array({MIRROR, LINEAR,
                             with(LINEAR, J(R"({"id": "lp2", "direction2": {"angle": -7,
                                                   "count": 100, "spacing": 0.1}})")),
                             CIRCULAR,
                             with(CIRCULAR, {{"id", "cp2"}, {"angle", -PI / 3}, {"count", 2}}),
                             // A source in more patterns, a pattern before its sources.
                             with(MIRROR, J(R"({"id": "m2", "sources": ["ab"]})"))}))),
            Issues{});
  EXPECT_EQ(entityIssues(appended(Json::array({with(MIRROR, J(R"({"sources": ["ab"]})"))}), ENTITIES)),
            Issues{});
}

TEST(ParsePatterns, AcceptsAFullCircleWithin1e9) {
  EXPECT_EQ(entityIssues(appended(ENTITIES, Json::array({with(CIRCULAR, {{"angle", 2 * PI + 5e-10}})}))),
            Issues{});
}

TEST(ParsePatterns, ReportsABadPatternAtItsIndex) {
  const auto dir = [](const Json& patch) { return Json{{"direction1", with(DIR, patch)}}; };
  expectBadEntities(appended(ENTITIES, Json::array({LINEAR})), {
      {"mirror with construction", with(MIRROR, {{"construction", true}})},
      {"mirror without sources", J(R"({"kind": "mirror", "id": "m", "axis": "bc"})")},
      {"mirror with an extra property", with(MIRROR, {{"count", 2}})},
      {"sources not an array", with(MIRROR, {{"sources", "ab"}})},
      {"empty sources", with(MIRROR, {{"sources", Json::array()}})},
      {"duplicate source", with(MIRROR, J(R"({"sources": ["ab", "ab"]})"))},
      {"missing source", with(MIRROR, J(R"({"sources": ["zz"]})"))},
      {"source not a string", with(MIRROR, J(R"({"sources": [1]})"))},
      {"source is a pattern", with(MIRROR, J(R"({"sources": ["lp"]})"))},
      {"source is the pattern itself", with(MIRROR, J(R"({"sources": ["m"]})"))},
      {"source is the axis", with(MIRROR, J(R"({"sources": ["ab", "bc"]})"))},
      {"axis is a point", with(MIRROR, {{"axis", "a"}})},
      {"axis is a circle", with(MIRROR, {{"axis", "k"}})},
      {"axis missing", with(MIRROR, {{"axis", "zz"}})},
      {"pattern id with a colon", with(MIRROR, {{"id", "m:1"}})},
      {"pattern id with a comma", with(MIRROR, {{"id", "m,1"}})},
      {"linear without direction1", J(R"({"kind": "linearPattern", "id": "lp", "sources": ["ab"]})")},
      {"direction not an object", with(LINEAR, {{"direction1", 3}})},
      {"direction with an extra property", with(LINEAR, dir({{"x", 1}}))},
      {"direction without spacing",
       with(LINEAR, J(R"({"direction1": {"angle": 0, "count": 2}})"))},
      {"count 1", with(LINEAR, dir({{"count", 1}}))},
      {"count above the maximum", with(LINEAR, dir({{"count", 101}}))},
      {"count not an integer", with(LINEAR, dir({{"count", 2.5}}))},
      {"spacing zero", with(LINEAR, dir({{"spacing", 0}}))},
      {"spacing negative", with(LINEAR, dir({{"spacing", -1}}))},
      {"spacing infinite", with(LINEAR, dir({{"spacing", INF}}))},
      {"direction angle NaN", with(LINEAR, dir({{"angle", NaN}}))},
      {"invalid direction2", with(LINEAR, {{"direction2", with(DIR, {{"count", 0}})}})},
      {"direction2 null", with(LINEAR, {{"direction2", nullptr}})},
      {"circular center is a line", with(CIRCULAR, {{"center", "ab"}})},
      {"circular center missing", with(CIRCULAR, {{"center", "zz"}})},
      {"circular center is a source", with(CIRCULAR, J(R"({"sources": ["ab", "c"]})"))},
      {"circular count 1", with(CIRCULAR, {{"count", 1}})},
      {"circular count 101", with(CIRCULAR, {{"count", 101}})},
      {"circular count not an integer", with(CIRCULAR, {{"count", 3.2}})},
      {"circular angle zero", with(CIRCULAR, {{"angle", 0}})},
      {"circular angle above 2π", with(CIRCULAR, {{"angle", 2 * PI + 1e-6}})},
      {"circular angle below −2π", with(CIRCULAR, {{"angle", -7}})},
      {"circular angle infinite", with(CIRCULAR, {{"angle", INF}})},
  });
}

TEST(ParsePatterns, ReportsAPatternWhoseSourceIdHasAColonOrAComma) {
  const Json entities = appended(Json::array({P("x:1"), P("y,1")}), ENTITIES);
  const int n = static_cast<int>(entities.size());
  EXPECT_EQ(entityIssues(appended(entities,
                                Json::array({with(MIRROR, J(R"({"sources": ["x:1"]})")),
                                             with(LINEAR, J(R"({"sources": ["y,1"]})"))}))),
            (Issues{entityIssue(n), entityIssue(n + 1)}));
}

TEST(ParsePatterns, ReportsAConstraintOnAPattern) {
  const Json entities = appended(ENTITIES, Json::array({MIRROR, LINEAR, CIRCULAR}));
  for (const char* bad : {R"({"kind": "horizontal", "id": "x", "line": "m"})",
                          R"({"kind": "equal", "id": "x", "a": "m", "b": "lp"})",
                          R"({"kind": "fix", "id": "x", "point": "cp"})",
                          R"({"kind": "pointOnCurve", "id": "x", "point": "a", "curve": "m"})",
                          R"({"kind": "radius", "id": "x", "curve": "cp", "value": 1})"}) {
    EXPECT_EQ(issuesOf(entities, Json::array({J(bad)})), Issues{constraintIssue(0)}) << bad;
  }
}

// --- symmetric (M36)

TEST(ParseSymmetric, AcceptsTwoPointsSymmetricAcrossALine) {
  // c and d are not points of ab.
  EXPECT_EQ(constraintIssues(J(R"([{"kind": "symmetric", "id": "x", "a": "c", "b": "d",
                                    "axis": "ab"}])")),
            Issues{});
}

TEST(ParseSymmetric, ReportsABadSymmetricConstraint) {
  expectBadConstraints(ENTITIES, {
      {"a = b", J(R"({"kind": "symmetric", "id": "x", "a": "c", "b": "c", "axis": "ab"})")},
      {"a point of the axis as a",
       J(R"({"kind": "symmetric", "id": "x", "a": "a", "b": "d", "axis": "ab"})")},
      {"a point of the axis as b",
       J(R"({"kind": "symmetric", "id": "x", "a": "c", "b": "b", "axis": "ab"})")},
      {"axis a circle", J(R"({"kind": "symmetric", "id": "x", "a": "c", "b": "d", "axis": "k"})")},
      {"axis a point", J(R"({"kind": "symmetric", "id": "x", "a": "c", "b": "d", "axis": "a"})")},
      {"a a line", J(R"({"kind": "symmetric", "id": "x", "a": "bc", "b": "d", "axis": "ab"})")},
      {"b missing", J(R"({"kind": "symmetric", "id": "x", "a": "c", "b": "zz", "axis": "ab"})")},
      {"no axis", J(R"({"kind": "symmetric", "id": "x", "a": "c", "b": "d"})")},
      {"a value",
       J(R"({"kind": "symmetric", "id": "x", "a": "c", "b": "d", "axis": "ab", "value": 1})")},
  });
}

// --- offset (M35)

/**
 * Line l a→b and its copy l2 a2→b2 (2 below); a second line m b→c and its copy m2 b2→c2; circles
 * k (r 2) and k2 (r 3) around o, k3 (r 3) around o2; arcs q (r 4) and q2 (r 5) around o, q3 (r 5)
 * around o2; a spline sp and an xline xl.
 */
const Json OFFSET_ENTITIES = J(R"([
  {"kind": "point", "id": "a", "x": 0, "y": 0},
  {"kind": "point", "id": "b", "x": 10, "y": 0},
  {"kind": "line", "id": "l", "p1": "a", "p2": "b"},
  {"kind": "point", "id": "a2", "x": 0, "y": -2},
  {"kind": "point", "id": "b2", "x": 10, "y": -2},
  {"kind": "line", "id": "l2", "p1": "a2", "p2": "b2"},
  {"kind": "point", "id": "c", "x": 10, "y": 10},
  {"kind": "point", "id": "c2", "x": 12, "y": 10},
  {"kind": "line", "id": "m", "p1": "b", "p2": "c"},
  {"kind": "line", "id": "m2", "p1": "b2", "p2": "c2"},
  {"kind": "point", "id": "o", "x": 50, "y": 0},
  {"kind": "point", "id": "o2", "x": 80, "y": 0},
  {"kind": "circle", "id": "k", "center": "o", "radius": 2},
  {"kind": "circle", "id": "k2", "center": "o", "radius": 3},
  {"kind": "circle", "id": "k3", "center": "o2", "radius": 3},
  {"kind": "point", "id": "s", "x": 54, "y": 0},
  {"kind": "point", "id": "t", "x": 50, "y": 4},
  {"kind": "arc", "id": "q", "center": "o", "start": "s", "end": "t"},
  {"kind": "point", "id": "s2", "x": 55, "y": 0},
  {"kind": "point", "id": "t2", "x": 50, "y": 5},
  {"kind": "arc", "id": "q2", "center": "o", "start": "s2", "end": "t2"},
  {"kind": "point", "id": "s3", "x": 85, "y": 0},
  {"kind": "point", "id": "t3", "x": 80, "y": 5},
  {"kind": "arc", "id": "q3", "center": "o2", "start": "s3", "end": "t3"},
  {"kind": "bspline", "id": "sp", "degree": 1, "poles": ["a", "c"], "knots": [0, 0, 1, 1]},
  {"kind": "xline", "id": "xl", "p1": "a", "p2": "c", "construction": true}
])");

Json offsetOf(const char* pairs, const Json& extra = Json::object()) {
  return with(with(J(R"({"kind": "offset", "id": "x", "value": 2})"), {{"pairs", J(pairs)}}),
              extra);
}

TEST(ParseOffset, AcceptsValidPairs) {
  for (const char* pairs : {
           R"([{"source": "l", "copy": "l2"}])",
           R"([{"source": "k", "copy": "k2"}])",
           R"([{"source": "q", "copy": "q2"}])",
           R"([{"source": "l", "copy": "l2"}, {"source": "m", "copy": "m2"},
               {"source": "q", "copy": "q2"}])",
       }) {
    EXPECT_EQ(issuesOf(OFFSET_ENTITIES, Json::array({offsetOf(pairs)})), Issues{}) << pairs;
  }
}

TEST(ParseOffset, AcceptsALinearPlacement) {
  EXPECT_EQ(issuesOf(OFFSET_ENTITIES,
                     Json::array({offsetOf(R"([{"source": "l", "copy": "l2"}])",
                                           J(R"({"placement": {"kind": "linear", "offset": 1,
                                                                "along": -2}})"))})),
            Issues{});
}

TEST(ParseOffset, ReportsABadOffset) {
  const char* line = R"([{"source": "l", "copy": "l2"}])";
  expectBadConstraints(OFFSET_ENTITIES, {
      {"no pairs", offsetOf("[]")},
      {"pairs not a list", offsetOf(R"({"source": "l", "copy": "l2"})")},
      {"a pair not a record", offsetOf(R"(["l"])")},
      {"a pair without a copy", offsetOf(R"([{"source": "l"}])")},
      {"a pair with an extra field", offsetOf(R"([{"source": "l", "copy": "l2", "side": 1}])")},
      {"the copy = the source", offsetOf(R"([{"source": "l", "copy": "l"}])")},
      {"a source twice", offsetOf(R"([{"source": "l", "copy": "l2"}, {"source": "l", "copy": "m2"}])")},
      {"a copy that is a source of another pair",
       offsetOf(R"([{"source": "l", "copy": "l2"}, {"source": "l2", "copy": "m2"}])")},
      {"a copy twice", offsetOf(R"([{"source": "l", "copy": "m2"}, {"source": "m", "copy": "m2"}])")},
      {"a line → a circle", offsetOf(R"([{"source": "l", "copy": "k"}])")},
      {"a circle → an arc", offsetOf(R"([{"source": "k", "copy": "q2"}])")},
      {"an arc → a circle", offsetOf(R"([{"source": "q", "copy": "k2"}])")},
      {"a circle around another centre", offsetOf(R"([{"source": "k", "copy": "k3"}])")},
      {"an arc around another centre", offsetOf(R"([{"source": "q", "copy": "q3"}])")},
      {"a spline", offsetOf(R"([{"source": "sp", "copy": "l2"}])")},
      {"an xline", offsetOf(R"([{"source": "xl", "copy": "l2"}])")},
      {"a point", offsetOf(R"([{"source": "a", "copy": "a2"}])")},
      {"a missing curve", offsetOf(R"([{"source": "l", "copy": "zz"}])")},
      {"value 0", offsetOf(line, {{"value", 0}})},
      {"a negative value", offsetOf(line, {{"value", -2}})},
      {"a value not finite", offsetOf(line, {{"value", INF}})},
      {"no value", J(R"({"kind": "offset", "id": "x", "pairs": [{"source": "l", "copy": "l2"}]})")},
      {"a radial placement",
       offsetOf(line, J(R"({"placement": {"kind": "radial", "angle": 0, "distance": 1}})"))},
      {"an extra field", offsetOf(line, {{"line", "l"}})},
  });
}

// --- text (M37)

/** A closed square loop of character `index` (code `code`) from x0, side 1, made of lines. */
Json square(double index, int code, double x0 = 0) {
  return {{"char", index},
          {"code", code},
          {"segments", Json::array({Json::array({Json::array({x0, 0}), Json::array({x0 + 1, 0})}),
                                    Json::array({Json::array({x0 + 1, 0}), Json::array({x0 + 1, 1})}),
                                    Json::array({Json::array({x0 + 1, 1}), Json::array({x0, 1})}),
                                    Json::array({Json::array({x0, 1}), Json::array({x0, 0})})})}};
}

/** A loop of one quadratic and one cubic Bézier segment. */
Json curved(int index, int code) {
  return {{"char", index},
          {"code", code},
          {"segments", J("[[[0, 0], [1, 2], [2, 0]], [[2, 0], [2, -1], [0, -1], [0, 0]]]")}};
}

// 'a' has two loops, the space none, 'b' one curved loop.
const Json TEXT = {{"kind", "text"},   {"id", "t"},       {"text", "a b"},
                   {"font", "sans"},   {"height", 10},    {"baseline", "ab"},
                   {"contours", Json::array({square(0, 97), square(0, 97, 3), curved(2, 98)})}};

Json withContour(const Json& contour) { return with(TEXT, {{"contours", Json::array({contour})}}); }
Json segmentsOf(const Json& segments) {
  return withContour({{"char", 0}, {"code", 97}, {"segments", segments}});
}

TEST(ParseText, AcceptsATextAConstructionTextAndEveryFont) {
  EXPECT_EQ(entityIssues(appended(ENTITIES, Json::array({
                                              TEXT,
                                              with(TEXT, {{"id", "t2"}, {"construction", true}}),
                                              with(TEXT, {{"id", "t3"}, {"font", "serif"}}),
                                              with(TEXT, {{"id", "t4"}, {"font", "mono"},
                                                          {"baseline", "bc"}}),
                                          }))),
            Issues{});
}

TEST(ParseText, AcceptsATextWithoutContoursBeforeItsBaseline) {
  EXPECT_EQ(entityIssues(appended(Json::array({with(TEXT, {{"text", "   "},
                                                         {"contours", Json::array()}})}),
                                ENTITIES)),
            Issues{});
}

TEST(ParseText, CountsTheLengthInCodePointsNotUtf16Units) {
  // 200 astral code points are 400 UTF-16 units (and 800 UTF-8 bytes).
  std::string astral;
  for (int i = 0; i < 200; ++i) astral += "\U0001F600";
  EXPECT_EQ(entityIssues(appended(ENTITIES, Json::array({with(TEXT, {{"text", astral},
                                                                   {"contours", Json::array()}})}))),
            Issues{});
  // 'ž' is U+017E; it is the character 1 of "😀ž".
  EXPECT_EQ(entityIssues(appended(ENTITIES, Json::array({with(
                                              TEXT, {{"text", "\U0001F600ž"},
                                                     {"contours", Json::array({square(1, 0x17E)})}})}))),
            Issues{});
}

TEST(ParseText, AcceptsContinuityAndClosureWithin1e9RelativeToTheCoordinates) {
  const double far = 1e6;
  const Json loop = {{"char", 0},
                     {"code", 97},
                     {"segments", Json::array({Json::array({Json::array({far, 0}),
                                                            Json::array({far + 1, 0})}),
                                               Json::array({Json::array({far + 1 + 1e-4, 0}),
                                                            Json::array({far, 1})}),
                                               Json::array({Json::array({far, 1}),
                                                            Json::array({far + 5e-4, 0})})})}};
  EXPECT_EQ(entityIssues(appended(ENTITIES, Json::array({withContour(loop)}))), Issues{});
}

TEST(ParseText, ReportsABadTextAtItsIndex) {
  expectBadEntities(appended(ENTITIES, Json::array({TEXT})), {
      {"text with an extra property", with(TEXT, {{"size", 1}})},
      {"text without contours",
       J(R"({"kind": "text", "id": "t", "text": "a", "font": "sans", "height": 1, "baseline": "ab"})")},
      {"construction false", with(TEXT, {{"construction", false}})},
      {"id with a colon", with(TEXT, {{"id", "t:1"}})},
      {"id with a comma", with(TEXT, {{"id", "t,1"}})},
      {"empty string", with(TEXT, {{"text", ""}, {"contours", Json::array()}})},
      {"string not a string", with(TEXT, {{"text", 5}, {"contours", Json::array()}})},
      {"string too long", with(TEXT, {{"text", std::string(201, 'x')}, {"contours", Json::array()}})},
      {"a line break", with(TEXT, {{"text", "a\nb"}, {"contours", Json::array()}})},
      {"a tab", with(TEXT, {{"text", "a\tb"}, {"contours", Json::array()}})},
      {"a DEL character", with(TEXT, {{"text", "a\x7f"}, {"contours", Json::array()}})},
      {"unknown font", with(TEXT, {{"font", "comic"}})},
      {"height zero", with(TEXT, {{"height", 0}})},
      {"height negative", with(TEXT, {{"height", -1}})},
      {"height infinite", with(TEXT, {{"height", INF}})},
      {"height NaN", with(TEXT, {{"height", NaN}})},
      {"baseline a circle", with(TEXT, {{"baseline", "k"}})},
      {"baseline a point", with(TEXT, {{"baseline", "a"}})},
      {"baseline missing", with(TEXT, {{"baseline", "zz"}})},
      {"contours not an array", with(TEXT, {{"contours", Json::object()}})},
      {"contour not an object", withContour(Json::array())},
      {"contour with an extra property", withContour(with(square(0, 97), {{"x", 1}}))},
      {"contour without segments", withContour(J(R"({"char": 0, "code": 97})"))},
      {"char out of range", withContour(square(3, 97))},
      {"char negative", withContour(square(-1, 97))},
      {"char not an integer", withContour(square(0.5, 97))},
      {"code of another character", withContour(square(0, 98))},
      // UTF-16 index 2 would be 'a'; in code points the text has only 2 characters.
      {"char in UTF-16 units",
       with(TEXT, {{"text", "\U0001F600a"}, {"contours", Json::array({square(2, 97)})}})},
      {"no segments", segmentsOf(Json::array())},
      {"segments not an array", withContour(J(R"({"char": 0, "code": 97, "segments": "x"})"))},
      {"a segment of one pole", segmentsOf(J("[[[0, 0]], [[0, 0], [0, 0]]]"))},
      {"a segment of five poles", segmentsOf(J("[[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]"))},
      {"a pole not a pair", segmentsOf(J("[[[0, 0, 0], [1, 0]], [[1, 0], [0, 0, 0]]]"))},
      {"a pole not finite",
       segmentsOf(Json::array({Json::array({Json::array({0, 0}), Json::array({NaN, 0})}),
                               Json::array({Json::array({NaN, 0}), Json::array({0, 0})})}))},
      {"an open loop", segmentsOf(J("[[[0, 0], [1, 0]], [[1, 0], [1, 1]]]"))},
      {"segments that do not join", segmentsOf(J("[[[0, 0], [1, 0]], [[1, 1e-6], [0, 0]]]"))},
  });
}

TEST(ParseText, ReportsATextAsAPatternSource) {
  EXPECT_EQ(entityIssues(appended(ENTITIES, Json::array({TEXT, J(R"({"kind": "mirror", "id": "m",
                                                          "sources": ["t"], "axis": "ab"})")}))),
            Issues{entityIssue(N + 1)});
}

TEST(ParseText, ReportsAConstraintOnAText) {
  const Json entities = appended(ENTITIES, Json::array({TEXT}));
  for (const char* bad : {R"({"kind": "horizontal", "id": "x", "line": "t"})",
                          R"({"kind": "equal", "id": "x", "a": "ab", "b": "t"})",
                          R"({"kind": "pointOnCurve", "id": "x", "point": "c", "curve": "t"})",
                          R"({"kind": "fix", "id": "x", "point": "t"})",
                          R"({"kind": "radius", "id": "x", "curve": "t", "value": 1})"}) {
    EXPECT_EQ(issuesOf(entities, Json::array({J(bad)})), Issues{constraintIssue(0)}) << bad;
  }
}

TEST(ParseText, AcceptsConstraintsOnTheBaselineOfAText) {
  EXPECT_EQ(issuesOf(appended(ENTITIES, Json::array({TEXT})),
                     J(R"([{"kind": "horizontal", "id": "x", "line": "ab"}])")),
            Issues{});
}

// --- an xline as an axis or a baseline (M36, M37 after M31)

Json withXline() {
  return appended(ENTITIES,
                J(R"([{"kind": "xline", "id": "x", "p1": "b", "p2": "d", "construction": true}])"));
}

TEST(ParseXLineAxis, AcceptsAMirrorAcrossAnXline) {
  EXPECT_EQ(entityIssues(appended(withXline(), J(R"([{"kind": "mirror", "id": "m", "sources": ["ab"],
                                                   "axis": "x"}])"))),
            Issues{});
}

TEST(ParseXLineAxis, AcceptsATextOnAnXline) {
  EXPECT_EQ(entityIssues(appended(withXline(), J(R"([{"kind": "text", "id": "t", "text": "a",
    "font": "sans", "height": 10, "baseline": "x", "contours": []}])"))),
            Issues{});
}

TEST(ParseXLineAxis, AcceptsASymmetricConstraintAcrossAnXline) {
  EXPECT_EQ(issuesOf(withXline(),
                     J(R"([{"kind": "symmetric", "id": "s", "a": "a", "b": "c", "axis": "x"}])")),
            Issues{});
}

TEST(ParseXLineAxis, ReportsASymmetricConstraintWithAPointOfTheXline) {
  EXPECT_EQ(issuesOf(withXline(),
                     J(R"([{"kind": "symmetric", "id": "s", "a": "b", "b": "c", "axis": "x"}])")),
            Issues{constraintIssue(0)});
}

}  // namespace
}  // namespace tinycad::sketch
