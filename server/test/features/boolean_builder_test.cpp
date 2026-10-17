// BooleanBuilder (the builder part of test/unit/features/boolean/boolean.test.ts) over OcctKernel.

#include "features/builder_testing.hpp"

namespace tinycad::features::test {
namespace {

using Call = CountingKernel::BooleanCall;

Json booleanParams(const std::string& op, std::vector<std::string> targets,
                   std::vector<std::string> tools, bool keepTools = false) {
  Json t = Json::array();
  for (const auto& id : targets) t.push_back(bodyRef(id));
  Json u = Json::array();
  for (const auto& id : tools) u.push_back(bodyRef(id));
  return {{"op", op}, {"targets", t}, {"tools", u}, {"keepTools", keepTools}};
}

/** Boxes a [0,10]³, b [5,15]×[0,10]² (overlaps a) and c [20,30]×[0,10]² behind the origin. */
regen::StatePtr threeBoxes(CountingKernel& kernel) {
  auto state = withBox(kernel, "a", {0, 0, 0}, {10, 10, 10});
  state = withBox(kernel, "b", {5, 0, 0}, {10, 10, 10}, state);
  state = withBox(kernel, "c", {20, 0, 0}, {10, 10, 10}, state);
  kernel.resetCounts();
  return state;
}

TEST(BooleanBuilder, UnionMergesTheOtherTargetsAndTheToolsIntoTheFirstTarget) {
  CountingKernel kernel;
  const auto state = threeBoxes(kernel);
  const auto a = bodyAt(*state, "a/body");
  const auto b = bodyAt(*state, "b/body");
  const auto c = bodyAt(*state, "c/body");
  const auto out = build(kernel, "boolean", "s", booleanParams("union", {"a", "c"}, {"b"}), state);
  EXPECT_EQ(
      kernel.booleanCalls(),
      (std::vector<Call>{Call{kernel::BooleanOp::Union, {a->shape()}, {c->shape(), b->shape()}}}));
  const auto result = bodyAt(*out.ok().state, "a/body");
  expectVec(bboxOf(kernel, *result).max, {30, 10, 10});
  // The other targets and the tools leave.
  EXPECT_EQ(idsOf(*out.ok().state), withOrigin({"a/body"}));
}

TEST(BooleanBuilder, SubtractAndIntersectPassAllTargetsAndAllTools) {
  CountingKernel kernel;
  const auto state = threeBoxes(kernel);
  const auto a = bodyAt(*state, "a/body");
  const auto b = bodyAt(*state, "b/body");
  const auto c = bodyAt(*state, "c/body");
  build(kernel, "boolean", "s", booleanParams("subtract", {"a", "c"}, {"b"}), state);
  build(kernel, "boolean", "i", booleanParams("intersect", {"a"}, {"b"}), state);
  EXPECT_EQ(
      kernel.booleanCalls(),
      (std::vector<Call>{Call{kernel::BooleanOp::Subtract, {a->shape(), c->shape()}, {b->shape()}},
                         Call{kernel::BooleanOp::Intersect, {a->shape()}, {b->shape()}}}));
}

TEST(BooleanBuilder, TheResultKeepsTheIdentityAndPlaceOfTheFirstTargetAndIsModifiedByIt) {
  CountingKernel kernel;
  const auto state = threeBoxes(kernel);
  const auto out = build(kernel, "boolean", "s", booleanParams("subtract", {"b"}, {"a"}), state);
  EXPECT_EQ(idsOf(*out.ok().state), withOrigin({"b/body", "c/body"}));
  const auto result = bodyAt(*out.ok().state, "b/body");
  EXPECT_EQ(result->origin().str(), "b");
  EXPECT_EQ(result->lastModifiedBy().str(), "s");
  EXPECT_NE(result->shape(), bodyAt(*state, "b/body")->shape());
  // The names of b go over the history of the boolean; the left face of b is cut away, a's right
  // face takes its place.
  const auto names = faceNames(*result->names());
  EXPECT_NE(std::find(names.begin(), names.end(), "b/face:top"), names.end());
  EXPECT_NE(std::find(names.begin(), names.end(), "a/face:right"), names.end());
  expectVec(bboxOf(kernel, *result).min, {10, 0, 0});
  // c is untouched: the same pointer; the input state stays as it was.
  EXPECT_EQ(bodyAt(*out.ok().state, "c/body"), bodyAt(*state, "c/body"));
  EXPECT_EQ(idsOf(*state), withOrigin({"a/body", "b/body", "c/body"}));
}

TEST(BooleanBuilder, WithKeepToolsLeavesTheToolsAsTheSamePointers) {
  CountingKernel kernel;
  const auto state = threeBoxes(kernel);
  const auto out =
      build(kernel, "boolean", "s", booleanParams("subtract", {"a"}, {"b", "c"}, true), state);
  EXPECT_EQ(idsOf(*out.ok().state), withOrigin({"a/body", "b/body", "c/body"}));
  EXPECT_EQ(bodyAt(*out.ok().state, "b/body"), bodyAt(*state, "b/body"));
}

TEST(BooleanBuilder, AnUnresolvedTargetOrToolGivesUnresolvedReferenceWithoutCallingTheKernel) {
  CountingKernel kernel;
  const auto state = threeBoxes(kernel);
  const auto target = build(kernel, "boolean", "s", booleanParams("union", {"x"}, {"b"}), state);
  EXPECT_EQ(target.error().code, regen::FeatureErrorCode::UnresolvedReference);
  EXPECT_EQ(target.error().issues.at(0).param, "targets");
  const auto tool = build(kernel, "boolean", "s", booleanParams("union", {"a"}, {"y"}), state);
  EXPECT_EQ(tool.error().issues.at(0).param, "tools");
  EXPECT_EQ(tool.error().issues.at(0).code, "param.unresolvedRef");
  EXPECT_EQ(kernel.calls("boolean"), 0);
}

TEST(BooleanBuilder, IntersectOfSeparateBlocksIsAKernelError) {
  CountingKernel kernel;
  const auto state = threeBoxes(kernel);
  const auto out = build(kernel, "boolean", "s", booleanParams("intersect", {"a"}, {"c"}), state);
  EXPECT_EQ(out.error().code, regen::FeatureErrorCode::Kernel);
  EXPECT_EQ(out.error().issues.at(0).code, "kernel.operationFailed");
}

}  // namespace
}  // namespace tinycad::features::test
