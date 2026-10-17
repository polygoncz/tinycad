// Cylinder, transform and boolean: the contract blocks `makeCylinder`, `transform` and `boolean`
// of src/kernel/testing.ts and test/unit/kernel-occt/occt-modeling.test.ts.

#include <gtest/gtest.h>

#include <cmath>
#include <limits>
#include <string>
#include <vector>

#include "kernel_test_support.hpp"

namespace tinycad::kernel {
namespace {

using namespace test;  // NOLINT(google-build-using-namespace): the fixtures of the suite

constexpr double kNaN = std::numeric_limits<double>::quiet_NaN();
constexpr double kInf = std::numeric_limits<double>::infinity();
constexpr MeshQuality kFine{0.01, 0.1};

class Modeling : public ::testing::Test {
 protected:
  ShapeHandle aBox(const BoxInput& box = kBox) { return ok(kernel.makeBox(box)).shape; }

  /** One new handle with bounding box [min, max] and a valid mesh inside it. */
  void expectResult(BooleanOp op, std::vector<ShapeHandle> targets, std::vector<ShapeHandle> tools,
                    const Vec3& min, const Vec3& max) {
    const std::size_t before = kernel.liveHandleCount();
    const ShapeHandle shape = ok(kernel.boolean(op, targets, tools)).shape;
    for (const ShapeHandle h : targets) EXPECT_NE(shape, h);
    for (const ShapeHandle h : tools) EXPECT_NE(shape, h);
    EXPECT_EQ(kernel.liveHandleCount(), before + 1);
    expectBoxClose(ok(kernel.boundingBox(shape)), min, max, "boolean result");
    expectValidMeshIn(ok(kernel.tessellate(shape, kQuality)), min, max, "boolean result");
  }

