// ExtrudeBuilder (the builder part of test/unit/features/extrude/extrude.test.ts) without the
// sketch builder (N46): the state holds aSketchArtifact with region faces made by makeFace.

#include <cmath>

#include "features/builder_testing.hpp"

namespace tinycad::features::test {
namespace {

using regen::test::aSketchArtifact;

const core::Plane kXy{{0, 0, 0}, {1, 0, 0}, {0, 0, 1}};

/** The rectangle [x0, x0 + w] × [y0, y0 + h] of a plane as a face of the kernel. */
kernel::ShapeHandle rectangle(CountingKernel& kernel, const core::Plane& plane, double x0, double y0,
                              double w, double h) {
  const std::vector<core::Vec2> c{{x0, y0}, {x0 + w, y0}, {x0 + w, y0 + h}, {x0, y0 + h}};
  kernel::ProfileLoop outer;
  for (std::size_t i = 0; i < 4; ++i) {
    outer.push_back(core::Curve2::line(c[i], c[(i + 1) % 4], "l" + std::to_string(i + 1)));
  }
  auto face = kernel.occt().makeFace({plane, outer, {}});
  if (!face) throw std::runtime_error(face.error().message);
  return face->shape;
}

struct ExtrudeParams {
  std::vector<std::string> regions{"r1"};
  std::string operation = "new";
  std::vector<std::string> targets;
  std::string endType = "blind";
  double distance = 10;
  std::vector<Json> upTo;
  bool flip = false;

