// Port of test/unit/sketch/geometry.test.ts: curve2 and regionCurves (spec 12 "Křivky pro oblasti
// a odvozená id").

#include <gtest/gtest.h>

#include <memory>
#include <numbers>
#include <stdexcept>
#include <string>
#include <vector>

#include "testing.hpp"

namespace tinycad::sketch {
namespace {

using namespace testing;
using Ids = std::vector<std::string>;

constexpr double PI = std::numbers::pi;

const SketchEntity& entity(const Sketch& sketch, const std::string& id) {
  const SketchEntity* e = sketch.findEntity(SketchEntityId(id));
  if (e == nullptr) throw std::runtime_error("no entity " + id);
  return *e;
}

Ids ids(const std::vector<Curve2>& curves) {
  Ids out;
  for (const auto& c : curves) out.push_back(c.id);
  return out;
}

TEST(Curve2Of, TurnsLinesCirclesAndArcsIntoCoordinatesWithTheEntityId) {
  const Sketch sketch = sketchOf(J(R"([
    {"kind": "point", "id": "o", "x": 1, "y": 2},
    {"kind": "point", "id": "s", "x": 4, "y": 2},
    {"kind": "point", "id": "e", "x": 1, "y": 5},
    {"kind": "line", "id": "l", "p1": "s", "p2": "e"},
    {"kind": "circle", "id": "k", "center": "o", "radius": 7},
    {"kind": "arc", "id": "q", "center": "o", "start": "s", "end": "e", "construction": true}
  ])"));
  EXPECT_EQ(sketch.curve2(entity(sketch, "l")), Curve2::line({4, 2}, {1, 5}, "l"));
  EXPECT_EQ(sketch.curve2(entity(sketch, "k")), Curve2::circle({1, 2}, 7, "k"));
  EXPECT_EQ(sketch.curve2(entity(sketch, "q")), Curve2::arc({1, 2}, {4, 2}, {1, 5}, true, "q"));
}

TEST(Curve2Of, ThrowsWhenAPointIsMissing) {
  const auto line = std::make_shared<SketchLine>(SketchEntityId("l"), SketchEntityId("a"),
                                                 SketchEntityId("b"), false);
  const Sketch broken({line}, {});
  EXPECT_THROW((void)broken.curve2(*line), core::AssertionError);
}

TEST(Curve2Of, TurnsSplinesIntoBSplines) {
  const Sketch sketch = sketchOf(J(R"([
    {"kind": "point", "id": "a", "x": 0, "y": 0},
    {"kind": "point", "id": "b", "x": 1, "y": 2},
    {"kind": "point", "id": "c", "x": 3, "y": 2},
    {"kind": "bspline", "id": "s", "degree": 2, "poles": ["a", "b", "c"],
     "knots": [0, 0, 0, 1, 1, 1]},
    {"kind": "fitSpline", "id": "f", "degree": 2, "fit": ["c", "b", "a"], "params": [0, 0.5, 1],
     "poles": [[3, 2], [1, 3], [0, 0]], "knots": [0, 0, 0, 1, 1, 1], "construction": true}
  ])"));
  EXPECT_EQ(sketch.curve2(entity(sketch, "s")),
            Curve2::bspline(2, {{0, 0}, {1, 2}, {3, 2}}, {0, 0, 0, 1, 1, 1}, "s"));
  EXPECT_EQ(sketch.curve2(entity(sketch, "f")),
            Curve2::bspline(2, {{3, 2}, {1, 3}, {0, 0}}, {0, 0, 0, 1, 1, 1}, "f"));
}

TEST(Curve2Of, TurnsAnXlineIntoALineXlineExtentEachWayFromTheMiddle) {
  const Sketch sketch = sketchOf(J(R"([
    {"kind": "point", "id": "p", "x": 1, "y": 1},
    {"kind": "point", "id": "q", "x": 4, "y": 5},
    {"kind": "xline", "id": "x", "p1": "p", "p2": "q", "construction": true}
  ])"));
  const Curve2 c = sketch.curve2(entity(sketch, "x"));
  // m = (2.5, 3), d̂ = (0.6, 0.8).
  EXPECT_EQ(c.kind, Curve2::Kind::Line);
  EXPECT_EQ(c.id, "x");
  EXPECT_NEAR(c.from[0], 2.5 - 0.6 * XLINE_EXTENT, 1e-6);
  EXPECT_NEAR(c.from[1], 3 - 0.8 * XLINE_EXTENT, 1e-6);
  EXPECT_NEAR(c.to[0], 2.5 + 0.6 * XLINE_EXTENT, 1e-6);
  EXPECT_NEAR(c.to[1], 3 + 0.8 * XLINE_EXTENT, 1e-6);
  EXPECT_EQ(XLINE_EXTENT, 1e5);
}

const Json REGION_DATA = J(R"([
  {"kind": "point", "id": "a", "x": 0, "y": 0},
  {"kind": "point", "id": "b", "x": 4, "y": 0},
  {"kind": "point", "id": "c", "x": 4, "y": 3},
  {"kind": "point", "id": "d", "x": 0, "y": 4},
  {"kind": "line", "id": "ab", "p1": "a", "p2": "b"},
  {"kind": "line", "id": "bc", "p1": "b", "p2": "c", "construction": true},
  {"kind": "arc", "id": "q", "center": "a", "start": "b", "end": "d"},
  {"kind": "circle", "id": "k", "center": "c", "radius": 1},
  {"kind": "circle", "id": "kc", "center": "a", "radius": 9, "construction": true},
  {"kind": "bspline", "id": "s", "degree": 2, "poles": ["a", "b", "c"],
   "knots": [0, 0, 0, 1, 1, 1]},
  {"kind": "fitSpline", "id": "f", "degree": 2, "fit": ["c", "b", "a"], "params": [0, 0.5, 1],
   "poles": [[4, 3], [5, 1], [0, 0]], "knots": [0, 0, 0, 1, 1, 1]},
  {"kind": "fitSpline", "id": "fc", "degree": 2, "fit": ["a", "b", "c"], "params": [0, 0.5, 1],
   "poles": [[0, 0], [5, 1], [4, 3]], "knots": [0, 0, 0, 1, 1, 1], "construction": true}
])");

TEST(RegionCurves, GivesTheNonConstructionCurvesInEntityOrderLikeCurve2) {
  const Sketch sketch = sketchOf(REGION_DATA);
  const auto curves = sketch.regionCurves();
  EXPECT_EQ(ids(curves), (Ids{"ab", "q", "k", "s", "f"}));
  std::vector<Curve2> expected;
  for (const char* id : {"ab", "q", "k", "s", "f"}) {
    expected.push_back(sketch.curve2(entity(sketch, id)));
  }
  EXPECT_EQ(curves, expected);
  EXPECT_EQ(curves[3], Curve2::bspline(2, {{0, 0}, {4, 0}, {4, 3}}, {0, 0, 0, 1, 1, 1}, "s"));
}

TEST(RegionCurves, GivesNothingForOnlyPointsOrConstructionCurves) {
  EXPECT_TRUE(sketchOf(J(R"([
    {"kind": "point", "id": "a", "x": 0, "y": 0},
    {"kind": "point", "id": "b", "x": 1, "y": 0},
    {"kind": "line", "id": "l", "p1": "a", "p2": "b", "construction": true}
  ])")).regionCurves().empty());
}

TEST(RegionCurves, LeavesAnXlineOut) {
  EXPECT_EQ(ids(sketchOf(J(R"([
    {"kind": "point", "id": "a", "x": 0, "y": 0},
    {"kind": "point", "id": "b", "x": 4, "y": 0},
    {"kind": "line", "id": "ab", "p1": "a", "p2": "b"},
    {"kind": "xline", "id": "x", "p1": "a", "p2": "b", "construction": true}
  ])")).regionCurves()),
            (Ids{"ab"}));
}

/** A construction axis ou, a circle k, a line ef and a construction line cf. */
Json patternBase() {
  return J(R"([
    {"kind": "point", "id": "o", "x": 0, "y": 0},
    {"kind": "point", "id": "u", "x": 0, "y": 1},
    {"kind": "point", "id": "c", "x": 3, "y": 0},
    {"kind": "point", "id": "e", "x": 4, "y": 0},
    {"kind": "point", "id": "f", "x": 4, "y": 2},
    {"kind": "line", "id": "ou", "p1": "o", "p2": "u", "construction": true},
    {"kind": "circle", "id": "k", "center": "c", "radius": 0.5},
    {"kind": "line", "id": "ef", "p1": "e", "p2": "f"},
    {"kind": "line", "id": "cf", "p1": "c", "p2": "f", "construction": true}
  ])");
}

TEST(RegionCurvesCopies, AppendsTheCopiesOfAMirrorAfterTheCurvesOfTheData) {
  const auto curves = sketchOf(appended(patternBase(), J(R"([{"kind": "mirror", "id": "m",
                                                           "sources": ["k", "ef"],
                                                           "axis": "ou"}])")))
                          .regionCurves();
  EXPECT_EQ(ids(curves), (Ids{"k", "ef", "m:1.k", "m:1.ef"}));
  EXPECT_EQ(curves[2], Curve2::circle({-3, 0}, 0.5, "m:1.k"));
  EXPECT_EQ(curves[3], Curve2::line({-4, 0}, {-4, 2}, "m:1.ef"));
}

TEST(RegionCurvesCopies, AppendsTheCopiesOfALinearPatternInOneAndTwoDirections) {
  const auto one = sketchOf(appended(patternBase(), J(R"([{"kind": "linearPattern", "id": "lp",
    "sources": ["k"], "direction1": {"angle": 1.5707963267948966, "count": 3, "spacing": 2}}])")))
                       .regionCurves();
  EXPECT_EQ(ids(one), (Ids{"k", "ef", "lp:1.k", "lp:2.k"}));
  EXPECT_NEAR(one[3].center[0], 3, 1e-12);
  EXPECT_NEAR(one[3].center[1], 4, 1e-12);
  const auto grid = sketchOf(appended(patternBase(), J(R"([{"kind": "linearPattern", "id": "lp",
    "sources": ["k"], "direction1": {"angle": 0, "count": 2, "spacing": 2},
    "direction2": {"angle": 1.5707963267948966, "count": 2, "spacing": 2}}])")))
                        .regionCurves();
  EXPECT_EQ(ids(grid), (Ids{"k", "ef", "lp:0-1.k", "lp:1-0.k", "lp:1-1.k"}));
}

TEST(RegionCurvesCopies, AppendsTheCopiesOfACircularPattern) {
  const auto curves =
      sketchOf(appended(patternBase(), Json::array({{{"kind", "circularPattern"},
                                                   {"id", "cp"},
                                                   {"sources", Json::array({"k"})},
                                                   {"center", "o"},
                                                   {"count", 4},
                                                   {"angle", 2 * PI}}})))
          .regionCurves();
  EXPECT_EQ(ids(curves), (Ids{"k", "ef", "cp:1.k", "cp:2.k", "cp:3.k"}));
  EXPECT_NEAR(curves[2].center[0], 0, 1e-12);
  EXPECT_NEAR(curves[2].center[1], 3, 1e-12);
  EXPECT_EQ(curves[2].radius, 0.5);
}

TEST(RegionCurvesCopies, SkipsTheCopiesOfConstructionCurvesAndThePatternsThemselves) {
  EXPECT_EQ(ids(sketchOf(appended(patternBase(), J(R"([
    {"kind": "mirror", "id": "m", "sources": ["cf", "c"], "axis": "ou"},
    {"kind": "linearPattern", "id": "lp", "sources": ["cf"],
     "direction1": {"angle": 0, "count": 2, "spacing": 1}}
  ])"))).regionCurves()),
            (Ids{"k", "ef"}));
}

/** A circle k mirrored across a construction axis. */
const Json MIRRORED = J(R"([
  {"kind": "point", "id": "o", "x": 0, "y": -5},
  {"kind": "point", "id": "u", "x": 1, "y": -5},
  {"kind": "point", "id": "c", "x": 3, "y": -1},
  {"kind": "line", "id": "ou", "p1": "o", "p2": "u", "construction": true},
  {"kind": "circle", "id": "k", "center": "c", "radius": 0.5},
  {"kind": "mirror", "id": "m", "sources": ["k"], "axis": "ou"}
])");

TEST(RegionCurvesTexts, AppendsTheCurvesOfATextAfterTheCurvesOfTheDataAndTheCopies) {
  const Json text = textEntities();
  const auto curves = sketchOf(appended(text, MIRRORED)).regionCurves();
  const auto letters = sketchOf(text).textCurves();
  Ids expected = {"k", "m:1.k"};
  for (const auto& id : ids(letters)) expected.push_back(id);
  EXPECT_EQ(ids(curves), expected);
  EXPECT_EQ(std::vector<Curve2>(curves.begin() + 2, curves.end()), letters);
}

TEST(RegionCurvesTexts, SkipsAConstructionTextButNotTheTextOnAConstructionBaseline) {
  TextOptions normal;
  normal.id = "n";
  normal.text = "a";
  TextOptions construction;
  construction.id = "c";
  construction.text = "b";
  construction.construction = true;
  construction.p1 = {0, 20};
  const auto curves =
      sketchOf(appended(textEntities(construction), textEntities(normal))).regionCurves();
  EXPECT_EQ(ids(curves), ids(sketchOf(textEntities(normal)).textCurves()));
}

}  // namespace
}  // namespace tinycad::sketch
