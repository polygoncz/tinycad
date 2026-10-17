// TransformBuilder (the builder part of test/unit/features/transform/transform.test.ts).

#include <numbers>

#include "features/builder_testing.hpp"

namespace tinycad::features::test {
namespace {

constexpr double kQuarter = std::numbers::pi / 2;

struct TransformParams {
  std::vector<std::string> bodies{"b1"};
  std::string pivot = "origin";
  core::Vec3 pivotPoint{0, 0, 0};
  core::Vec3 translate{0, 0, 0};
  double rx = 0, ry = 0, rz = 0;

  [[nodiscard]] Json json() const {
    Json refs = Json::array();
    for (const auto& id : bodies) refs.push_back(bodyRef(id));
    return {{"bodies", refs},
            {"pivot", pivot},
            {"pivotPoint", {pivotPoint[0], pivotPoint[1], pivotPoint[2]}},
            {"translate", {translate[0], translate[1], translate[2]}},
            {"rx", rx},
            {"ry", ry},
            {"rz", rz}};
  }
};

/** A box b1 [0,2]×[0,4]×[0,6]. */
regen::StatePtr boxState(CountingKernel& kernel) {
  return withBox(kernel, "b1", {0, 0, 0}, {2, 4, 6});
}

regen::BodyPtr moved(CountingKernel& kernel, const TransformParams& p, regen::StatePtr state) {
  return bodyAt(*build(kernel, "transform", "t1", p.json(), std::move(state)).ok().state,
                "b1/body");
}

TEST(TransformBuilder, TranslatesABoxIdOriginAndNamesStayLastModifiedByIsTheTransform) {
  CountingKernel kernel;
  const auto state = boxState(kernel);
  const auto before = bodyAt(*state, "b1/body");
  TransformParams p;
  p.translate = {10, 20, 30};
  const auto out = build(kernel, "transform", "t1", p.json(), state);
  EXPECT_EQ(idsOf(*out.ok().state), withOrigin({"b1/body"}));
  const auto after = bodyAt(*out.ok().state, "b1/body");
  EXPECT_EQ(after->origin().str(), "b1");
  EXPECT_EQ(after->lastModifiedBy().str(), "t1");
  EXPECT_NE(after->names(), before->names());
  EXPECT_EQ(after->names()->faceEntries(), before->names()->faceEntries());
  EXPECT_EQ(after->names()->edgeEntries(), before->names()->edgeEntries());
  EXPECT_NE(after->shape(), before->shape());
  const auto box = bboxOf(kernel, *after);
  expectVec(box.min, {10, 20, 30});
  expectVec(box.max, {12, 24, 36});
  EXPECT_TRUE(out.ok().anchors.empty());
}

TEST(TransformBuilder, RotatesBy90DegreesAboutZThroughTheWorldOriginWithThePivotOrigin) {
  CountingKernel kernel;
  TransformParams p;
  p.rz = kQuarter;
  const auto box = bboxOf(kernel, *moved(kernel, p, boxState(kernel)));
  expectVec(box.min, {-4, 0, 0});
  expectVec(box.max, {0, 2, 6});
}

TEST(TransformBuilder, RotatesByRzRyRxXFirstZLast) {
  CountingKernel kernel;
  TransformParams p;
  p.rx = kQuarter;
  p.rz = kQuarter;
  // Rx turns [0,2]×[0,4]×[0,6] into [0,2]×[-6,0]×[0,4]; Rz then into [0,6]×[0,2]×[0,4].
  const auto box = bboxOf(kernel, *moved(kernel, p, boxState(kernel)));
  expectVec(box.min, {0, 0, 0});
  expectVec(box.max, {6, 2, 4});
}

TEST(TransformBuilder, RotatesFirstThenTranslates) {
  CountingKernel kernel;
  TransformParams p;
  p.rz = kQuarter;
  p.translate = {10, 0, 0};
  const auto box = bboxOf(kernel, *moved(kernel, p, boxState(kernel)));
  expectVec(box.min, {6, 0, 0});
  expectVec(box.max, {10, 2, 6});
}

TEST(TransformBuilder, BodiesCenterRotatesAboutTheCenterAndGivesItAsTheAnchorPivot) {
  CountingKernel kernel;
  const auto state = withBox(kernel, "b1", {10, 0, 0}, {2, 2, 2});
  TransformParams p;
  p.pivot = "bodiesCenter";
  p.rz = kQuarter;
  const auto out = build(kernel, "transform", "t1", p.json(), state);
  const auto box = bboxOf(kernel, *bodyAt(*out.ok().state, "b1/body"));
  expectVec(box.min, {10, 0, 0});
  expectVec(box.max, {12, 2, 2});
  ASSERT_EQ(out.ok().anchors.size(), 1U);
  expectVec(out.ok().anchors.at("pivot").point, {11, 1, 1});
  EXPECT_FALSE(out.ok().anchors.at("pivot").direction.has_value());
}

TEST(TransformBuilder, PointRotatesAboutPivotPointWithoutAnAnchor) {
  CountingKernel kernel;
  TransformParams p;
  p.pivot = "point";
  p.pivotPoint = {2, 4, 0};
  p.rz = kQuarter;
  const auto out = build(kernel, "transform", "t1", p.json(), boxState(kernel));
  const auto box = bboxOf(kernel, *bodyAt(*out.ok().state, "b1/body"));
  // q − p spans [−2, 0] × [−4, 0]; turned by 90° it spans [0, 4] × [−2, 0].
  expectVec(box.min, {2, 2, 0});
  expectVec(box.max, {6, 4, 6});
  EXPECT_TRUE(out.ok().anchors.empty());
}

TEST(TransformBuilder, PivotThenTranslation) {
  CountingKernel kernel;
  const auto state = withBox(kernel, "b1", {0, 0, 0}, {2, 2, 2});
  TransformParams p;
  p.pivot = "point";
  p.pivotPoint = {1, 1, 1};
  p.ry = kQuarter;
  p.translate = {10, 0, 0};
  const auto box = bboxOf(kernel, *moved(kernel, p, state));
  expectVec(box.min, {10, 0, 0});
  expectVec(box.max, {12, 2, 2});
}

TEST(TransformBuilder, TheAnchorPivotOfTwoBodiesIsTheCenterOfTheirJoinedBoxAndIgnoresMotion) {
  CountingKernel kernel;
  auto state = withBox(kernel, "b1", {0, 0, 0}, {2, 2, 2});
  state = withBox(kernel, "b2", {20, 0, 8}, {2, 2, 2}, state);
  TransformParams p;
  p.bodies = {"b1", "b2"};
  p.pivot = "bodiesCenter";
  const auto still = build(kernel, "transform", "t1", p.json(), state);
  p.translate = {5, 6, 7};
  p.rx = 1;
  p.rz = 2;
  const auto turned = build(kernel, "transform", "t1", p.json(), state);
  expectVec(still.ok().anchors.at("pivot").point, {11, 1, 5});
  EXPECT_EQ(turned.ok().anchors, still.ok().anchors);
  // Both bodies moved, each keeps its id and place.
  EXPECT_EQ(idsOf(*turned.ok().state), withOrigin({"b1/body", "b2/body"}));
  EXPECT_EQ(bodyAt(*turned.ok().state, "b2/body")->lastModifiedBy().str(), "t1");
}

TEST(TransformBuilder, AnUnresolvedReferenceGivesUnresolvedReferenceAtBodiesWithoutKernelCalls) {
  CountingKernel kernel;
  const auto state = boxState(kernel);
  kernel.resetCounts();
  TransformParams p;
  p.bodies = {"x"};
  p.pivot = "bodiesCenter";
  const auto out = build(kernel, "transform", "t1", p.json(), state);
  EXPECT_EQ(out.error().code, regen::FeatureErrorCode::UnresolvedReference);
  EXPECT_EQ(out.error().issues.at(0).param, "bodies");
  EXPECT_EQ(kernel.modelingCalls(), 0);
}

TEST(TransformBuilder, ForwardsAKernelError) {
  CountingKernel kernel;
  const auto state = boxState(kernel);
  kernel.failNext("transform", {kernel::KernelErrorCode::Internal, "boom"});
  EXPECT_EQ(build(kernel, "transform", "t1", TransformParams{}.json(), state).error().code,
            regen::FeatureErrorCode::Kernel);
}

}  // namespace
}  // namespace tinycad::features::test
