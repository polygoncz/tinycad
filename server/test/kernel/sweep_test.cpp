// Extrude and revolve: the contract blocks `extrude` and `revolve` of src/kernel/testing.ts and
// test/unit/kernel-occt/occt-sweep.test.ts.

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
constexpr MeshQuality kFine{0.01, 0.05};

/** Rectangle x ∈ [0, 2], z ∈ [0, 3] in XZ. */
FaceInput rectangleXZ() { return faceOf(kPlaneXZ, polygon({{0, 0}, {2, 0}, {2, 3}, {0, 3}})); }

/** Rectangle x ∈ [x0, x1], z ∈ [0, 10] in XZ. */
FaceInput rectangleXZ(double x0, double x1) {
  return faceOf(kPlaneXZ, polygon({{x0, 0}, {x1, 0}, {x1, 10}, {x0, 10}}));
}

class Sweep : public ::testing::Test {
 protected:
  ShapeHandle aProfile(const FaceInput& face = square10()) {
    return ok(kernel.makeFace(face)).shape;
  }

  MeshData meshOf(ShapeHandle shape) {
    MeshData mesh = ok(kernel.tessellate(shape, kFine));
    EXPECT_EQ(validateMeshData(mesh), std::vector<std::string>{});
    return mesh;
  }

  OcctKernel kernel;
};

// --- extrude ----------------------------------------------------------------------------------

TEST_F(Sweep, AnExtrudeHasTheSweptBoundingBoxAndAValidMesh) {
  const std::vector<std::tuple<FaceInput, Vec3, double, Vec3, Vec3>> cases{
      {square10(), {0, 0, 1}, 5, {0, 0, 0}, {10, 10, 5}},
      {square10(), {0, 0, 3}, 5, {0, 0, 0}, {10, 10, 5}},
      {square10(), {0, 0, -1}, 5, {0, 0, -5}, {10, 10, 0}},
      {rectangleXZ(), {0, -1, 0}, 4, {0, -4, 0}, {2, 0, 3}},
  };
  for (const auto& [face, direction, distance, min, max] : cases) {
    OcctKernel fresh;
    const ShapeHandle profile = ok(fresh.makeFace(face)).shape;
    const ShapeHandle shape = ok(fresh.extrude(profile, direction, distance)).shape;
    EXPECT_NE(shape, profile);
    EXPECT_EQ(fresh.liveHandleCount(), 2U);
    expectBoxClose(ok(fresh.boundingBox(shape)), min, max, "prism");
    expectValidMeshIn(ok(fresh.tessellate(shape, kQuality)), min, max, "prism");
  }
}

TEST_F(Sweep, TheProfileStaysValidAndEveryExtrudeReturnsANewHandle) {
  const ShapeHandle profile = aProfile();
  const ShapeHandle a = ok(kernel.extrude(profile, {0, 0, 1}, 5)).shape;
  const ShapeHandle b = ok(kernel.extrude(profile, {0, 0, 1}, 5)).shape;
  EXPECT_NE(a, b);
  EXPECT_EQ(kernel.liveHandleCount(), 3U);
  expectBoxClose(ok(kernel.boundingBox(profile)), {0, 0, 0}, {10, 10, 0}, "profile");
}

TEST_F(Sweep, AMovedProfileIsAFaceToo) {
  const ShapeHandle moved = ok(kernel.transform(aProfile(), translation({0, 0, 7}))).shape;
  const ShapeHandle shape = ok(kernel.extrude(moved, {0, 0, 1}, 5)).shape;
  expectBoxClose(ok(kernel.boundingBox(shape)), {0, 0, 7}, {10, 10, 12}, "prism");
}

