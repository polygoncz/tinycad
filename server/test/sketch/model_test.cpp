// Port of test/unit/sketch/{model,points}.test.ts: the kind groups, circularStep and the value
// rules of patterns and texts (patternParamsValid, textParamsValid – internal to parse, so they
// are checked through Sketch::parse).

#include <gtest/gtest.h>

#include <cmath>
#include <limits>
#include <numbers>
#include <string>

#include "testing.hpp"

namespace tinycad::sketch {
namespace {

using namespace testing;

constexpr double PI = std::numbers::pi;
const double NaN = std::numeric_limits<double>::quiet_NaN();
const double INF = std::numeric_limits<double>::infinity();

TEST(IsLineCarrier, IsTrueForALineAndAnXlineOnly) {
  const Sketch sketch = sketchOf(J(R"([
    {"kind": "point", "id": "a", "x": 0, "y": 0},
    {"kind": "point", "id": "b", "x": 10, "y": 0},
    {"kind": "point", "id": "c", "x": 0, "y": 10},
    {"kind": "line", "id": "l", "p1": "a", "p2": "b"},
    {"kind": "xline", "id": "x", "p1": "a", "p2": "c", "construction": true},
    {"kind": "circle", "id": "k", "center": "a", "radius": 3},
    {"kind": "arc", "id": "q", "center": "a", "start": "b", "end": "c"},
    {"kind": "bspline", "id": "s", "degree": 1, "poles": ["a", "b"], "knots": [0, 0, 1, 1]}
  ])"));
  std::vector<std::string> carriers;
  for (const auto& e : sketch.entities()) {
    if (e->isLineCarrier()) carriers.push_back(e->id().str());
  }
  EXPECT_EQ(carriers, (std::vector<std::string>{"l", "x"}));
}

SketchCircularPattern circular(int count, double angle) {
  return {SketchEntityId("cp"), {SketchEntityId("ab")}, SketchEntityId("o"), count, angle};
}

TEST(CircularStep, AFullCircleStepsByAngleOverCountInBothSenses) {
  EXPECT_NEAR(circular(4, 2 * PI).step(), PI / 2, 1e-12);
  EXPECT_NEAR(circular(4, -2 * PI).step(), -PI / 2, 1e-12);
  EXPECT_NEAR(circular(3, 2 * PI + 1e-10).step(), 2 * PI / 3, 1e-9);
}

TEST(CircularStep, APartialAngleStepsByAngleOverCountMinusOne) {
  EXPECT_NEAR(circular(4, PI).step(), PI / 3, 1e-12);
  EXPECT_EQ(circular(2, -1).step(), -1);
}

TEST(KindGroups, APointOrACurveIsAPatternSourceAPatternOrTextIsNot) {
  const Sketch sketch = sketchOf(J(R"([
    {"kind": "point", "id": "a", "x": 0, "y": 0},
    {"kind": "point", "id": "b", "x": 1, "y": 0},
    {"kind": "point", "id": "d", "x": 0, "y": 1},
    {"kind": "line", "id": "ab", "p1": "a", "p2": "b"},
    {"kind": "xline", "id": "x", "p1": "a", "p2": "d", "construction": true},
    {"kind": "circle", "id": "c", "center": "a", "radius": 1},
    {"kind": "arc", "id": "r", "center": "a", "start": "b", "end": "d"},
    {"kind": "bspline", "id": "s", "degree": 1, "poles": ["a", "b"], "knots": [0, 0, 1, 1]},
    {"kind": "fitSpline", "id": "f", "degree": 1, "fit": ["a", "b"], "params": [0, 1],
     "poles": [[0, 0], [1, 0]], "knots": [0, 0, 1, 1]},
    {"kind": "mirror", "id": "m", "sources": ["ab"], "axis": "x"},
    {"kind": "linearPattern", "id": "lp", "sources": ["ab"],
     "direction1": {"angle": 0, "count": 3, "spacing": 5}},
    {"kind": "circularPattern", "id": "cp", "sources": ["ab"], "center": "d", "count": 4,
     "angle": 3.14159},
    {"kind": "text", "id": "t", "text": "a", "font": "sans", "height": 1, "baseline": "ab",
     "contours": []}
  ])"));
  std::string sources, curves, patterns;
  for (const auto& e : sketch.entities()) {
    if (e->isPatternSource()) sources += e->id().str() + " ";
    if (e->isCurve()) curves += e->id().str() + " ";
    if (e->isPattern()) patterns += e->id().str() + " ";
  }
  EXPECT_EQ(sources, "a b d ab x c r s f ");
  EXPECT_EQ(curves, "ab x c r s f ");
  EXPECT_EQ(patterns, "m lp cp ");
}

TEST(KindNames, AreTheTsKindStrings) {
  EXPECT_EQ(entityKindName(EntityKind::FitSpline), "fitSpline");
  EXPECT_EQ(entityKindName(EntityKind::CircularPattern), "circularPattern");
  EXPECT_EQ(entityKindName(EntityKind::Text), "text");
  EXPECT_EQ(constraintKindName(ConstraintKind::PointOnCurve), "pointOnCurve");
  EXPECT_EQ(constraintKindName(ConstraintKind::PointLineDistance), "pointLineDistance");
  EXPECT_EQ(constraintKindName(ConstraintKind::Offset), "offset");
}

TEST(IsDimension, IsTrueForTheDimensionKindsOnly) {
  const PairConstraint coincident(ConstraintKind::Coincident, SketchConstraintId("c"),
                                  SketchEntityId("a"), SketchEntityId("b"));
  const RadialConstraint diameter(ConstraintKind::Diameter, SketchConstraintId("d"),
                                  SketchEntityId("k"), 2, std::nullopt);
  const OffsetConstraint offset(SketchConstraintId("o"), {}, 1, std::nullopt);
  EXPECT_FALSE(coincident.isDimension());
  EXPECT_TRUE(diameter.isDimension());
  EXPECT_TRUE(offset.isDimension());
}

TEST(Constants, MatchTheTsDomain) {
  EXPECT_EQ(MAX_TEXT_LENGTH, 200);
  EXPECT_EQ(MAX_PATTERN_COUNT, 100);
  EXPECT_EQ(SKETCH_FEATURE_TYPE, "sketch");
  EXPECT_EQ(SKETCH_PARAM_ENTITIES, "entities");
}

// patternParamsValid through parse: a linear and a circular pattern of the line ab.

Json patternBase() {
  return J(R"([
    {"kind": "point", "id": "a", "x": 0, "y": 0},
    {"kind": "point", "id": "b", "x": 1, "y": 0},
    {"kind": "point", "id": "o", "x": 5, "y": 5},
    {"kind": "line", "id": "ab", "p1": "a", "p2": "b"}
  ])");
}

const Json LINEAR = J(R"({"kind": "linearPattern", "id": "lp", "sources": ["ab"],
  "direction1": {"angle": 0, "count": 3, "spacing": 5}})");
