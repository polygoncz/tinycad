// Port of test/unit/sketch/patterns.test.ts: copies of mirrors and patterns (patternCopies) and
// patternOfCopy (spec 12 "Zrcadlení a pole (M36)").

#include <gtest/gtest.h>

#include <algorithm>
#include <cmath>
#include <numbers>
#include <string>
#include <string_view>
#include <vector>

#include "testing.hpp"

namespace tinycad::sketch {
namespace {

using namespace testing;
using Ids = std::vector<std::string>;

constexpr double PI = std::numbers::pi;

/** A line a → b from [1, 0] to [3, 0]; a vertical construction axis o → u (x = 0). */
Json base() {
  return J(R"([
    {"kind": "point", "id": "a", "x": 1, "y": 0},
    {"kind": "point", "id": "b", "x": 3, "y": 0},
    {"kind": "line", "id": "ab", "p1": "a", "p2": "b"},
    {"kind": "point", "id": "o", "x": 0, "y": 0},
    {"kind": "point", "id": "u", "x": 0, "y": 5},
    {"kind": "line", "id": "ou", "p1": "o", "p2": "u", "construction": true}
  ])");
}

std::vector<EntityPtr> copiesOf(const Json& more) {
  return sketchOf(appended(base(), more)).patternCopies();
}

Ids ids(const std::vector<EntityPtr>& copies) {
  Ids out;
  for (const auto& c : copies) out.push_back(c->id().str());
  return out;
}

const SketchEntity& copyAt(const std::vector<EntityPtr>& copies, std::string_view id) {
  for (const auto& c : copies) {
    if (c->id().str() == id) return *c;
  }
  ADD_FAILURE() << "no copy " << id;
  return *copies.front();
}

void expectPoint(const std::vector<EntityPtr>& copies, const std::string& id, double x, double y) {
  const SketchEntity& p = copyAt(copies, id);
  ASSERT_EQ(p.kind(), EntityKind::Point) << id;
  EXPECT_NEAR(p.as<SketchPoint>().x, x, 1e-9) << id;
  EXPECT_NEAR(p.as<SketchPoint>().y, y, 1e-9) << id;
}

TEST(PatternCopiesMirror, MirrorsALineAcrossTheAxisPointsBeforeTheCurve) {
  const auto copies = copiesOf(J(R"([{"kind": "mirror", "id": "m", "sources": ["ab"],
                                      "axis": "ou"}])"));
  EXPECT_EQ(ids(copies), (Ids{"m:1.a", "m:1.b", "m:1.ab"}));
  expectPoint(copies, "m:1.a", -1, 0);
  expectPoint(copies, "m:1.b", -3, 0);
  EXPECT_EQ(entityJson(copyAt(copies, "m:1.ab")),
            J(R"({"kind": "line", "id": "m:1.ab", "p1": "m:1.a", "p2": "m:1.b"})"));
}

TEST(PatternCopiesMirror, MirrorsAcrossASlantedAxis) {
  // Axis y = x through o and w: [1, 0] → [0, 1].
  const auto copies = copiesOf(J(R"([
    {"kind": "point", "id": "w", "x": 2, "y": 2},
    {"kind": "line", "id": "ow", "p1": "o", "p2": "w"},
    {"kind": "mirror", "id": "m", "sources": ["a"], "axis": "ow"}
  ])"));
  EXPECT_EQ(ids(copies), (Ids{"m:1.a"}));
  expectPoint(copies, "m:1.a", 0, 1);
}

TEST(PatternCopiesMirror, MirrorsAnArcWithStartAndEndSwapped) {
  // Quarter arc around c [2, 0] from s [3, 0] to e [2, 1]; mirror across x = 0.
  const auto copies = copiesOf(J(R"([
    {"kind": "point", "id": "c", "x": 2, "y": 0},
    {"kind": "point", "id": "s", "x": 3, "y": 0},
    {"kind": "point", "id": "e", "x": 2, "y": 1},
    {"kind": "arc", "id": "q", "center": "c", "start": "s", "end": "e"},
    {"kind": "mirror", "id": "m", "sources": ["q"], "axis": "ou"}
  ])"));
  EXPECT_EQ(ids(copies), (Ids{"m:1.c", "m:1.s", "m:1.e", "m:1.q"}));
  EXPECT_EQ(entityJson(copyAt(copies, "m:1.q")),
            J(R"({"kind": "arc", "id": "m:1.q", "center": "m:1.c", "start": "m:1.e",
                 "end": "m:1.s"})"));
  expectPoint(copies, "m:1.s", -3, 0);
  expectPoint(copies, "m:1.e", -2, 1);
}

TEST(PatternCopiesMirror, MirrorsACircleByItsCentreOnly) {
  const auto copies = copiesOf(J(R"([
    {"kind": "point", "id": "c", "x": 2, "y": 3},
    {"kind": "circle", "id": "k", "center": "c", "radius": 1.5},
    {"kind": "mirror", "id": "m", "sources": ["k"], "axis": "ou"}
  ])"));
  EXPECT_EQ(entityJson(copyAt(copies, "m:1.k")),
            J(R"({"kind": "circle", "id": "m:1.k", "center": "m:1.c", "radius": 1.5})"));
  expectPoint(copies, "m:1.c", -2, 3);
}