TEST_F(Sweep, InvalidExtrudeInputsFailWithInvalidInput) {
  const ShapeHandle profile = aProfile();
  const std::vector<std::pair<Vec3, double>> cases{{{0, 0, 1}, 0},    {{0, 0, 1}, -5},
                                                   {{0, 0, 1}, kNaN}, {{0, 0, 1}, kInf},
                                                   {{0, 0, 0}, 5},    {{0, kNaN, 1}, 5}};
  for (const auto& [direction, distance] : cases) {
    EXPECT_EQ(codeOf(kernel.extrude(profile, direction, distance)), KernelErrorCode::InvalidInput);
    EXPECT_EQ(kernel.liveHandleCount(), 1U);
  }
}

TEST_F(Sweep, AProfileThatIsNotAFaceFailsWithInvalidInput) {
  const ShapeHandle box = ok(kernel.makeBox(kBox)).shape;
  EXPECT_EQ(codeOf(kernel.extrude(box, {0, 0, 1}, 5)), KernelErrorCode::InvalidInput);
  const ShapeHandle prism = ok(kernel.extrude(aProfile(), {0, 0, 1}, 5)).shape;
  EXPECT_EQ(codeOf(kernel.extrude(prism, {0, 0, 1}, 5)), KernelErrorCode::InvalidInput);
  EXPECT_EQ(kernel.liveHandleCount(), 3U);
}

// --- revolve ----------------------------------------------------------------------------------

TEST_F(Sweep, ARevolvedRectangleHasItsBoundingBoxAndAValidMesh) {
  const std::vector<std::tuple<Axis, double, Vec3, Vec3>> cases{
      {kZAxis, kTurn, {-10, -10, 0}, {10, 10, 10}},
      {kZAxis, kTurn / 4, {0, 0, 0}, {10, 10, 10}},
      {{{0, 0, 0}, {0, 0, -1}}, kTurn / 4, {0, -10, 0}, {10, 0, 10}},
      {{{0, 0, 0}, {0, 0, 4}}, kTurn / 4, {0, 0, 0}, {10, 10, 10}},
  };
  for (const auto& [axis, angle, min, max] : cases) {
    OcctKernel fresh;
    const ShapeHandle profile = ok(fresh.makeFace(ringProfile())).shape;
    const ShapeHandle shape = ok(fresh.revolve(profile, axis, angle)).shape;
    EXPECT_NE(shape, profile);
    EXPECT_EQ(fresh.liveHandleCount(), 2U);
    expectBoxClose(ok(fresh.boundingBox(shape)), min, max, "revolved");
    expectValidMeshIn(ok(fresh.tessellate(shape, kQuality)), min, max, "revolved");
  }
}

TEST_F(Sweep, TheProfileOfARevolveStaysValid) {
  const ShapeHandle profile = aProfile(ringProfile());
  ok(kernel.revolve(profile, kZAxis, kTurn));
  expectBoxClose(ok(kernel.boundingBox(profile)), {5, 0, 0}, {10, 0, 10}, "profile");
  EXPECT_EQ(kernel.liveHandleCount(), 2U);
}

TEST_F(Sweep, AnAngleJustAbove2PiWithinTheToleranceIsAFullTurn) {
  const ShapeHandle shape =
      ok(kernel.revolve(aProfile(ringProfile()), kZAxis, kTurn + 1e-10)).shape;
  expectBoxClose(ok(kernel.boundingBox(shape)), {-10, -10, 0}, {10, 10, 10}, "revolved");
}

TEST_F(Sweep, InvalidRevolveInputsFailWithInvalidInput) {
  const ShapeHandle profile = aProfile(ringProfile());
  const std::vector<std::pair<Axis, double>> cases{
      {kZAxis, 0},
      {kZAxis, -1},
      {kZAxis, kTurn + 1e-6},
      {kZAxis, kNaN},
      {{{0, 0, 0}, {0, 0, 0}}, kTurn},
      {{{kInf, 0, 0}, {0, 0, 1}}, kTurn},
  };
  for (const auto& [axis, angle] : cases) {
    EXPECT_EQ(codeOf(kernel.revolve(profile, axis, angle)), KernelErrorCode::InvalidInput);
    EXPECT_EQ(kernel.liveHandleCount(), 1U);
  }
}

