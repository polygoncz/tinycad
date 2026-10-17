// ChamferBuilder (the builder part of test/unit/features/chamfer/chamfer.test.ts) over OcctKernel.

#include "features/builder_testing.hpp"

namespace tinycad::features::test {
namespace {

const std::string kTopFront = "edge:b1/face:front|b1/face:top";

Json chamferParams(std::vector<Json> edges, double distance) {
  return {{"edges", edges}, {"distance", distance}};
}

TEST(ChamferBuilder, CutsAnEdgeTheBodyKeepsItsIdentityAndTheNewFaceIsNamedAfterTheEdge) {
  CountingKernel kernel;
  const auto state = withBox(kernel, "b1", {0, 0, 0}, {10, 10, 10});
  const auto out =
      build(kernel, "chamfer", "c1", chamferParams({topoRef("b1", kTopFront)}, 1), state);
  const auto body = bodyAt(*out.ok().state, "b1/body");
  EXPECT_EQ(body->origin().str(), "b1");
  EXPECT_EQ(body->lastModifiedBy().str(), "c1");
  EXPECT_EQ(body->names()->faces(document::TopoName("c1/face:chamfer:" + kTopFront)).size(), 1U);
  EXPECT_EQ(kernel.calls("chamfer"), 1);
}

TEST(ChamferBuilder, ADistanceTooLargeIsInvalidParamsChamferFailedAtDistance) {
  CountingKernel kernel;
  const auto state = withBox(kernel, "b1", {0, 0, 0}, {10, 10, 10});
  const auto out =
      build(kernel, "chamfer", "c1", chamferParams({topoRef("b1", kTopFront)}, 20), state);
  EXPECT_EQ(out.error().code, regen::FeatureErrorCode::InvalidParams);
  ASSERT_EQ(out.error().issues.size(), 1U);
  EXPECT_EQ(out.error().issues[0].param, "distance");
  EXPECT_EQ(out.error().issues[0].code, "chamfer.failed");
}

TEST(ChamferBuilder, AnUnresolvedEdgeGivesUnresolvedReferenceAtEdges) {
  CountingKernel kernel;
  const auto out = build(kernel, "chamfer", "c1", chamferParams({topoRef("b1", kTopFront)}, 1));
  EXPECT_EQ(out.error().code, regen::FeatureErrorCode::UnresolvedReference);
  EXPECT_EQ(out.error().issues.at(0).param, "edges");
}

}  // namespace
}  // namespace tinycad::features::test
