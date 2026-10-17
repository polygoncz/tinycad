// SketchBuilder (port of the sketchBuilder part of test/unit/features/sketch/sketch.test.ts) over
// OcctKernel with the counting decorator (N45): the regions of the kernel and one face per region,
// the artifact with the plane, the entities, the pattern copies and the lines for resolveAxis.

#include <numbers>

#include "features/builder_testing.hpp"
#include "tinycad/core/result.hpp"

namespace tinycad::features::test {
namespace {

using Strings = std::vector<std::string>;

/** The rectangle 10 × 5 from [0, 0] of rectangleData: points a b c d, lines ab bc cd da. */
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

Json appended(Json base, const Json& more) {
  for (const auto& item : more) base.push_back(item);
  return base;
}

/** The rectangle with a circle k of radius 2 at [5, 2.5] inside it. */
Json rectangleWithCircle() {
  return appended(RECTANGLE, Json::parse(R"([
    {"kind": "point", "id": "o", "x": 5, "y": 2.5},
    {"kind": "circle", "id": "k", "center": "o", "radius": 2}
  ])"));
}

/** A closed bow tie: the lines ab and cd cross each other. */
const Json BOW_TIE = Json::parse(R"([
  {"kind": "point", "id": "a", "x": 0, "y": 0},
  {"kind": "point", "id": "b", "x": 10, "y": 10},
  {"kind": "point", "id": "c", "x": 10, "y": 0},
  {"kind": "point", "id": "d", "x": 0, "y": 10},
  {"kind": "line", "id": "ab", "p1": "a", "p2": "b"},
  {"kind": "line", "id": "bc", "p1": "b", "p2": "c"},
  {"kind": "line", "id": "cd", "p1": "c", "p2": "d"},
  {"kind": "line", "id": "da", "p1": "d", "p2": "a"}
])");

Json planeRef(const std::string& id) { return {{"kind", "plane"}, {"plane", id}}; }

Json sketchParams(const Json& entities, const Json& plane = planeRef("origin/plane:xy"),
                  const Json& constraints = Json::array()) {
  return {{"plane", Json::array({plane})}, {"entities", entities}, {"constraints", constraints}};
}

/** The sketch artifact of the feature `id` in the state; throws when there is none. */
regen::SketchArtifactPtr sketchAt(const regen::RegenState& state, const std::string& id) {
  const auto a = state.find(id + "/sketch");
  if (a == nullptr || a->kind() != regen::ArtifactKind::Sketch) {
    throw std::runtime_error("no sketch " + id);
  }
  return std::static_pointer_cast<const regen::SketchArtifact>(a);
}

Strings regionNames(const regen::SketchArtifact& sketch) {
  Strings out;
  for (const auto& r : sketch.regions) out.push_back(r.name);
  return out;
}

void expectPlane(const core::Plane& actual, const core::Plane& expected) {
  expectVec(actual.origin, expected.origin);
  expectVec(actual.xDir, expected.xDir);
  expectVec(actual.normal, expected.normal);
}

TEST(SketchBuilder, ARectangleGivesOneFaceAndTheArtifactSketchIdOnThePlaneXy) {
  CountingKernel kernel;
  const auto out = build(kernel, "sketch", "s1", sketchParams(RECTANGLE));
  const auto sketch = sketchAt(*out.ok().state, "s1");
  EXPECT_EQ(sketch->id(), "s1/sketch");
  EXPECT_EQ(sketch->owner().str(), "s1");
  expectPlane(sketch->plane, {{0, 0, 0}, {1, 0, 0}, {0, 0, 1}});
  EXPECT_EQ(*sketch->entities, RECTANGLE);
  EXPECT_EQ(*sketch->derivedEntities, Json::array());
  EXPECT_EQ(regionNames(*sketch), Strings{"ab,bc,cd,da"});
  EXPECT_EQ(kernel.calls("profileRegions"), 1);
  EXPECT_EQ(kernel.calls("makeFace"), 1);
  EXPECT_EQ(out.owned.size(), 1U);
  EXPECT_TRUE(out.ok().anchors.empty());
  EXPECT_FALSE(out.warnings.has_value());
}

TEST(SketchBuilder, CarriesTheOutlinesOfTheKernelInTheOrderAndWithTheNamesOfTheRegions) {
  CountingKernel kernel;
  const auto out = build(kernel, "sketch", "s1", sketchParams(rectangleWithCircle()));
  const auto sketch = sketchAt(*out.ok().state, "s1");
  // The rectangle with the circle as a hole, then the disc.
  EXPECT_EQ(regionNames(*sketch), (Strings{"ab,bc,cd,da,k", "k"}));
  ASSERT_EQ(sketch->outlines.size(), 2U);
  EXPECT_EQ(sketch->outlines[0].name, "ab,bc,cd,da,k");
  EXPECT_EQ(sketch->outlines[0].outer.size(), 4U);
  ASSERT_EQ(sketch->outlines[0].holes.size(), 1U);
  EXPECT_EQ(sketch->outlines[0].holes[0].at(0).id, "k");
  EXPECT_NEAR(sketch->outlines[0].area, 50 - 4 * std::numbers::pi, 1e-6);
  EXPECT_EQ(sketch->outlines[1].name, "k");
  EXPECT_NEAR(sketch->outlines[1].area, 4 * std::numbers::pi, 1e-6);
  EXPECT_EQ(kernel.calls("makeFace"), 2);
  // regions and outlines share order and names.
  for (std::size_t i = 0; i < 2; ++i) {
    EXPECT_EQ(sketch->regions[i].face, *sketch->regionFace(sketch->outlines[i].name));
  }
}

TEST(SketchBuilder, AsksTheKernelForTheRegionsOfTheRegionCurvesOnly) {
  CountingKernel kernel;
  // A construction diagonal bounds no region.
  const Json entities = appended(
      RECTANGLE, Json::parse(R"([{"kind": "line", "id": "ac", "p1": "a", "p2": "c",
                                  "construction": true}])"));
  const auto out = build(kernel, "sketch", "s1", sketchParams(entities));
  EXPECT_EQ(regionNames(*sketchAt(*out.ok().state, "s1")), Strings{"ab,bc,cd,da"});
  EXPECT_EQ(kernel.calls("profileRegions"), 1);
}

