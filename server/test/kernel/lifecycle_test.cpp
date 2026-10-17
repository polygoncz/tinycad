// The contract blocks `errors`, `makeBox`, `boundingBox`, `release`, `liveHandleCount`,
// `handles` and `isolation` of src/kernel/testing.ts. Left out because C++ makes them hold by
// construction: "every method returns a Promise" (synchronous API, N13), "rejects instead of
// throwing" for input outside the types (null, 42) and "changing the input before await" (inputs
// are values read during the call).

#include <gtest/gtest.h>

#include <limits>
#include <set>
#include <vector>

#include "kernel_test_support.hpp"

namespace tinycad::kernel {
namespace {

using namespace test;  // NOLINT(google-build-using-namespace): the fixtures of the suite

constexpr double kNaN = std::numeric_limits<double>::quiet_NaN();
constexpr double kInf = std::numeric_limits<double>::infinity();

class Lifecycle : public ::testing::Test {
 protected:
  ShapeHandle aBox() { return ok(kernel.makeBox(kBox)).shape; }

  OcctKernel kernel;
};

TEST_F(Lifecycle, ARejectionCarriesAKernelErrorCode) {
  const auto result = kernel.boundingBox(kUnknown);
  ASSERT_FALSE(result.has_value());
  EXPECT_EQ(result.error().code, KernelErrorCode::UnknownHandle);
  EXPECT_FALSE(result.error().message.empty());
}

TEST_F(Lifecycle, KernelErrorCodeNamesAreTheTsCodes) {
  EXPECT_EQ(kernelErrorCodeName(KernelErrorCode::InvalidInput), "invalid-input");
  EXPECT_EQ(kernelErrorCodeName(KernelErrorCode::OperationFailed), "operation-failed");
  EXPECT_EQ(kernelErrorCodeName(KernelErrorCode::UnknownHandle), "unknown-handle");
  EXPECT_EQ(kernelErrorCodeName(KernelErrorCode::Internal), "internal");
}

TEST_F(Lifecycle, EveryMethodWithAnInvalidInputFailsInsteadOfThrowing) {
  const int edge[] = {0};
  EXPECT_TRUE(codeOf(kernel.makeBox({kOrigin, {0, 1, 1}}))) << "makeBox";
  EXPECT_TRUE(codeOf(kernel.makeCylinder({kOrigin, {0, 0, 2}, 0, 4}))) << "makeCylinder";
  EXPECT_TRUE(codeOf(kernel.transform(kUnknown, identity()))) << "transform";
  EXPECT_TRUE(codeOf(kernel.boolean(BooleanOp::Union, {}, {}))) << "boolean";
  EXPECT_TRUE(codeOf(kernel.makeFace(faceOf(kPlaneXY, {})))) << "makeFace";
  const ProfileCurve noId = line({0, 0}, {1, 0});
  EXPECT_TRUE(codeOf(kernel.profileRegions(std::span(&noId, 1)))) << "profileRegions";
  EXPECT_TRUE(codeOf(kernel.extrude(kUnknown, {0, 0, 1}, 5))) << "extrude";
  EXPECT_TRUE(codeOf(kernel.revolve(kUnknown, kZAxis, kTurn))) << "revolve";
  EXPECT_TRUE(codeOf(kernel.fillet(kUnknown, edge, 1))) << "fillet";
  EXPECT_TRUE(codeOf(kernel.chamfer(kUnknown, edge, 1))) << "chamfer";
  EXPECT_TRUE(codeOf(kernel.topology(kUnknown))) << "topology";
  EXPECT_TRUE(codeOf(kernel.exportStep({}))) << "exportStep";
  EXPECT_TRUE(codeOf(kernel.tessellate(kUnknown, kQuality))) << "tessellate";
  EXPECT_TRUE(codeOf(kernel.boundingBox(kUnknown))) << "boundingBox";
  EXPECT_TRUE(codeOf(kernel.release(std::span(&kUnknown, 1)))) << "release";
}

TEST_F(Lifecycle, AnUnknownHandleFailsWithUnknownHandleEverywhere) {
  const int edge[] = {0};
  for (const ShapeHandle h : kNeverIssued) {
    const ShapeHandle box = aBox();
    const ShapeHandle pair[] = {box, h};
    EXPECT_EQ(codeOf(kernel.transform(h, identity())), KernelErrorCode::UnknownHandle);
    EXPECT_EQ(codeOf(kernel.boolean(BooleanOp::Union, std::span(&h, 1), std::span(&box, 1))),
              KernelErrorCode::UnknownHandle);
    EXPECT_EQ(codeOf(kernel.boolean(BooleanOp::Union, std::span(&box, 1), std::span(&h, 1))),
              KernelErrorCode::UnknownHandle);
    EXPECT_EQ(codeOf(kernel.extrude(h, {0, 0, 1}, 5)), KernelErrorCode::UnknownHandle);
    EXPECT_EQ(codeOf(kernel.revolve(h, kZAxis, kTurn)), KernelErrorCode::UnknownHandle);
    EXPECT_EQ(codeOf(kernel.fillet(h, edge, 0.5)), KernelErrorCode::UnknownHandle);
    EXPECT_EQ(codeOf(kernel.chamfer(h, edge, 0.5)), KernelErrorCode::UnknownHandle);
    EXPECT_EQ(codeOf(kernel.topology(h)), KernelErrorCode::UnknownHandle);
    EXPECT_EQ(codeOf(kernel.exportStep(pair)), KernelErrorCode::UnknownHandle);
    EXPECT_EQ(codeOf(kernel.tessellate(h, kQuality)), KernelErrorCode::UnknownHandle);
    EXPECT_EQ(codeOf(kernel.boundingBox(h)), KernelErrorCode::UnknownHandle);
    EXPECT_EQ(codeOf(kernel.release(std::span(&h, 1))), KernelErrorCode::UnknownHandle);
    ok(kernel.release(std::span(&box, 1)));
    EXPECT_EQ(kernel.liveHandleCount(), 0U);
  }
}

TEST_F(Lifecycle, MakeBoxReturnsAPositiveHandleAndAddsOneLiveHandle) {
  const ShapeHandle shape = aBox();
  EXPECT_GT(static_cast<std::uint64_t>(shape), 0U);
  EXPECT_EQ(kernel.liveHandleCount(), 1U);
}

TEST_F(Lifecycle, MakeBoxBoundingBoxEnclosesTheBoxAtMost1e6Larger) {
  expectEnclosesBox(ok(kernel.boundingBox(aBox())), kOrigin, kBoxMax);
}

TEST_F(Lifecycle, EveryMakeBoxReturnsANewHandleAndTheBoxesStayIndependent) {
  const ShapeHandle a = aBox();
  const ShapeHandle b = ok(kernel.makeBox({{0, 0, 0}, {1, 1, 1}})).shape;
  EXPECT_NE(a, b);
  EXPECT_EQ(kernel.liveHandleCount(), 2U);
  expectEnclosesBox(ok(kernel.boundingBox(a)), kOrigin, kBoxMax, "box a");
  expectEnclosesBox(ok(kernel.boundingBox(b)), {0, 0, 0}, {1, 1, 1}, "box b");
}

TEST_F(Lifecycle, InvalidMakeBoxInputsFailWithInvalidInputAndCreateNoHandle) {
  const std::vector<BoxInput> cases{{{kNaN, 0, 0}, {1, 1, 1}},  {{0, kInf, 0}, {1, 1, 1}},
                                    {{0, 0, -kInf}, {1, 1, 1}}, {{0, 0, 0}, {1, 0, 1}},
                                    {{0, 0, 0}, {1, 1, -1}},    {{0, 0, 0}, {kNaN, 1, 1}},
                                    {{0, 0, 0}, {1, kInf, 1}}};
  for (const BoxInput& input : cases) {
    EXPECT_EQ(codeOf(kernel.makeBox(input)), KernelErrorCode::InvalidInput);
    EXPECT_EQ(kernel.liveHandleCount(), 0U);
  }
}

TEST_F(Lifecycle, ReleaseOfAnEmptyListDoesNothing) {
  const ShapeHandle a = aBox();
  ok(kernel.release({}));
  EXPECT_EQ(kernel.liveHandleCount(), 1U);
  ok(kernel.boundingBox(a));
}

TEST_F(Lifecycle, ReleaseReleasesAllGivenHandles) {
  const ShapeHandle a = aBox();
  const ShapeHandle b = aBox();
  const ShapeHandle c = aBox();
  const ShapeHandle list[] = {a, c};
  ok(kernel.release(list));
  EXPECT_EQ(kernel.liveHandleCount(), 1U);
  ok(kernel.boundingBox(b));
}

TEST_F(Lifecycle, ReleaseIsAtomicWithAnUnknownHandleBeforeOrAfter) {
  for (const bool before : {true, false}) {
    const ShapeHandle a = aBox();
    const std::vector<ShapeHandle> list =
        before ? std::vector{kUnknown, a} : std::vector{a, kUnknown};
    EXPECT_EQ(codeOf(kernel.release(list)), KernelErrorCode::UnknownHandle);
    EXPECT_EQ(kernel.liveHandleCount(), 1U);
    expectEnclosesBox(ok(kernel.boundingBox(a)), kOrigin, kBoxMax);
    ok(kernel.release(std::span(&a, 1)));
    EXPECT_EQ(kernel.liveHandleCount(), 0U);
  }
}

TEST_F(Lifecycle, ReleaseOfTheSameHandleTwiceIsInvalidInputAndReleasesNothing) {
  const ShapeHandle a = aBox();
  const ShapeHandle b = aBox();
  const ShapeHandle list[] = {b, a, a};
  EXPECT_EQ(codeOf(kernel.release(list)), KernelErrorCode::InvalidInput);
  EXPECT_EQ(kernel.liveHandleCount(), 2U);
  ok(kernel.boundingBox(a));
  ok(kernel.boundingBox(b));
}

TEST_F(Lifecycle, LiveHandleCountCountsCreatedNotReleasedHandles) {
  EXPECT_EQ(kernel.liveHandleCount(), 0U);
  const ShapeHandle a = aBox();
  aBox();
  aBox();
  EXPECT_EQ(kernel.liveHandleCount(), 3U);
  ok(kernel.release(std::span(&a, 1)));
  EXPECT_EQ(kernel.liveHandleCount(), 2U);
}

TEST_F(Lifecycle, FailedOperationsCreateNoHandles) {
  const ShapeHandle a = aBox();
  const ShapeHandle twice[] = {a, a};
  EXPECT_TRUE(codeOf(kernel.makeBox({kOrigin, {-1, 1, 1}})));
  EXPECT_TRUE(codeOf(kernel.tessellate(kUnknown, kQuality)));
  EXPECT_TRUE(codeOf(kernel.tessellate(a, {0, 0.5})));
  EXPECT_TRUE(codeOf(kernel.boundingBox(kUnknown)));
  EXPECT_TRUE(codeOf(kernel.release(twice)));
  EXPECT_EQ(kernel.liveHandleCount(), 1U);
}

TEST_F(Lifecycle, AHandleIsNeverReusedNotEvenAfterRelease) {
  std::set<ShapeHandle> issued;
  for (int round = 0; round < 3; ++round) {
    const ShapeHandle pair[] = {aBox(), aBox()};
    for (const ShapeHandle h : pair) EXPECT_TRUE(issued.insert(h).second);
    ok(kernel.release(pair));
  }
  EXPECT_EQ(kernel.liveHandleCount(), 0U);
}

TEST_F(Lifecycle, AReleasedHandleFailsWithUnknownHandleEverywhere) {
  const ShapeHandle a = aBox();
  ok(kernel.release(std::span(&a, 1)));
  aBox();
  EXPECT_EQ(codeOf(kernel.tessellate(a, kQuality)), KernelErrorCode::UnknownHandle);
  EXPECT_EQ(codeOf(kernel.boundingBox(a)), KernelErrorCode::UnknownHandle);
  EXPECT_EQ(codeOf(kernel.topology(a)), KernelErrorCode::UnknownHandle);
  EXPECT_EQ(codeOf(kernel.release(std::span(&a, 1))), KernelErrorCode::UnknownHandle);
  EXPECT_EQ(kernel.liveHandleCount(), 1U);
}

TEST_F(Lifecycle, QueriesKeepTheInputHandleValidAndCreateNoHandles) {
  const ShapeHandle a = aBox();
  ok(kernel.tessellate(a, kQuality));
  ok(kernel.boundingBox(a));
  ok(kernel.topology(a));
  EXPECT_EQ(kernel.liveHandleCount(), 1U);
  expectEnclosesBox(ok(kernel.boundingBox(a)), kOrigin, kBoxMax);
}

TEST_F(Lifecycle, ChangingAReturnedBoundingBoxChangesNothing) {
  const ShapeHandle a = aBox();
  BoundingBox first = ok(kernel.boundingBox(a));
  first.min[0] = 100;
  first.max = {0, 0, 0};
  expectEnclosesBox(ok(kernel.boundingBox(a)), kOrigin, kBoxMax);
}

TEST_F(Lifecycle, ChangingMakeBoxInputsAfterwardsDoesNotChangeTheShape) {
  BoxInput input = kBox;
  const ShapeHandle a = ok(kernel.makeBox(input)).shape;
  input.origin[0] = 100;
  input.size[2] = 100;
  expectEnclosesBox(ok(kernel.boundingBox(a)), kOrigin, kBoxMax);
}

TEST_F(Lifecycle, DestroyingTheKernelFreesEveryShape) {
  // RAII (N14): a kernel with live shapes goes out of scope without a release.
  auto other = std::make_unique<OcctKernel>();
  ok(other->makeBox(kBox));
  ok(other->makeCylinder(kCylinder));
  EXPECT_EQ(other->liveHandleCount(), 2U);
  other.reset();
  SUCCEED();
}

}  // namespace
}  // namespace tinycad::kernel
