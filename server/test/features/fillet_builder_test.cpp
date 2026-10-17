// FilletBuilder (the builder part of test/unit/features/fillet/fillet.test.ts) over OcctKernel.

#include "features/builder_testing.hpp"

namespace tinycad::features::test {
namespace {

const std::string kTopFront = "edge:b1/face:front|b1/face:top";
const std::string kTopBack = "edge:b1/face:back|b1/face:top";

Json filletParams(std::vector<Json> edges, double radius) {
  return {{"edges", edges}, {"radius", radius}};
}

TEST(FilletBuilder, RoundsAnEdgeTheBodyKeepsItsIdentityAndTheNewFaceIsNamedAfterTheEdge) {
  CountingKernel kernel;
  const auto state = withBox(kernel, "b1", {0, 0, 0}, {10, 10, 10});
  const auto out = build(kernel, "fillet", "f1", filletParams({topoRef("b1", kTopFront)}, 1), state);
  const auto body = bodyAt(*out.ok().state, "b1/body");
  EXPECT_EQ(body->origin().str(), "b1");
  EXPECT_EQ(body->lastModifiedBy().str(), "f1");
  EXPECT_EQ(idsOf(*out.ok().state), withOrigin({"b1/body"}));
  EXPECT_EQ(body->names()->faces(document::TopoName("f1/face:fillet:" + kTopFront)).size(), 1U);
  EXPECT_EQ(body->names()->topology().faces.size(), 7U);
  EXPECT_TRUE(out.ok().anchors.empty());
}

TEST(FilletBuilder, MakesOneKernelCallPerBodyWithAllItsEdges) {
  CountingKernel kernel;
  auto state = withBox(kernel, "b1", {0, 0, 0}, {10, 10, 10});
  state = withBox(kernel, "b2", {20, 0, 0}, {10, 10, 10}, state);
  kernel.resetCounts();
  const auto out = build(kernel, "fillet", "f1",
                         filletParams({topoRef("b1", kTopFront), topoRef("b2", "edge:b2/face:front|b2/face:top"),
                                       topoRef("b1", kTopBack), topoRef("b1", kTopFront)},
                                      1),
                         state);
  ASSERT_TRUE(out.result);
  EXPECT_EQ(kernel.calls("fillet"), 2);
  EXPECT_EQ(bodyAt(*out.ok().state, "b1/body")->names()->topology().faces.size(), 8U);
  EXPECT_EQ(bodyAt(*out.ok().state, "b2/body")->lastModifiedBy().str(), "f1");
}

TEST(FilletBuilder, ARadiusTooLargeIsInvalidParamsFilletFailedAtRadius) {
  CountingKernel kernel;
  const auto state = withBox(kernel, "b1", {0, 0, 0}, {10, 10, 10});
  const auto out = build(kernel, "fillet", "f1", filletParams({topoRef("b1", kTopFront)}, 20), state);
  EXPECT_EQ(out.error().code, regen::FeatureErrorCode::InvalidParams);
  ASSERT_EQ(out.error().issues.size(), 1U);
  EXPECT_EQ(out.error().issues[0].param, "radius");
  EXPECT_EQ(out.error().issues[0].code, "fillet.failed");
}

TEST(FilletBuilder, AnotherKernelErrorIsKernel) {
  CountingKernel kernel;
  const auto state = withBox(kernel, "b1", {0, 0, 0}, {10, 10, 10});
  kernel.failNext("fillet", {kernel::KernelErrorCode::Internal, "boom"});
  const auto out = build(kernel, "fillet", "f1", filletParams({topoRef("b1", kTopFront)}, 1), state);
  EXPECT_EQ(out.error().code, regen::FeatureErrorCode::Kernel);
  EXPECT_EQ(out.error().issues.at(0).code, "kernel.internal");
}

TEST(FilletBuilder, AnUnresolvedEdgeGivesUnresolvedReferenceAtEdges) {
  CountingKernel kernel;
  const auto state = withBox(kernel, "b1", {0, 0, 0}, {10, 10, 10});
  const auto out =
      build(kernel, "fillet", "f1", filletParams({topoRef("b1", "edge:nothing")}, 1), state);
  EXPECT_EQ(out.error().code, regen::FeatureErrorCode::UnresolvedReference);
  EXPECT_EQ(out.error().issues.at(0).param, "edges");
  EXPECT_EQ(kernel.calls("fillet"), 0);
}

}  // namespace
}  // namespace tinycad::features::test
