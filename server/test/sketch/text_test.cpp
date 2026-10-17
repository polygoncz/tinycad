// Port of test/unit/sketch/text.test.ts: the letter curves of texts (textCurves) and derivedOwner
// (spec 12 "Text ve skice (M37)").

#include <gtest/gtest.h>

#include <cmath>
#include <set>
#include <string>
#include <vector>

#include "testing.hpp"

namespace tinycad::sketch {
namespace {

using namespace testing;
using Ids = std::vector<std::string>;

/** A unit square loop of character 0 ('a') from [0, 0], lines only. */
const Json SQUARE = J(R"({"char": 0, "code": 97, "segments": [[[0, 0], [1, 0]], [[1, 0], [1, 1]],
                                                              [[1, 1], [0, 1]], [[0, 1], [0, 0]]]})");
/** One loop of a quadratic and a cubic Bézier segment. */
const Json CURVED = J(R"({"char": 0, "code": 97, "segments": [[[0, 0], [1, 2], [2, 0]],
                                                              [[2, 0], [2, -1], [0.5, -3], [0, 0]]]})");

std::vector<Curve2> curvesOf(const TextOptions& options) {
  return sketchOf(textEntities(options)).textCurves();
}

TextOptions square(Vec2 p1, Vec2 p2) {
  TextOptions o;
  o.text = "a";
  o.contours = Json::array({SQUARE});
  o.p1 = p1;
  o.p2 = p2;
  return o;
}

void expectClose(const Vec2& a, const Vec2& b) {
  EXPECT_NEAR(a[0], b[0], 1e-12);
  EXPECT_NEAR(a[1], b[1], 1e-12);
}

Ids ids(const std::vector<Curve2>& curves) {
  Ids out;
  for (const auto& c : curves) out.push_back(c.id);
  return out;
}

TEST(TextCurves, PlacesTheOutlinesAtP1AlongAHorizontalBaseline) {
  const auto curves = curvesOf(square({5, 7}, {20, 7}));
  ASSERT_EQ(curves.size(), 4U);
  for (const auto& c : curves) EXPECT_EQ(c.kind, Curve2::Kind::Line);
  EXPECT_EQ(curves[0].from, (Vec2{5, 7}));
  EXPECT_EQ(curves[0].to, (Vec2{6, 7}));
  EXPECT_EQ(curves[1].to, (Vec2{6, 8}));
}

TEST(TextCurves, TurnsTheOutlinesWithTheBaselineXAlongP1P2YToTheLeft) {
  // Baseline up the y axis: local x → +y, local y → −x.
  const auto curves = curvesOf(square({1, 1}, {1, 4}));
  expectClose(curves[0].from, {1, 1});
  expectClose(curves[0].to, {1, 2});
  expectClose(curves[1].to, {0, 2});
}

TEST(TextCurves, TurnsByAnObliqueBaselineItsLengthDoesNotMatter) {
  const double a = 0.3;
  const auto at = [a](double x, double y) -> Vec2 {
    return {2 + x * std::cos(a) - y * std::sin(a), -1 + x * std::sin(a) + y * std::cos(a)};
  };
  for (double length : {0.001, 50.0}) {
    const auto curves =
        curvesOf(square({2, -1}, {2 + length * std::cos(a), -1 + length * std::sin(a)}));
    expectClose(curves[1].from, at(1, 0));
    expectClose(curves[2].from, at(1, 1));
  }
}

TEST(TextCurves, GivesNoCurvesForAZeroLengthBaseline) {
  EXPECT_TRUE(curvesOf(square({3, 3}, {3, 3})).empty());
}

TEST(TextCurves, TurnsBezierSegmentsIntoClampedBSplines) {
  TextOptions o = square({10, 0}, {10, 10});
  o.contours = Json::array({CURVED});
  const auto curves = curvesOf(o);
  ASSERT_EQ(curves.size(), 2U);
  const Curve2& quad = curves[0];
  const Curve2& cubic = curves[1];
  ASSERT_EQ(quad.kind, Curve2::Kind::BSpline);
  EXPECT_EQ(quad.degree, 2);
  EXPECT_EQ(quad.knots, (std::vector<double>{0, 0, 0, 1, 1, 1}));
  EXPECT_EQ(cubic.degree, 3);
  EXPECT_EQ(cubic.knots, (std::vector<double>{0, 0, 0, 0, 1, 1, 1, 1}));
  // Baseline up: local [x, y] → [10 − y, x]; the poles are the placed Bézier poles.
  ASSERT_EQ(quad.poles.size(), 3U);
  expectClose(quad.poles[1], {8, 1});
  ASSERT_EQ(cubic.poles.size(), 4U);
  expectClose(cubic.poles[2], {13, 0.5});
}