TEST(SketchBuilder, ACircleAloneIsOneRegion) {
  CountingKernel kernel;
  const Json entities = Json::parse(R"([
    {"kind": "point", "id": "o", "x": 0, "y": 0},
    {"kind": "circle", "id": "k", "center": "o", "radius": 3}
  ])");
  const auto out = build(kernel, "sketch", "s1", sketchParams(entities));
  EXPECT_EQ(regionNames(*sketchAt(*out.ok().state, "s1")), Strings{"k"});
}

TEST(SketchBuilder, CrossingCurvesGiveAWarningNoFaceAndAnArtifactWithoutRegions) {
  CountingKernel kernel;
  const auto out = build(kernel, "sketch", "s1", sketchParams(BOW_TIE));
  EXPECT_EQ(out.warnings, std::optional<std::string>("Sketch curves cross each other; no regions"));
  const auto sketch = sketchAt(*out.ok().state, "s1");
  EXPECT_TRUE(sketch->regions.empty());
  EXPECT_TRUE(sketch->outlines.empty());
  EXPECT_EQ(kernel.calls("profileRegions"), 1);
  EXPECT_EQ(kernel.calls("makeFace"), 0);
}

TEST(SketchBuilder, AnEmptySketchIsAnArtifactWithNoRegionsAndNoWarning) {
  CountingKernel kernel;
  const auto out = build(kernel, "sketch", "s1", sketchParams(Json::array()));
  EXPECT_FALSE(out.warnings.has_value());
  EXPECT_TRUE(sketchAt(*out.ok().state, "s1")->regions.empty());
  EXPECT_EQ(kernel.calls("makeFace"), 0);
}

TEST(SketchBuilder, ASketchOnThePlaneXzCarriesThatPlane) {
  CountingKernel kernel;
  const auto out =
      build(kernel, "sketch", "s1", sketchParams(RECTANGLE, planeRef("origin/plane:xz")));
  expectPlane(sketchAt(*out.ok().state, "s1")->plane, {{0, 0, 0}, {1, 0, 0}, {0, -1, 0}});
}

TEST(SketchBuilder, ASketchOnAPlanarBodyFaceTakesThePlaneOfTheFace) {
  CountingKernel kernel;
  const auto state = withBox(kernel, "b1", {0, 0, 0}, {20, 20, 3});
  const auto out = build(kernel, "sketch", "s1",
                         sketchParams(RECTANGLE, topoRef("b1", "b1/face:top")), state);
  const auto sketch = sketchAt(*out.ok().state, "s1");
  expectVec(sketch->plane.normal, {0, 0, 1});
  EXPECT_NEAR(sketch->plane.origin[2], 3, 1e-9);
  EXPECT_EQ(regionNames(*sketch), Strings{"ab,bc,cd,da"});
}