TEST(PatternCopiesMirror, MirrorsAFitPointSplineFitPointsAndStoredPoles) {
  const auto copies = copiesOf(J(R"([
    {"kind": "point", "id": "f0", "x": 1, "y": 1},
    {"kind": "point", "id": "f1", "x": 4, "y": 2},
    {"kind": "fitSpline", "id": "fs", "degree": 1, "fit": ["f0", "f1"], "params": [0, 1],
     "poles": [[1, 1], [4, 2]], "knots": [0, 0, 1, 1], "construction": true},
    {"kind": "mirror", "id": "m", "sources": ["fs"], "axis": "ou"}
  ])"));
  const SketchEntity& copy = copyAt(copies, "m:1.fs");
  ASSERT_EQ(copy.kind(), EntityKind::FitSpline);
  const auto& fs = copy.as<SketchFitSpline>();
  EXPECT_EQ(fs.fit, (std::vector{SketchEntityId("m:1.f0"), SketchEntityId("m:1.f1")}));
  EXPECT_EQ(fs.params, (std::vector<double>{0, 1}));
  EXPECT_EQ(fs.knots, (std::vector<double>{0, 0, 1, 1}));
  EXPECT_TRUE(fs.construction);
  EXPECT_NEAR(fs.poles[0][0], -1, 1e-9);
  EXPECT_NEAR(fs.poles[1][0], -4, 1e-9);
  EXPECT_NEAR(fs.poles[1][1], 2, 1e-9);
}

TEST(PatternCopiesMirror, MirrorsAcrossAnXlineLikeAcrossALine) {
  const auto copies = copiesOf(J(R"([
    {"kind": "xline", "id": "x", "p1": "o", "p2": "u", "construction": true},
    {"kind": "mirror", "id": "m", "sources": ["ab"], "axis": "x"}
  ])"));
  EXPECT_EQ(ids(copies), (Ids{"m:1.a", "m:1.b", "m:1.ab"}));
  expectPoint(copies, "m:1.a", -1, 0);
}

Json linear(int count, double spacing, double angle) {
  return Json::array({{{"kind", "linearPattern"},
                       {"id", "lp"},
                       {"sources", Json::array({"ab"})},
                       {"direction1", {{"angle", angle}, {"count", count}, {"spacing", spacing}}}}});
}

TEST(PatternCopiesLinear, CopiesAlongOneDirectionWithIndices1ToCountMinus1) {
  const auto copies = copiesOf(linear(3, 4, PI / 2));
  EXPECT_EQ(ids(copies), (Ids{"lp:1.a", "lp:1.b", "lp:1.ab", "lp:2.a", "lp:2.b", "lp:2.ab"}));
  expectPoint(copies, "lp:1.a", 1, 4);
  expectPoint(copies, "lp:2.b", 3, 8);
}

TEST(PatternCopiesLinear, CopiesAGridWithTwoDirectionsIMajorWithout00) {
  const auto copies = copiesOf(J(R"([{"kind": "linearPattern", "id": "lp", "sources": ["a"],
    "direction1": {"angle": 0, "count": 2, "spacing": 10},
    "direction2": {"angle": 1.5707963267948966, "count": 3, "spacing": 5}}])"));
  EXPECT_EQ(ids(copies), (Ids{"lp:0-1.a", "lp:0-2.a", "lp:1-0.a", "lp:1-1.a", "lp:1-2.a"}));
  expectPoint(copies, "lp:0-2.a", 1, 10);
  expectPoint(copies, "lp:1-0.a", 11, 0);
  expectPoint(copies, "lp:1-2.a", 11, 10);
}

TEST(PatternCopiesLinear, KeepsTheIdsWhenTheSpacingOrTheAngleChanges) {
  EXPECT_EQ(ids(copiesOf(linear(3, 7, 1))), ids(copiesOf(linear(3, 4, 0))));
}

TEST(PatternCopiesLinear, LoweringTheCountRemovesOnlyTheHighestIndices) {
  const Ids four = ids(copiesOf(linear(4, 5, 0)));
  const Ids three = ids(copiesOf(linear(3, 5, 0)));
  Ids removed;
  for (const auto& id : four) {
    if (std::find(three.begin(), three.end(), id) == three.end()) removed.push_back(id);
  }
  EXPECT_EQ(removed, (Ids{"lp:3.a", "lp:3.b", "lp:3.ab"}));
  EXPECT_EQ(Ids(four.begin(), four.begin() + 6), three);
}