TEST(TextCurves, GivesDerivedIdsTextCharCodeLoopSegment) {
  TextOptions o;
  o.id = "tx";
  o.text = "a c";
  EXPECT_EQ(ids(curvesOf(o)), (Ids{"tx:0-97.0.0", "tx:0-97.0.1", "tx:0-97.0.2", "tx:0-97.0.3",
                                   "tx:2-99.0.0", "tx:2-99.0.1", "tx:2-99.0.2", "tx:2-99.0.3"}));
}

TEST(TextCurves, NumbersTheLoopsWithinOneCharacter) {
  TextOptions o;
  o.text = "ab";
  o.contours = Json::array({SQUARE, with(SQUARE, {{"char", 1}, {"code", 98}}), SQUARE});
  Ids firstSegments;
  for (const auto& id : ids(curvesOf(o))) {
    if (id.ends_with(".0")) firstSegments.push_back(id);
  }
  EXPECT_EQ(firstSegments, (Ids{"t:0-97.0.0", "t:1-98.0.0", "t:0-97.1.0"}));
}

TEST(TextCurves, KeepsTheIdsOfOtherCharactersWhenOneCharacterChanges) {
  TextOptions before;
  before.text = "abc";
  TextOptions after;
  after.text = "axc";
  const Ids a = ids(curvesOf(before));
  const std::set<std::string> b = [&] {
    const Ids x = ids(curvesOf(after));
    return std::set<std::string>(x.begin(), x.end());
  }();
  Ids common;
  for (const auto& id : a) {
    if (b.contains(id)) common.push_back(id);
  }
  EXPECT_EQ(common, (Ids{"t:0-97.0.0", "t:0-97.0.1", "t:0-97.0.2", "t:0-97.0.3", "t:2-99.0.0",
                         "t:2-99.0.1", "t:2-99.0.2", "t:2-99.0.3"}));
}

TEST(TextCurves, KeepsTheIdsWhenTheBaselineMovesOrTurns) {
  TextOptions a;
  a.p1 = {1, 2};
  a.p2 = {5, 9};
  TextOptions b = a;
  b.p2 = {11, 2};
  EXPECT_EQ(ids(curvesOf(a)), ids(curvesOf(b)));
}

TEST(TextCurves, IncludesConstructionTextsAndAllTextsInEntityOrder) {
  TextOptions one;
  one.id = "u";
  one.text = "a";
  one.construction = true;
  TextOptions two;
  two.id = "v";
  two.text = "b";
  const auto curves = sketchOf(appended(textEntities(one), textEntities(two))).textCurves();
  Ids prefixes;
  for (const auto& id : ids(curves)) prefixes.push_back(id.substr(0, id.find('.')));
  EXPECT_EQ(prefixes, (Ids{"u:0-97", "u:0-97", "u:0-97", "u:0-97", "v:0-98", "v:0-98", "v:0-98",
                           "v:0-98"}));
}

TEST(TextCurves, LaysTheTextAlongAnXlineFromItsP1) {
  Json entities = textEntities(square({5, 7}, {20, 7}));
  entities[2] = J(R"({"kind": "xline", "id": "t.bl", "p1": "t.p1", "p2": "t.p2",
                      "construction": true})");
  const auto curves = sketchOf(entities).textCurves();
  ASSERT_EQ(curves.size(), 4U);
  EXPECT_EQ(curves[0].from, (Vec2{5, 7}));
  EXPECT_EQ(curves[0].to, (Vec2{6, 7}));
}

TEST(DerivedOwner, ReturnsTheTextOfALetterCurve) {
  EXPECT_EQ(derivedOwner("t:0-97.0.0"), SketchEntityId("t"));
  EXPECT_EQ(derivedOwner("Ab3:12-353.2.17"), SketchEntityId("Ab3"));
}

TEST(DerivedOwner, ReadsALetterIdAsALetterEvenThoughTheCopyGrammarAcceptsIt) {
  EXPECT_EQ(patternOfCopy("t:0-97.0.0"), SketchEntityId("t"));
  EXPECT_EQ(derivedOwner("t:0-97.0.0"), SketchEntityId("t"));
  EXPECT_EQ(derivedOwner("t:0-97.0"), SketchEntityId("t"));
}

TEST(DerivedOwner, ReturnsThePatternOfACopy) {
  EXPECT_EQ(derivedOwner("lp:1-2.345"), SketchEntityId("lp"));
  EXPECT_EQ(derivedOwner("m:1.ab"), SketchEntityId("m"));
  EXPECT_EQ(derivedOwner("lp:1-0.a"), SketchEntityId("lp"));
}

TEST(DerivedOwner, ReturnsNulloptForOtherIds) {
  for (const char* id :
       {"ab", ":0-97.0.0", "t:a-97.0.0", "t,u:0-97.0.0", "__poles:ab", "t:0-97.0.0:1"}) {
    EXPECT_EQ(derivedOwner(id), std::nullopt) << id;
  }
}

}  // namespace
}  // namespace tinycad::sketch