const Json CIRCULAR = J(R"({"kind": "circularPattern", "id": "cp", "sources": ["ab"],
  "center": "o", "count": 4, "angle": 3.141592653589793})");

bool patternValid(const Json& pattern) {
  Json entities = patternBase();
  entities.push_back(pattern);
  return issuesOf(entities, Json::array()).empty();
}

TEST(PatternParamsValid, AcceptsValidParameters) {
  EXPECT_TRUE(patternValid(LINEAR));
  EXPECT_TRUE(patternValid(with(LINEAR, J(R"({"direction2": {"angle": -7, "count": 2,
                                                                "spacing": 0.1}})"))));
  EXPECT_TRUE(patternValid(with(CIRCULAR, {{"count", MAX_PATTERN_COUNT}})));
  EXPECT_TRUE(patternValid(with(CIRCULAR, {{"angle", -2 * PI - 1e-10}})));
}

TEST(PatternParamsValid, RejectsABadCountSpacingOrAngleInEitherDirection) {
  const Json d = LINEAR.at("direction1");
  const std::vector<Json> bad = {
      with(d, {{"count", 1}}),        with(d, {{"count", 2.5}}),
      with(d, {{"count", MAX_PATTERN_COUNT + 1}}), with(d, {{"spacing", 0}}),
      with(d, {{"spacing", -1}}),     with(d, {{"spacing", INF}}),
      with(d, {{"angle", NaN}}),
  };
  for (const auto& direction : bad) {
    EXPECT_FALSE(patternValid(with(LINEAR, {{"direction1", direction}}))) << direction.dump();
    EXPECT_FALSE(patternValid(with(LINEAR, {{"direction2", direction}}))) << direction.dump();
  }
}

TEST(PatternParamsValid, RejectsACircularCountOrAngleOutOfRange) {
  for (double count : {1.0, 3.5, double(MAX_PATTERN_COUNT + 1)}) {
    EXPECT_FALSE(patternValid(with(CIRCULAR, {{"count", count}}))) << count;
  }
  for (double angle : {0.0, 2 * PI + 1e-6, NaN, -INF}) {
    EXPECT_FALSE(patternValid(with(CIRCULAR, {{"angle", angle}}))) << angle;
  }
}

// textParamsValid through parse: a text on the line ab without contours.

bool textValid(const std::string& text, const std::string& font, double height) {
  Json entities = patternBase();
  entities.push_back({{"kind", "text"},
                      {"id", "t"},
                      {"text", text},
                      {"font", font},
                      {"height", height},
                      {"baseline", "ab"},
                      {"contours", Json::array()}});
  return issuesOf(entities, Json::array()).empty();
}

std::string repeat(const std::string& s, int n) {
  std::string out;
  for (int i = 0; i < n; ++i) out += s;
  return out;
}

TEST(TextParamsValid, AcceptsAOneLineStringAKnownFontAndAPositiveHeight) {
  EXPECT_TRUE(textValid("Text", "sans", 10));
  EXPECT_TRUE(textValid(repeat("\U0001F600", MAX_TEXT_LENGTH), "mono", 10));
  EXPECT_TRUE(textValid("  ", "serif", 1e-3));
}

TEST(TextParamsValid, Refuses) {
  EXPECT_FALSE(textValid("", "sans", 10)) << "an empty string";
  EXPECT_FALSE(textValid(repeat("x", MAX_TEXT_LENGTH + 1), "sans", 10)) << "too long";
  EXPECT_FALSE(textValid("a\nb", "sans", 10)) << "a line break";
  EXPECT_FALSE(textValid("a\tb", "sans", 10)) << "a tab";
  EXPECT_FALSE(textValid("a\u0085", "sans", 10)) << "a C1 control character";
  EXPECT_FALSE(textValid("Text", "comic", 10)) << "an unknown font";
  EXPECT_FALSE(textValid("Text", "sans", 0)) << "height zero";
  EXPECT_FALSE(textValid("Text", "sans", -1)) << "height negative";
  EXPECT_FALSE(textValid("Text", "sans", INF)) << "height infinite";
  EXPECT_FALSE(textValid("Text", "sans", NaN)) << "height NaN";
}

TEST(FindEntity, FindsEntitiesAndPointsById) {
  const Sketch sketch = sketchOf(J(R"([
    {"kind": "point", "id": "o", "x": 1, "y": 2},
    {"kind": "point", "id": "s", "x": 4, "y": 2},
    {"kind": "point", "id": "e", "x": 1, "y": 5},
    {"kind": "line", "id": "l", "p1": "s", "p2": "e"},
    {"kind": "circle", "id": "k", "center": "o", "radius": 7}
  ])"));
  ASSERT_NE(sketch.findPoint(SketchEntityId("s")), nullptr);
  EXPECT_EQ(sketch.findPoint(SketchEntityId("s")), sketch.entities()[1].get());
  EXPECT_EQ(sketch.findPoint(SketchEntityId("s"))->x, 4);
  EXPECT_EQ(sketch.findPoint(SketchEntityId("l")), nullptr);
  EXPECT_EQ(sketch.findPoint(SketchEntityId("zz")), nullptr);
  ASSERT_NE(sketch.findEntity(SketchEntityId("k")), nullptr);
  EXPECT_EQ(sketch.findEntity(SketchEntityId("k"))->kind(), EntityKind::Circle);
  EXPECT_EQ(sketch.findEntity(SketchEntityId("zz")), nullptr);
}

}  // namespace
}  // namespace tinycad::sketch