  [[nodiscard]] Json json() const {
    Json r = Json::array();
    for (const auto& name : regions) r.push_back({{"kind", "region"}, {"sketch", "s1"}, {"region", name}});
    Json t = Json::array();
    for (const auto& id : targets) t.push_back(bodyRef(id));
    return {{"regions", r},   {"operation", operation}, {"targets", t}, {"endType", endType},
            {"distance", distance}, {"upTo", upTo},      {"flip", flip}};
  }
};

/** A sketch s1 on XY with the region r1 = [0,4]×[0,2] (and r2 = [10,12]×[0,2] when asked). */
regen::StatePtr sketchState(CountingKernel& kernel, bool two = false,
                            regen::StatePtr state = regen::RegenState::empty()) {
  std::vector<kernel::ShapeHandle> faces{rectangle(kernel, kXy, 0, 0, 4, 2)};
  if (two) faces.push_back(rectangle(kernel, kXy, 10, 0, 2, 2));
  return state->with(aSketchArtifact("s1", faces, kXy));
}

kernel::BoundingBox bodyBox(CountingKernel& kernel, const Built& built, const std::string& id) {
  return bboxOf(kernel, *bodyAt(*built.ok().state, id));
}

TEST(ExtrudeBuilder, ExtrudesARegionAlongTheNormalIntoANewBody) {
  CountingKernel kernel;
  const auto built = build(kernel, "extrude", "e1", ExtrudeParams{}.json(), sketchState(kernel));
  EXPECT_EQ(idsOf(*built.ok().state), withOrigin({"s1/sketch", "e1/body"}));
  const auto body = bodyAt(*built.ok().state, "e1/body");
  EXPECT_EQ(body->origin().str(), "e1");
  const auto box = bboxOf(kernel, *body);
  expectVec(box.min, {0, 0, 0});
  expectVec(box.max, {4, 2, 10});
  EXPECT_EQ(body->names()->faces(document::TopoName("e1/face:end")).size(), 1U);
  EXPECT_EQ(body->names()->faces(document::TopoName("e1/face:side:l1")).size(), 1U);
}

TEST(ExtrudeBuilder, FlipExtrudesAgainstTheNormal) {
  CountingKernel kernel;
  ExtrudeParams p;
  p.flip = true;
  const auto box = bodyBox(kernel, build(kernel, "extrude", "e1", p.json(), sketchState(kernel)),
                           "e1/body");
  expectVec(box.min, {0, 0, -10});
  expectVec(box.max, {4, 2, 0});
}

TEST(ExtrudeBuilder, SymmetricMovesTheFaceBackByHalfTheDistanceAndIgnoresFlip) {
  CountingKernel kernel;
  ExtrudeParams p;
  p.endType = "symmetric";
  p.flip = true;
  const auto box = bodyBox(kernel, build(kernel, "extrude", "e1", p.json(), sketchState(kernel)),
                           "e1/body");
  expectVec(box.min, {0, 0, -5});
  expectVec(box.max, {4, 2, 5});
}

TEST(ExtrudeBuilder, TwoRegionsGiveOneBodyThroughOneUnion) {
  CountingKernel kernel;
  ExtrudeParams p;
  p.regions = {"r1", "r2"};
  const auto built = build(kernel, "extrude", "e1", p.json(), sketchState(kernel, true));
  EXPECT_EQ(kernel.calls("extrude"), 2);
  EXPECT_EQ(kernel.calls("boolean"), 1);
  EXPECT_EQ(built.ok().state->bodies().size(), 1U);
  expectVec(bodyBox(kernel, built, "e1/body").max, {12, 2, 10});
}

TEST(ExtrudeBuilder, AddAndRemoveChangeTheTargetWhichKeepsItsIdentity) {
  CountingKernel kernel;
  const auto state = sketchState(kernel, false, withBox(kernel, "b1", {0, 0, -5}, {4, 2, 5}));
  ExtrudeParams add;
  add.operation = "add";
  add.targets = {"b1"};
  const auto added = build(kernel, "extrude", "e1", add.json(), state);
  EXPECT_EQ(idsOf(*added.ok().state), withOrigin({"b1/body", "s1/sketch"}));
  const auto body = bodyAt(*added.ok().state, "b1/body");
  EXPECT_EQ(body->origin().str(), "b1");
  EXPECT_EQ(body->lastModifiedBy().str(), "e1");
  expectVec(bboxOf(kernel, *body).max, {4, 2, 10});
  ExtrudeParams remove = add;
  remove.operation = "remove";
  remove.flip = true;
  remove.distance = 2;
  const auto removed = build(kernel, "extrude", "e2", remove.json(), state);
  expectVec(bodyBox(kernel, removed, "b1/body").min, {0, 0, -5});
  expectVec(bodyBox(kernel, removed, "b1/body").max, {4, 2, -2});
}

TEST(ExtrudeBuilder, AnUnresolvedRegionOrTargetGivesUnresolvedReferenceWithoutExtruding) {
  CountingKernel kernel;
  const auto state = sketchState(kernel);
  ExtrudeParams region;
  region.regions = {"r9"};
  const auto r = build(kernel, "extrude", "e1", region.json(), state);
  EXPECT_EQ(r.error().code, regen::FeatureErrorCode::UnresolvedReference);
  EXPECT_EQ(r.error().issues.at(0).param, "regions");
  ExtrudeParams target;
  target.operation = "remove";
  target.targets = {"x"};
  EXPECT_EQ(build(kernel, "extrude", "e1", target.json(), state).error().issues.at(0).param,
            "targets");
  // A hidden targets param of 'new' is not read.
  ExtrudeParams hidden;
  hidden.targets = {"x"};
  EXPECT_TRUE(build(kernel, "extrude", "e1", hidden.json(), state).result);
  EXPECT_EQ(kernel.calls("extrude"), 1);
}

TEST(ExtrudeBuilder, ForwardsAKernelError) {
  CountingKernel kernel;
  const auto state = sketchState(kernel);
  kernel.failNext("extrude", {kernel::KernelErrorCode::OperationFailed, "boom"});
  const auto out = build(kernel, "extrude", "e1", ExtrudeParams{}.json(), state);
  EXPECT_EQ(out.error().code, regen::FeatureErrorCode::Kernel);
  EXPECT_EQ(out.error().issues.at(0).code, "kernel.operationFailed");
}

// --- up to face

/** The sketch on XY and a box k [−1, 13]×[−1, 4]×[5, 8] above it. */
regen::StatePtr upToState(CountingKernel& kernel) {
  return sketchState(kernel, true, withBox(kernel, "k", {-1, -1, 5}, {14, 5, 3}));
}

ExtrudeParams upTo(const std::string& face) {
  ExtrudeParams p;
  p.endType = "upToFace";
  p.distance = 99;
  p.flip = true;
  p.upTo = {topoRef("k", face)};
  return p;
}

TEST(ExtrudeBuilderUpToFace, ExtrudesUpToTheBottomFaceOfABoxIgnoringDistanceAndFlip) {
  CountingKernel kernel;
  const auto built = build(kernel, "extrude", "e1", upTo("k/face:bottom").json(), upToState(kernel));
  const auto box = bodyBox(kernel, built, "e1/body");
  expectVec(box.min, {0, 0, 0});
  expectVec(box.max, {4, 2, 5});
  EXPECT_TRUE(built.ok().anchors.empty());
}

TEST(ExtrudeBuilderUpToFace, MeasuresTheDistanceFromThePlaneOfEachRegion) {
  CountingKernel kernel;
  auto state = withBox(kernel, "k", {-1, -1, 5}, {14, 5, 3});
  const core::Plane raised{{0, 0, 1}, {1, 0, 0}, {0, 0, 1}};
  state = state->with(aSketchArtifact("s1", {rectangle(kernel, raised, 0, 0, 4, 2)}, raised));
  const auto box = bodyBox(kernel, build(kernel, "extrude", "e1", upTo("k/face:bottom").json(), state),
                           "e1/body");
  expectVec(box.min, {0, 0, 1});
  expectVec(box.max, {4, 2, 5});
}

TEST(ExtrudeBuilderUpToFace, AFaceBehindInOrSlantedToTheProfileIsInvalidParamsAtUpTo) {
  CountingKernel kernel;
  auto state = upToState(kernel);
  state = withBox(kernel, "low", {-1, -1, -3}, {2, 2, 3}, state);
  for (const auto& [body, face] : {std::pair{std::string("low"), std::string("low/face:bottom")},
                                   std::pair{std::string("low"), std::string("low/face:top")},
                                   std::pair{std::string("k"), std::string("k/face:left")}}) {
    ExtrudeParams p = upTo(face);
    p.upTo = {topoRef(body, face)};
    const auto out = build(kernel, "extrude", "e1", p.json(), state);
    EXPECT_EQ(out.error().code, regen::FeatureErrorCode::InvalidParams) << face;
    EXPECT_EQ(out.error().issues.at(0).param, "upTo") << face;
    EXPECT_EQ(out.error().issues.at(0).code, "extrude.upToFace") << face;
  }
}

TEST(ExtrudeBuilderUpToFace, AMissingOrNonPlanarFaceIsUnresolvedReferenceAtUpTo) {
  CountingKernel kernel;
  auto state = upToState(kernel);
  kernel.resetCounts();
  const auto missing = build(kernel, "extrude", "e1", upTo("k/face:nothing").json(), state);
  EXPECT_EQ(missing.error().code, regen::FeatureErrorCode::UnresolvedReference);
  EXPECT_EQ(missing.error().issues.at(0).param, "upTo");
  EXPECT_EQ(kernel.calls("extrude"), 0);
  state = state->with(regen::test::aBody("cyl", kernel::ShapeHandle{1},
                                         regen::test::aNameTable({{"cyl/face:side", {0}}})));
  ExtrudeParams side = upTo("cyl/face:side");
  side.upTo = {topoRef("cyl", "cyl/face:side")};
  EXPECT_EQ(build(kernel, "extrude", "e1", side.json(), state).error().code,
            regen::FeatureErrorCode::UnresolvedReference);
}

// --- anchors

TEST(ExtrudeBuilderAnchors, BlindBaseAtTheCenterOfTheRegionInTheSketchPlaneAlongTheNormal) {
  CountingKernel kernel;
  const auto state = sketchState(kernel);
  ExtrudeParams p;
  const auto out = build(kernel, "extrude", "e1", p.json(), state);
  const auto& base = out.ok().anchors.at("base");
  expectVec(base.point, {2, 1, 0});
  ASSERT_TRUE(base.direction.has_value());
  expectVec(*base.direction, {0, 0, 1});
  // The anchor depends neither on the distance nor on flip, symmetric included.
  p.distance = 3;
  p.flip = true;
  EXPECT_EQ(build(kernel, "extrude", "e1", p.json(), state).ok().anchors, out.ok().anchors);
  p.endType = "symmetric";
  EXPECT_EQ(build(kernel, "extrude", "e1", p.json(), state).ok().anchors, out.ok().anchors);
}

TEST(ExtrudeBuilderAnchors, TwoRegionsTheCenterOfTheirJoinedBox) {
  CountingKernel kernel;
  ExtrudeParams p;
  p.regions = {"r1", "r2"};
  const auto out = build(kernel, "extrude", "e1", p.json(), sketchState(kernel, true));
  expectVec(out.ok().anchors.at("base").point, {6, 1, 0});
}

TEST(ExtrudeBuilderAnchors, ASlantedPlaneProjectsTheCenterOntoTheSketchPlane) {
  CountingKernel kernel;
  const double k = std::sqrt(0.5);
  const core::Plane slanted{{0, 0, 0}, {k, 0, -k}, {k, 0, k}};
  const auto state = regen::RegenState::empty()->with(
      aSketchArtifact("s1", {rectangle(kernel, slanted, 0, 0, 2, 2)}, slanted));
  const auto out = build(kernel, "extrude", "e1", ExtrudeParams{}.json(), state);
  const auto& base = out.ok().anchors.at("base");
  // On the plane: (base − origin) · normal = 0.
  EXPECT_NEAR(base.point[0] * k + base.point[2] * k, 0, 1e-9);
  expectVec(*base.direction, slanted.normal, 1e-12);
}

}  // namespace
}  // namespace tinycad::features::test
