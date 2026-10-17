// The JSON round trip of the sketch model (decision N23): JSON → Sketch → JSON keeps every field of
// the TS shape, for the inputs of all shared cases sketch.* and for the optional fields.

#include <gtest/gtest.h>

#include "support/shared_cases.hpp"
#include "testing.hpp"

namespace tinycad::sketch {
namespace {

using namespace testing;

TEST(SketchJson, RoundTripsTheInputsOfAllSharedSketchCases) {
  const auto names = tinycad::testing::caseNames("sketch");
  ASSERT_FALSE(names.empty());
  for (const auto& name : names) {
    const Json input = tinycad::testing::loadCase("sketch", name).at("input");
    const auto parsed = Sketch::parse(input.at("entities"), input.at("constraints"));
    ASSERT_TRUE(parsed.has_value()) << name;
    EXPECT_EQ(parsed->entitiesJson(), input.at("entities")) << name;
    EXPECT_EQ(parsed->constraintsJson(), input.at("constraints")) << name;
  }
}

TEST(SketchJson, KeepsTheOptionalFieldsOnlyWhenSet) {
  const Json entities = J(R"([
    {"kind": "point", "id": "a", "x": 0, "y": 0},
    {"kind": "point", "id": "b", "x": 10.5, "y": -0.25},
    {"kind": "point", "id": "c", "x": 0, "y": 10},
    {"kind": "line", "id": "ab", "p1": "a", "p2": "b", "construction": true},
    {"kind": "line", "id": "ac", "p1": "a", "p2": "c"},
    {"kind": "circle", "id": "k", "center": "a", "radius": 2, "construction": true},
    {"kind": "xline", "id": "x", "p1": "a", "p2": "c", "construction": true},
    {"kind": "linearPattern", "id": "lp", "sources": ["k"],
     "direction1": {"angle": 0, "count": 3, "spacing": 5},
     "direction2": {"angle": 1.5, "count": 2, "spacing": 0.5}},
    {"kind": "linearPattern", "id": "lp2", "sources": ["k"],
     "direction1": {"angle": 0, "count": 3, "spacing": 5}}
  ])");
  const Json constraints = J(R"([
    {"kind": "angle", "id": "g", "a": "ab", "b": "ac", "value": 1, "reverseA": true,
     "placement": {"kind": "angular", "radius": 4, "t": 0.5}},
    {"kind": "angle", "id": "g2", "a": "ab", "b": "ac", "value": 1, "reverseB": true},
    {"kind": "distance", "id": "d", "a": "a", "b": "b", "value": 5,
     "placement": {"kind": "linear", "offset": -3, "along": 2.5}},
    {"kind": "radius", "id": "r", "curve": "k", "value": 2,
     "placement": {"kind": "radial", "angle": -1, "distance": 7}},
    {"kind": "diameter", "id": "r2", "curve": "k", "value": 4}
  ])");
  const Sketch sketch = sketchOf(entities, constraints);
  EXPECT_EQ(sketch.entitiesJson(), entities);
  EXPECT_EQ(sketch.constraintsJson(), constraints);
  EXPECT_FALSE(sketch.entitiesJson()[4].contains("construction"));
  EXPECT_FALSE(sketch.entitiesJson()[8].contains("direction2"));
  EXPECT_FALSE(sketch.constraintsJson()[1].contains("reverseA"));
  EXPECT_FALSE(sketch.constraintsJson()[4].contains("placement"));
}

TEST(SketchJson, WritesIntegralNumbersAsIntegers) {
  const Sketch sketch = sketchOf(J(R"([{"kind": "point", "id": "a", "x": 2.0, "y": 0.5}])"));
  EXPECT_EQ(sketch.entitiesJson().dump(), R"([{"id":"a","kind":"point","x":2,"y":0.5}])");
}

TEST(SketchJson, KeepsAUtf8TextAndTheCharOfItsContours) {
  // "😀ž": 'ž' (U+017E) is the character 1 in code points.
  const Json entities = J(R"([
    {"kind": "point", "id": "a", "x": 0, "y": 0},
    {"kind": "point", "id": "b", "x": 10, "y": 0},
    {"kind": "line", "id": "ab", "p1": "a", "p2": "b"},
    {"kind": "text", "id": "t", "text": "😀ž", "font": "mono", "height": 3,
     "baseline": "ab", "construction": true,
     "contours": [{"char": 1, "code": 382,
                   "segments": [[[0, 0], [1, 0]], [[1, 0], [0.5, 1], [0, 0]]]}]}
  ])");
  const Sketch sketch = sketchOf(entities);
  EXPECT_EQ(sketch.entitiesJson(), entities);
  const auto& text = sketch.entities()[3]->as<SketchText>();
  EXPECT_EQ(text.text, "\U0001F600ž");
  EXPECT_EQ(text.font, TextFont::Mono);
  ASSERT_EQ(text.contours.size(), 1U);
  EXPECT_EQ(text.contours[0].charIndex, 1);
  EXPECT_EQ(text.contours[0].code, 0x17E);
  EXPECT_EQ(text.contours[0].segments[1].size(), 3U);
  EXPECT_EQ(sketch.entitiesJson()[3].at("contours")[0].at("char"), 1);
}

TEST(SketchJson, EntityAndConstraintJsonOfObjectsMadeInCode) {
  const SketchArc arc(SketchEntityId("q"), SketchEntityId("o"), SketchEntityId("s"),
                      SketchEntityId("e"), false);
  EXPECT_EQ(entityJson(arc), J(R"({"kind": "arc", "id": "q", "center": "o", "start": "s",
                                  "end": "e"})"));
  const OffsetConstraint offset(SketchConstraintId("f"),
                                {{SketchEntityId("l"), SketchEntityId("l2")}}, 2, std::nullopt);
  EXPECT_EQ(constraintJson(offset), J(R"({"kind": "offset", "id": "f",
                                         "pairs": [{"source": "l", "copy": "l2"}], "value": 2})"));
}

}  // namespace
}  // namespace tinycad::sketch