TEST(PatternCopiesLinear, KeepsPointsSharedByTwoSourcesSharedInTheCopy) {
  const auto copies = copiesOf(J(R"([
    {"kind": "point", "id": "c", "x": 3, "y": 2},
    {"kind": "line", "id": "bc", "p1": "b", "p2": "c"},
    {"kind": "linearPattern", "id": "lp", "sources": ["ab", "bc"],
     "direction1": {"angle": 0, "count": 2, "spacing": 5}}
  ])"));
  EXPECT_EQ(ids(copies), (Ids{"lp:1.a", "lp:1.b", "lp:1.ab", "lp:1.c", "lp:1.bc"}));
  EXPECT_EQ(copyAt(copies, "lp:1.ab").as<SketchLine>().p2.str(), "lp:1.b");
  EXPECT_EQ(copyAt(copies, "lp:1.bc").as<SketchLine>().p1.str(), "lp:1.b");
}

TEST(PatternCopiesLinear, CopiesInheritConstructionOfTheirSource) {
  const auto copies = copiesOf(J(R"([{"kind": "linearPattern", "id": "lp", "sources": ["ou"],
    "direction1": {"angle": 0, "count": 2, "spacing": 5}}])"));
  EXPECT_EQ(entityJson(copyAt(copies, "lp:1.ou")),
            J(R"({"kind": "line", "id": "lp:1.ou", "p1": "lp:1.o", "p2": "lp:1.u",
                 "construction": true})"));
}

std::vector<EntityPtr> circularCopies(int count, double angle) {
  return copiesOf(Json::array({{{"kind", "circularPattern"},
                                {"id", "cp"},
                                {"sources", Json::array({"a"})},
                                {"center", "o"},
                                {"count", count},
                                {"angle", angle}}}));
}

TEST(PatternCopiesCircular, DividesAFullCircleIntoCountSteps) {
  const auto copies = circularCopies(4, 2 * PI);
  EXPECT_EQ(ids(copies), (Ids{"cp:1.a", "cp:2.a", "cp:3.a"}));
  expectPoint(copies, "cp:1.a", 0, 1);
  expectPoint(copies, "cp:2.a", -1, 0);
  expectPoint(copies, "cp:3.a", 0, -1);
}

TEST(PatternCopiesCircular, SpreadsASmallerAngleOverCountMinus1Steps) {
  const auto copies = circularCopies(3, PI / 2);
  EXPECT_EQ(ids(copies), (Ids{"cp:1.a", "cp:2.a"}));
  expectPoint(copies, "cp:1.a", std::sqrt(0.5), std::sqrt(0.5));
  expectPoint(copies, "cp:2.a", 0, 1);
}

TEST(PatternCopiesCircular, TurnsClockwiseForANegativeAngle) {
  expectPoint(circularCopies(2, -PI / 2), "cp:1.a", 0, -1);
  expectPoint(circularCopies(4, -2 * PI), "cp:1.a", 0, -1);
}

TEST(PatternCopiesCircular, RotatesAnArcWithoutSwappingItsEnds) {
  const auto copies = copiesOf(J(R"([
    {"kind": "point", "id": "c", "x": 2, "y": 0},
    {"kind": "point", "id": "s", "x": 3, "y": 0},
    {"kind": "point", "id": "e", "x": 2, "y": 1},
    {"kind": "arc", "id": "q", "center": "c", "start": "s", "end": "e"},
    {"kind": "circularPattern", "id": "cp", "sources": ["q"], "center": "o", "count": 2,
     "angle": 3.141592653589793}
  ])"));
  EXPECT_EQ(entityJson(copyAt(copies, "cp:1.q")),
            J(R"({"kind": "arc", "id": "cp:1.q", "center": "cp:1.c", "start": "cp:1.s",
                 "end": "cp:1.e"})"));
  expectPoint(copies, "cp:1.s", -3, 0);
}

TEST(PatternCopiesOrder, CopiesPatternsInEntityOrderAndAPointOncePerInstance) {
  const auto copies = copiesOf(J(R"([
    {"kind": "mirror", "id": "m", "sources": ["ab", "a"], "axis": "ou"},
    {"kind": "linearPattern", "id": "lp", "sources": ["b"],
     "direction1": {"angle": 0, "count": 2, "spacing": 1}}
  ])"));
  EXPECT_EQ(ids(copies), (Ids{"m:1.a", "m:1.b", "m:1.ab", "lp:1.b"}));
}

TEST(PatternCopiesOrder, ReturnsNothingWithoutPatterns) {
  EXPECT_TRUE(sketchOf(base()).patternCopies().empty());
}

TEST(PatternOfCopy, ReturnsThePatternOfADerivedId) {
  EXPECT_EQ(patternOfCopy("m:1.ab"), SketchEntityId("m"));
  EXPECT_EQ(patternOfCopy("lp:1-0.a"), SketchEntityId("lp"));
  EXPECT_EQ(patternOfCopy("cp:12.xYz"), SketchEntityId("cp"));
}

TEST(PatternOfCopy, ReturnsNulloptForOtherIds) {
  for (const char* id : {"ab", ":1.a", "m:1.", "m:x.a", "__poles:sp", "m,n:1.a", "m:1.a:b"}) {
    EXPECT_EQ(patternOfCopy(id), std::nullopt) << id;
  }
}

}  // namespace
}  // namespace tinycad::sketch