TEST_F(Sweep, ARevolvedProfileThatIsNotAFaceFailsWithInvalidInput) {
  const ShapeHandle box = ok(kernel.makeBox(kBox)).shape;
  EXPECT_EQ(codeOf(kernel.revolve(box, kZAxis, kTurn)), KernelErrorCode::InvalidInput);
  EXPECT_EQ(kernel.liveHandleCount(), 1U);
}

// --- test/unit/kernel-occt/occt-sweep.test.ts -------------------------------------------------

TEST_F(Sweep, APrismOfASquareHasSixFacesAndTheVolume500) {
  const MeshData mesh = meshOf(ok(kernel.extrude(aProfile(), {0, 0, 1}, 5)).shape);
  EXPECT_EQ(faceCount(mesh), 6U);
  expectWithinPercent(volume(mesh), 500, 1);
}

TEST_F(Sweep, APrismOfASquareWithACircularHoleHasSevenFaces) {
  const ShapeHandle face = aProfile(
      faceOf(kPlaneXY, polygon({{0, 0}, {10, 0}, {10, 10}, {0, 10}}), {{circle({5, 5}, 2)}}));
  const MeshData mesh = meshOf(ok(kernel.extrude(face, {0, 0, 1}, 5)).shape);
  EXPECT_EQ(faceCount(mesh), 7U);
  expectWithinPercent(volume(mesh), (100 - 4 * std::numbers::pi) * 5, 1);
}

TEST_F(Sweep, ReleasingTheProfileLeavesThePrismValid) {
  const ShapeHandle face = aProfile();
  const ShapeHandle shape = ok(kernel.extrude(face, {0, 0, 1}, 5)).shape;
  ok(kernel.release(std::span(&face, 1)));
  expectWithinPercent(volume(meshOf(shape)), 500, 1);
}

TEST_F(Sweep, ARectangleRevolvedByAFullTurnHasFourFacesAndTheVolume750Pi) {
  const MeshData mesh =
      meshOf(ok(kernel.revolve(aProfile(rectangleXZ(5, 10)), kZAxis, kTurn)).shape);
  EXPECT_EQ(faceCount(mesh), 4U);
  expectWithinPercent(volume(mesh), 750 * std::numbers::pi, 1);
}

TEST_F(Sweep, TheSameRectangleByAQuarterTurnHasSixFacesAndAQuarterOfTheVolume) {
  const MeshData mesh =
      meshOf(ok(kernel.revolve(aProfile(rectangleXZ(5, 10)), kZAxis, kTurn / 4)).shape);
  EXPECT_EQ(faceCount(mesh), 6U);
  expectWithinPercent(volume(mesh), 750 * std::numbers::pi / 4, 1);
}

TEST_F(Sweep, AnAxisOnAnEdgeOfTheProfileIsValid) {
  const MeshData mesh =
      meshOf(ok(kernel.revolve(aProfile(rectangleXZ(0, 5)), kZAxis, kTurn)).shape);
  expectWithinPercent(volume(mesh), 250 * std::numbers::pi, 1);
}

TEST_F(Sweep, AnAxisThroughTheProfileFailsWithOperationFailed) {
  const ShapeHandle face = aProfile(rectangleXZ(-5, 10));
  EXPECT_EQ(codeOf(kernel.revolve(face, kZAxis, kTurn)), KernelErrorCode::OperationFailed);
  EXPECT_EQ(kernel.liveHandleCount(), 1U);
}

TEST_F(Sweep, ACircleExtrudedHasThreeFacesAndTheVolume2Pi) {
  const ShapeHandle face = aProfile(faceOf(kPlaneXY, {circle({0, 0}, 1)}));
  const MeshData mesh = ok(kernel.tessellate(ok(kernel.extrude(face, {0, 0, 1}, 2)).shape, kFine));
  EXPECT_EQ(faceCount(mesh), 3U);
  expectWithinPercent(volume(mesh), 2 * std::numbers::pi, 1);
}

}  // namespace
}  // namespace tinycad::kernel