  OcctKernel kernel;
};

// --- makeCylinder -----------------------------------------------------------------------------

TEST_F(Modeling, ACylinderHasTheBoundingBoxOfItsAxis) {
  const std::vector<std::tuple<Vec3, Vec3, Vec3>> cases{
      {{1, 0, 0}, {1, -4, 1}, {5, 0, 5}},
      {{0, 1, 0}, {-1, -2, 1}, {3, 2, 5}},
      {{0, 0, 2}, kCylinderMin, kCylinderMax},
  };
  for (const auto& [axis, min, max] : cases) {
    OcctKernel fresh;
    const ShapeHandle shape = ok(fresh.makeCylinder({kOrigin, axis, 2, 4})).shape;
    EXPECT_GT(static_cast<std::uint64_t>(shape), 0U);
    EXPECT_EQ(fresh.liveHandleCount(), 1U);
    expectBoxClose(ok(fresh.boundingBox(shape)), min, max);
  }
}

TEST_F(Modeling, TheMeshOfACylinderIsValidAndInItsBoundingBox) {
  const ShapeHandle shape = ok(kernel.makeCylinder(kCylinder)).shape;
  expectValidMeshIn(ok(kernel.tessellate(shape, kQuality)), kCylinderMin, kCylinderMax, "cylinder");
}

TEST_F(Modeling, InvalidCylinderInputsFailWithInvalidInputAndCreateNoHandle) {
  const auto with = [](auto change) {
    CylinderInput p = kCylinder;
    change(p);
    return p;
  };
  const std::vector<CylinderInput> cases{
      with([](CylinderInput& p) { p.base = {kNaN, 0, 0}; }),
      with([](CylinderInput& p) { p.base = {0, kInf, 0}; }),
      with([](CylinderInput& p) { p.axis = {0, 0, kNaN}; }),
      with([](CylinderInput& p) { p.axis = {-kInf, 0, 1}; }),
      with([](CylinderInput& p) { p.axis = {0, 0, 0}; }),
      with([](CylinderInput& p) { p.axis = {1e-10, 0, 0}; }),
      with([](CylinderInput& p) { p.radius = 0; }),
      with([](CylinderInput& p) { p.radius = -1; }),
      with([](CylinderInput& p) { p.radius = kNaN; }),
      with([](CylinderInput& p) { p.radius = kInf; }),
      with([](CylinderInput& p) { p.height = 0; }),
      with([](CylinderInput& p) { p.height = -1; }),
      with([](CylinderInput& p) { p.height = kNaN; }),
      with([](CylinderInput& p) { p.height = kInf; }),
  };
  for (std::size_t i = 0; i < cases.size(); ++i) {
    EXPECT_EQ(codeOf(kernel.makeCylinder(cases[i])), KernelErrorCode::InvalidInput) << "case " << i;
    EXPECT_EQ(kernel.liveHandleCount(), 0U);
  }
}

// --- transform --------------------------------------------------------------------------------

TEST_F(Modeling, ATranslationMovesTheBoundingBox) {
  const ShapeHandle a = aBox();
  const ShapeHandle shape = ok(kernel.transform(a, translation({10, 0, -5}))).shape;
  EXPECT_NE(shape, a);
  EXPECT_EQ(kernel.liveHandleCount(), 2U);
  expectBoxClose(ok(kernel.boundingBox(shape)), {11, -2, -2}, {13, 1, 2});
}

TEST_F(Modeling, ARotationBy90DegreesAboutZTurnsTheBoundingBox) {
  const ShapeHandle shape =
      ok(kernel.transform(aBox(), rotationAxisAngle({0, 0, 1}, std::numbers::pi / 2))).shape;
  // (x, y) → (−y, x): x in [1, 3], y in [−2, 1] gives x' in [−1, 2], y' in [1, 3].
  expectBoxClose(ok(kernel.boundingBox(shape)), {-1, 1, 3}, {2, 3, 7});
}

TEST_F(Modeling, ARotationBy45DegreesGivesTheBoundingBoxOfTheTurnedCorners) {
  const ShapeHandle shape =
      ok(kernel.transform(aBox(), rotationAxisAngle({0, 0, 1}, std::numbers::pi / 4))).shape;
  const double s = std::numbers::sqrt2 / 2;
  expectBoxClose(ok(kernel.boundingBox(shape)), {0, -s, 3}, {5 * s, 4 * s, 7});
}

TEST_F(Modeling, TheInputOfATransformStaysValid) {
  const ShapeHandle a = aBox();
  ok(kernel.transform(a, translation({10, 0, 0})));
  expectEnclosesBox(ok(kernel.boundingBox(a)), kOrigin, kBoxMax);
  EXPECT_EQ(kernel.liveHandleCount(), 2U);
}

TEST_F(Modeling, TheMeshOfAMovedBoxIsValidAndInItsBoundingBox) {
  const Mat4 m =
      multiply(translation({0, 0, 1}), rotationAxisAngle({0, 0, 1}, std::numbers::pi / 4));
  const ShapeHandle shape = ok(kernel.transform(aBox(), m)).shape;
  const double s = std::numbers::sqrt2 / 2;
  expectValidMeshIn(ok(kernel.tessellate(shape, kQuality)), {0, -s, 4}, {5 * s, 4 * s, 8},
                    "moved box");
}

TEST_F(Modeling, ANonRigidMatrixFailsWithInvalidInputAndCreatesNoHandle) {
  const double nan = kNaN;
  const std::vector<Mat4> cases{
      fromRows({1, 0.5, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1}),
      fromRows({-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1}),
      fromRows({2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1}),
      fromRows({1, 0, 0, nan, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1}),
      fromRows({1, 0, 0, 0, 0, 1, 0, kInf, 0, 0, 1, 0, 0, 0, 0, 1}),
      fromRows({1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0.1, 0, 0, 1}),
  };
  const ShapeHandle a = aBox();
  for (const Mat4& m : cases) {
    EXPECT_EQ(codeOf(kernel.transform(a, m)), KernelErrorCode::InvalidInput);
    EXPECT_EQ(kernel.liveHandleCount(), 1U);
  }
}

// --- boolean ----------------------------------------------------------------------------------

TEST_F(Modeling, UnionOfTwoOverlappingBoxesHasTheirEnclosingBoundingBox) {
  const ShapeHandle tool = aBox(kOverlapping);
  expectResult(BooleanOp::Union, {aBox()}, {tool}, kOrigin, {4, 2, 9});
}

TEST_F(Modeling, UnionOfTwoSeparateBoxesHasTheirEnclosingBoundingBox) {
  const ShapeHandle tool = aBox(kSeparate);
  expectResult(BooleanOp::Union, {aBox()}, {tool}, {1, -2, 0}, {11, 1, 7});
}

TEST_F(Modeling, IntersectOfTwoOverlappingBoxesIsExactlyTheirCommonPart) {
  const ShapeHandle tool = aBox(kOverlapping);
  expectResult(BooleanOp::Intersect, {aBox()}, {tool}, {2, 0, 5}, {3, 1, 7});
}

TEST_F(Modeling, IntersectOfTwoSeparateBoxesFailsWithOperationFailed) {
  const ShapeHandle a = aBox();
  const ShapeHandle b = aBox(kSeparate);
  EXPECT_EQ(codeOf(kernel.boolean(BooleanOp::Intersect, std::span(&a, 1), std::span(&b, 1))),
            KernelErrorCode::OperationFailed);
  EXPECT_EQ(kernel.liveHandleCount(), 2U);
}

TEST_F(Modeling, SubtractOfABoxCuttingACornerKeepsTheBoundingBoxOfTheTarget) {
  const ShapeHandle tool = aBox(kCorner);
  expectResult(BooleanOp::Subtract, {aBox()}, {tool}, kOrigin, kBoxMax);
}

TEST_F(Modeling, SeveralTargetsAndTools) {
  // Union of three boxes; then the box minus the overlapping and the corner box at once.
  const ShapeHandle a = aBox();
  const ShapeHandle b = aBox(kOverlapping);
  const ShapeHandle c = aBox(kSeparate);
  expectResult(BooleanOp::Union, {a, b}, {c}, {1, -2, 0}, {11, 2, 9});
  expectResult(BooleanOp::Subtract, {a}, {aBox(kCorner), aBox({{0, 0, 0}, {1.5, 0.5, 4}})}, kOrigin,
               kBoxMax);
}

TEST_F(Modeling, TheInputsOfABooleanStayValid) {
  const ShapeHandle a = aBox();
  const ShapeHandle b = aBox(kOverlapping);
  for (const BooleanOp op : {BooleanOp::Union, BooleanOp::Subtract, BooleanOp::Intersect}) {
    ok(kernel.boolean(op, std::span(&a, 1), std::span(&b, 1)));
  }
  EXPECT_EQ(kernel.liveHandleCount(), 5U);
  expectEnclosesBox(ok(kernel.boundingBox(a)), kOrigin, kBoxMax, "target");
  expectEnclosesBox(ok(kernel.boundingBox(b)), {2, 0, 5}, {4, 2, 9}, "tool");
}

TEST_F(Modeling, InvalidBooleanArgumentsFailWithInvalidInput) {
  const ShapeHandle a = aBox();
  const ShapeHandle b = aBox(kOverlapping);
  const std::vector<ShapeHandle> none;
  const std::vector<ShapeHandle> ab{a, b};
  const std::vector<ShapeHandle> aa{a, a};
  const std::vector<ShapeHandle> bb{b, b};
  const std::vector<ShapeHandle> justA{a};
  const std::vector<ShapeHandle> justB{b};
  EXPECT_EQ(codeOf(kernel.boolean(BooleanOp::Union, none, ab)), KernelErrorCode::InvalidInput);
  EXPECT_EQ(codeOf(kernel.boolean(BooleanOp::Union, ab, none)), KernelErrorCode::InvalidInput);
  EXPECT_EQ(codeOf(kernel.boolean(BooleanOp::Union, aa, justB)), KernelErrorCode::InvalidInput);
  EXPECT_EQ(codeOf(kernel.boolean(BooleanOp::Subtract, justA, bb)), KernelErrorCode::InvalidInput);
  EXPECT_EQ(codeOf(kernel.boolean(BooleanOp::Intersect, justA, justA)),
            KernelErrorCode::InvalidInput);
  // An op outside the enum – a cast from a number can pass it.
  EXPECT_EQ(codeOf(kernel.boolean(static_cast<BooleanOp>(7), justA, justB)),
            KernelErrorCode::InvalidInput);
  EXPECT_EQ(kernel.liveHandleCount(), 2U);
}

// --- test/unit/kernel-occt/occt-modeling.test.ts ----------------------------------------------

TEST_F(Modeling, ACylinderHasThreeFacesAndTheVolumePiR2H) {
  const ShapeHandle shape = ok(kernel.makeCylinder({{1, 2, 3}, {1, 1, 1}, 2, 5})).shape;
  const MeshData mesh = ok(kernel.tessellate(shape, kFine));
  EXPECT_EQ(validateMeshData(mesh), std::vector<std::string>{});
  EXPECT_EQ(faceCount(mesh), 3U);
  expectWithinPercent(volume(mesh), std::numbers::pi * 4 * 5, 1);
}

TEST_F(Modeling, AMovedAndTurnedBoxKeepsSixFacesAndItsVolume) {
  const ShapeHandle box = ok(kernel.makeBox({{1, -2, 3}, {2, 3, 4}})).shape;
  const Mat4 m = multiply(translation({5, -1, 2}), rotationAxisAngle({1, 2, 3}, 0.7));
  const MeshData mesh = ok(kernel.tessellate(ok(kernel.transform(box, m)).shape, kFine));
  EXPECT_EQ(validateMeshData(mesh), std::vector<std::string>{});
  EXPECT_EQ(faceCount(mesh), 6U);
  expectWithinPercent(volume(mesh), 24, 1e-4);
}

TEST_F(Modeling, ABoxMinusACylinderThroughItHasSevenFaces) {
  const ShapeHandle box = ok(kernel.makeBox({{0, 0, 0}, {10, 10, 10}})).shape;
  const ShapeHandle hole = ok(kernel.makeCylinder({{5, 5, -1}, {0, 0, 1}, 2, 12})).shape;
  const ShapeHandle shape =
      ok(kernel.boolean(BooleanOp::Subtract, std::span(&box, 1), std::span(&hole, 1))).shape;
  const MeshData mesh = ok(kernel.tessellate(shape, kFine));
  EXPECT_EQ(validateMeshData(mesh), std::vector<std::string>{});
  EXPECT_EQ(faceCount(mesh), 7U);
  expectWithinPercent(volume(mesh), 1000 - std::numbers::pi * 4 * 10, 1);
}

TEST_F(Modeling, SubtractWithAToolCoveringTheWholeTargetFailsWithOperationFailed) {
  const ShapeHandle target = ok(kernel.makeBox({{1, 1, 1}, {1, 1, 1}})).shape;
  const ShapeHandle tool = ok(kernel.makeBox({{0, 0, 0}, {3, 3, 3}})).shape;
  EXPECT_EQ(codeOf(kernel.boolean(BooleanOp::Subtract, std::span(&target, 1), std::span(&tool, 1))),
            KernelErrorCode::OperationFailed);
  EXPECT_EQ(kernel.liveHandleCount(), 2U);
}

TEST_F(Modeling, UnionOfTwoSeparateBoxesHasTwelveFaces) {
  const ShapeHandle a = ok(kernel.makeBox({{0, 0, 0}, {1, 1, 1}})).shape;
  const ShapeHandle b = ok(kernel.makeBox({{5, 0, 0}, {1, 1, 1}})).shape;
  const ShapeHandle shape =
      ok(kernel.boolean(BooleanOp::Union, std::span(&a, 1), std::span(&b, 1))).shape;
  const MeshData mesh = ok(kernel.tessellate(shape, kFine));
  EXPECT_EQ(validateMeshData(mesh), std::vector<std::string>{});
  EXPECT_EQ(faceCount(mesh), 12U);
}

TEST_F(Modeling, ReleasingTheInputOfATransformLeavesTheResultValid) {
  const ShapeHandle box = ok(kernel.makeBox({{0, 0, 0}, {1, 2, 3}})).shape;
  const ShapeHandle moved = ok(kernel.transform(box, translation({10, 0, 0}))).shape;
  ok(kernel.release(std::span(&box, 1)));
  const MeshData mesh = ok(kernel.tessellate(moved, kFine));
  EXPECT_EQ(validateMeshData(mesh), std::vector<std::string>{});
  expectWithinPercent(volume(mesh), 6, 1e-4);
}

}  // namespace
}  // namespace tinycad::kernel
