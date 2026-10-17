// BoxBuilder (the builder part of test/unit/features/box/box.test.ts).

#include "features/builder_testing.hpp"

namespace tinycad::features::test {
namespace {

TEST(BoxBuilder, AddsOneBodyCreatedAndLastModifiedByTheFeature) {
  CountingKernel kernel;
  const auto built = build(kernel, "box", "b1", boxParams({0, 0, 0}, {1, 2, 3}));
  const auto& out = built.ok();
  EXPECT_EQ(idsOf(*out.state), withOrigin({"b1/body"}));
  const auto body = bodyAt(*out.state, "b1/body");
  EXPECT_EQ(body->origin().str(), "b1");
  EXPECT_EQ(body->lastModifiedBy().str(), "b1");
  EXPECT_TRUE(out.anchors.empty());
  EXPECT_EQ(built.owned, regen::OwnedHandles{body->shape()});
}

TEST(BoxBuilder, NamesTheFacesByTheirRolesAndAllTwelveEdges) {
  CountingKernel kernel;
  const auto body = bodyAt(*withBox(kernel, "b1", {0, 0, 0}, {1, 1, 1}), "b1/body");
  EXPECT_EQ(faceNames(*body->names()),
            (std::vector<std::string>{"b1/face:back", "b1/face:bottom", "b1/face:front",
                                      "b1/face:left", "b1/face:right", "b1/face:top"}));
  EXPECT_EQ(body->names()->edgeEntries().size(), 12U);
  EXPECT_EQ(body->names()->edges(document::TopoName("edge:b1/face:front|b1/face:top")).size(), 1U);
}

TEST(BoxBuilder, MakesABoxSpanningOriginPlusSize) {
  CountingKernel kernel;
  const auto body = bodyAt(*withBox(kernel, "b1", {1, -2, 3}, {2, 3, 4}), "b1/body");
  const auto box = bboxOf(kernel, *body);
  expectVec(box.min, {1, -2, 3});
  expectVec(box.max, {3, 1, 7});
}

TEST(BoxBuilder, KeepsTheArtifactsOfTheInputStateAndDoesNotChangeIt) {
  CountingKernel kernel;
  const auto first = withBox(kernel, "b1", {0, 0, 0}, {1, 1, 1});
  const auto before = first->artifacts();
  const auto second = withBox(kernel, "b2", {5, 0, 0}, {1, 1, 1}, first);
  EXPECT_EQ(idsOf(*second), withOrigin({"b1/body", "b2/body"}));
  EXPECT_EQ(second->artifacts()[6], first->artifacts()[6]);
  EXPECT_EQ(first->artifacts(), before);
}

TEST(BoxBuilder, ForwardsAKernelFailureAsKernel) {
  CountingKernel kernel;
  kernel.failNext("makeBox", {kernel::KernelErrorCode::InvalidInput, "bad"});
  const auto built = build(kernel, "box", "b1", boxParams({0, 0, 0}, {1, 1, 1}));
  EXPECT_EQ(built.error().code, regen::FeatureErrorCode::Kernel);
  EXPECT_EQ(built.error().issues.at(0).code, "kernel.invalidInput");
}

}  // namespace
}  // namespace tinycad::features::test