TEST(SketchBuilder, AnUnknownPlaneGivesUnresolvedReferenceAtPlaneAndCallsNoKernelOp) {
  CountingKernel kernel;
  const auto out =
      build(kernel, "sketch", "s1", sketchParams(RECTANGLE, planeRef("origin/plane:ab")));
  EXPECT_EQ(out.error().code, regen::FeatureErrorCode::UnresolvedReference);
  ASSERT_EQ(out.error().issues.size(), 1U);
  EXPECT_EQ(out.error().issues[0].param, "plane");
  EXPECT_EQ(out.error().issues[0].code, "param.unresolvedRef");
  EXPECT_EQ(kernel.modelingCalls(), 0);
}

TEST(SketchBuilder, InvalidSketchDataIsAProgramError) {
  CountingKernel kernel;
  // A line from a point to itself, the point missing: the validation would reject it.
  const Json entities = Json::parse(R"([{"kind": "line", "id": "l", "p1": "x", "p2": "x"}])");
  EXPECT_THROW(build(kernel, "sketch", "s1", sketchParams(entities)), core::AssertionError);
}

TEST(SketchBuilder, AKernelErrorOfProfileRegionsIsKernelAndMakesNoFace) {
  CountingKernel kernel;
  kernel.failNext("profileRegions", {kernel::KernelErrorCode::InvalidInput, "bad"});
  const auto out = build(kernel, "sketch", "s1", sketchParams(RECTANGLE));
  EXPECT_EQ(out.error().code, regen::FeatureErrorCode::Kernel);
  EXPECT_EQ(out.error().issues.at(0).code, "kernel.invalidInput");
  EXPECT_EQ(kernel.calls("makeFace"), 0);
}

TEST(SketchBuilder, AKernelErrorOfMakeFaceIsKernel) {
  CountingKernel kernel;
  kernel.failNext("makeFace", {kernel::KernelErrorCode::OperationFailed, "boom"});
  const auto out = build(kernel, "sketch", "s1", sketchParams(RECTANGLE));
  EXPECT_EQ(out.error().code, regen::FeatureErrorCode::Kernel);
  EXPECT_EQ(out.error().issues.at(0).code, "kernel.operationFailed");
}

TEST(SketchBuilder, KeepsTheInputStateAsItIsAndAddsTheSketchAtTheEnd) {
  CountingKernel kernel;
  const auto input = regen::RegenState::empty();
  const auto before = idsOf(*input);
  const auto out = build(kernel, "sketch", "s1", sketchParams(RECTANGLE), input);
  EXPECT_EQ(idsOf(*input), before);
  EXPECT_EQ(idsOf(*out.ok().state), withOrigin({"s1/sketch"}));
}

TEST(SketchBuilder, CarriesEveryLineWithItsPointsForTheRevolveAxisConstructionLinesToo) {
  CountingKernel kernel;
  const Json entities = appended(
      RECTANGLE, Json::parse(R"([
        {"kind": "point", "id": "p", "x": -1, "y": 0},
        {"kind": "point", "id": "q", "x": -1, "y": 7},
        {"kind": "line", "id": "axis", "p1": "p", "p2": "q", "construction": true}
      ])"));
  const auto out = build(kernel, "sketch", "s1", sketchParams(entities));
  const auto& lines = sketchAt(*out.ok().state, "s1")->lines;
  Strings ids;
  for (const auto& l : lines) ids.push_back(l.id);
  EXPECT_EQ(ids, (Strings{"ab", "bc", "cd", "da", "axis"}));
  EXPECT_EQ(lines[1].p1, (core::Vec2{10, 0}));
  EXPECT_EQ(lines[1].p2, (core::Vec2{10, 5}));
  EXPECT_EQ(lines[4].p1, (core::Vec2{-1, 0}));
  EXPECT_EQ(lines[4].p2, (core::Vec2{-1, 7}));
}

TEST(SketchBuilder, CarriesThePatternCopiesAsDerivedEntitiesAndTheirRegions) {
  CountingKernel kernel;
  const Json entities = Json::parse(R"([
    {"kind": "point", "id": "o", "x": 0, "y": 0},
    {"kind": "circle", "id": "k", "center": "o", "radius": 1},
    {"kind": "linearPattern", "id": "lp", "sources": ["k"],
     "direction1": {"angle": 0, "count": 2, "spacing": 5}}
  ])");
  const auto out = build(kernel, "sketch", "s1", sketchParams(entities));
  const auto sketch = sketchAt(*out.ok().state, "s1");
  EXPECT_EQ(*sketch->entities, entities);
  EXPECT_EQ(*sketch->derivedEntities, Json::parse(R"([
    {"kind": "point", "id": "lp:1.o", "x": 5, "y": 0},
    {"kind": "circle", "id": "lp:1.k", "center": "lp:1.o", "radius": 1}
  ])"));
  EXPECT_EQ(regionNames(*sketch), (Strings{"k", "lp:1.k"}));
}

}  // namespace
}  // namespace tinycad::features::test
