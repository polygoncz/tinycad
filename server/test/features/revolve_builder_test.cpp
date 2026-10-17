// RevolveBuilder (the builder part of test/unit/features/revolve/revolve.test.ts) without the
// sketch builder (N46): a rectangle on XZ as the region face of aSketchArtifact.

#include <numbers>

#include "features/builder_testing.hpp"

namespace tinycad::features::test {
namespace {

using regen::test::aSketchArtifact;

const core::Plane kXz{{0, 0, 0}, {1, 0, 0}, {0, -1, 0}};
constexpr double kTurn = 2 * std::numbers::pi;

/** A sketch s1 on XZ: region r1 = [0,10]² (world x and z), a construction line c on the Z axis, a circle k. */
regen::StatePtr sketchState(CountingKernel& kernel,
                            regen::StatePtr state = regen::RegenState::empty()) {
  const std::vector<core::Vec2> c{{0, 0}, {10, 0}, {10, 10}, {0, 10}};
  kernel::ProfileLoop outer;
  for (std::size_t i = 0; i < 4; ++i) outer.push_back(core::Curve2::line(c[i], c[(i + 1) % 4]));
  auto face = kernel.occt().makeFace({kXz, outer, {}});
  if (!face) throw std::runtime_error(face.error().message);
  const Json entities = Json::array({{{"id", "c"}, {"kind", "line"}}, {{"id", "k"}, {"kind", "circle"}}});
  return state->with(aSketchArtifact("s1", {face->shape}, kXz,
                                     {regen::SketchLineSegment{"c", {0, 0}, {0, 5}}}, entities));
}

struct RevolveParams {
  std::vector<std::string> regions{"r1"};
  Json axis = {{"kind", "axis"}, {"axis", "origin/axis:z"}};
  std::string operation = "new";
  std::vector<std::string> targets;
  double angle = kTurn;
  bool flip = false;

  [[nodiscard]] Json json() const {
    Json r = Json::array();
    for (const auto& name : regions) r.push_back({{"kind", "region"}, {"sketch", "s1"}, {"region", name}});
    Json t = Json::array();
    for (const auto& id : targets) t.push_back(bodyRef(id));
    return {{"regions", r}, {"axis", axis},   {"operation", operation},
            {"targets", t}, {"angle", angle}, {"flip", flip}};
  }
};

Json entityAxis(const std::string& sketch, const std::string& entity) {
  return {{"kind", "sketchEntity"}, {"sketch", sketch}, {"entity", entity}};
}

kernel::BoundingBox boxOf(CountingKernel& kernel, const RevolveParams& p) {
  const auto out = build(kernel, "revolve", "rv", p.json(), sketchState(kernel));
  return bboxOf(kernel, *bodyAt(*out.ok().state, "rv/body"));
}

TEST(RevolveBuilder, TurnsTheRectangleOnXzAboutTheAxisZByAFullTurnIntoANewBody) {
  CountingKernel kernel;
  const auto out = build(kernel, "revolve", "rv", RevolveParams{}.json(), sketchState(kernel));
  const auto body = bodyAt(*out.ok().state, "rv/body");
  EXPECT_EQ(body->origin().str(), "rv");
  EXPECT_EQ(body->lastModifiedBy().str(), "rv");
  const auto box = bboxOf(kernel, *body);
  expectVec(box.min, {-10, -10, 0}, 1e-5);
  expectVec(box.max, {10, 10, 10}, 1e-5);
  EXPECT_EQ(kernel.calls("revolve"), 1);
  EXPECT_TRUE(out.ok().anchors.empty());
}

TEST(RevolveBuilder, ByAQuarterTurnSweepsTheFirstQuadrantAndWithFlipTheOtherWay) {
  CountingKernel kernel;
  RevolveParams p;
  p.angle = kTurn / 4;
  auto box = boxOf(kernel, p);
  expectVec(box.min, {0, 0, 0}, 1e-5);
  expectVec(box.max, {10, 10, 10}, 1e-5);
  p.flip = true;
  box = boxOf(kernel, p);
  expectVec(box.min, {0, -10, 0}, 1e-5);
  expectVec(box.max, {10, 0, 10}, 1e-5);
}

TEST(RevolveBuilder, IgnoresAHiddenFlipAtAFullTurn) {
  CountingKernel kernel;
  RevolveParams p;
  p.flip = true;
  const auto box = boxOf(kernel, p);
  expectVec(box.min, {-10, -10, 0}, 1e-5);
}

TEST(RevolveBuilder, TakesTheAxisFromAConstructionLineOfASketch) {
  CountingKernel kernel;
  RevolveParams p;
  p.axis = entityAxis("s1", "c");
  p.angle = kTurn / 4;
  const auto box = boxOf(kernel, p);
  expectVec(box.min, {0, 0, 0}, 1e-5);
  expectVec(box.max, {10, 10, 10}, 1e-5);
}

TEST(RevolveBuilder, UnresolvedAxisRegionAndTargetGiveUnresolvedReferenceWithoutRevolving) {
  CountingKernel kernel;
  const auto state = sketchState(kernel);
  const auto paramOf = [&](const RevolveParams& p) {
    const auto out = build(kernel, "revolve", "rv", p.json(), state);
    EXPECT_EQ(out.error().code, regen::FeatureErrorCode::UnresolvedReference);
    return out.error().issues.at(0).param;
  };
  RevolveParams circle;
  circle.axis = entityAxis("s1", "k");
  EXPECT_EQ(paramOf(circle), "axis");
  RevolveParams noSketch;
  noSketch.axis = entityAxis("s9", "c");
  EXPECT_EQ(paramOf(noSketch), "axis");
  RevolveParams region;
  region.regions = {"r9"};
  EXPECT_EQ(paramOf(region), "regions");
  RevolveParams target;
  target.operation = "remove";
  target.targets = {"x"};
  EXPECT_EQ(paramOf(target), "targets");
  EXPECT_EQ(kernel.calls("revolve"), 0);
}

TEST(RevolveBuilder, RemoveCutsTheTargetWhichKeepsItsIdentity) {
  CountingKernel kernel;
  const auto state = sketchState(kernel, withBox(kernel, "b1", {-20, -20, 0}, {40, 40, 5}));
  RevolveParams p;
  p.operation = "remove";
  p.targets = {"b1"};
  const auto out = build(kernel, "revolve", "rv", p.json(), state);
  EXPECT_EQ(idsOf(*out.ok().state), withOrigin({"b1/body", "s1/sketch"}));
  const auto body = bodyAt(*out.ok().state, "b1/body");
  EXPECT_EQ(body->lastModifiedBy().str(), "rv");
  EXPECT_EQ(kernel.calls("boolean"), 1);
}

}  // namespace
}  // namespace tinycad::features::test
