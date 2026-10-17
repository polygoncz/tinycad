// The planar face: the contract block `makeFace` of src/kernel/testing.ts and
// test/unit/kernel-occt/occt-sketch.test.ts (real areas by BRepGProp over the internal table).

#include <BRepGProp.hxx>
#include <GProp_GProps.hxx>
#include <gtest/gtest.h>

#include <cmath>
#include <string>
#include <vector>

#include "kernel_test_support.hpp"
#include "operations.hpp"
#include "shape_table.hpp"

namespace tinycad::kernel {
namespace {

using namespace test;  // NOLINT(google-build-using-namespace): the fixtures of the suite
using core::Curve2;

const ProfileLoop kSquare = polygon({{1, 2}, {4, 2}, {4, 5}, {1, 5}});

/** Line (0, −1)–(0, 1) and a half circle back: through (−1, 0) when ccw, else (1, 0). */
ProfileLoop dLoop(bool ccw) { return {line({0, -1}, {0, 1}), arc({0, 0}, {0, 1}, {0, -1}, ccw)}; }

/** Rectangle [0, 4]×[0, 3] whose right side is a quadratic spline bulging to x = 5. */
ProfileLoop splineLoop() {
  return {line({0, 0}, {4, 0}), Curve2::bspline(2, {{4, 0}, {6, 1.5}, {4, 3}}, {0, 0, 0, 1, 1, 1}),
          line({4, 3}, {0, 3}), line({0, 3}, {0, 0})};
}

class Face : public ::testing::Test {
 protected:
  OcctKernel kernel;
};

TEST_F(Face, ValidFacesHaveTheBoundingBoxOfTheOuterLoopAndAValidMesh) {
  const core::Plane xzAtY5{{0, 5, 0}, {1, 0, 0}, {0, -1, 0}};
  const core::Plane yzAtX3{{3, 0, 0}, {0, 1, 0}, {1, 0, 0}};
  const std::vector<std::tuple<std::string, FaceInput, Vec3, Vec3>> cases{
      {"a square in XY", faceOf(kPlaneXY, kSquare), {1, 2, 0}, {4, 5, 0}},
      {"a rectangle in XZ moved to y = 5",
       faceOf(xzAtY5, polygon({{0, 0}, {2, 0}, {2, 3}, {0, 3}})),
       {0, 5, 0},
       {2, 5, 3}},
      {"a circle in YZ moved to x = 3",
       faceOf(yzAtX3, {circle({1, 2}, 0.5)}),
       {3, 0.5, 1.5},
       {3, 1.5, 2.5}},
      {"a D, ccw", faceOf(kPlaneXY, dLoop(true)), {-1, -1, 0}, {0, 1, 0}},
      {"a D, clockwise", faceOf(kPlaneXY, dLoop(false)), {0, -1, 0}, {1, 1, 0}},
      {"a square with a circular hole",
       faceOf(kPlaneXY, polygon({{0, 0}, {4, 0}, {4, 4}, {0, 4}}), {{circle({2, 2}, 1)}}),
       {0, 0, 0},
       {4, 4, 0}},
      {"a square in reverse orientation",
       faceOf(kPlaneXY, polygon({{1, 2}, {1, 5}, {4, 5}, {4, 2}})),
       {1, 2, 0},
       {4, 5, 0}},
      {"a rectangle with a spline side", faceOf(kPlaneXY, splineLoop()), {0, 0, 0}, {5, 3, 0}},
  };
  for (const auto& [name, input, min, max] : cases) {
    OcctKernel fresh;
    const ShapeHandle shape = ok(fresh.makeFace(input)).shape;
    EXPECT_EQ(fresh.liveHandleCount(), 1U) << name;
    expectBoxClose(ok(fresh.boundingBox(shape)), min, max, name);
    expectValidMeshIn(ok(fresh.tessellate(shape, kQuality)), min, max, name);
  }
}

TEST_F(Face, EveryCallReturnsANewHandle) {
  const ShapeHandle a = ok(kernel.makeFace(faceOf(kPlaneXY, kSquare))).shape;
  const ShapeHandle b = ok(kernel.makeFace(faceOf(kPlaneXY, kSquare))).shape;
  EXPECT_NE(a, b);
  EXPECT_EQ(kernel.liveHandleCount(), 2U);
}

TEST_F(Face, InvalidInputsFailWithInvalidInputAndCreateNoHandle) {
  ProfileLoop withCircle{kSquare[0], kSquare[1], circle({2, 3}, 0.5), kSquare[2], kSquare[3]};
  ProfileLoop zeroLine = kSquare;
  zeroLine.push_back(line({1, 2}, {1, 2}));
  ProfileLoop shortKnots = splineLoop();
  shortKnots[1].knots.erase(shortKnots[1].knots.begin());
  const std::vector<std::pair<std::string, FaceInput>> cases{
      {"a plane that is not orthonormal", faceOf({{0, 0, 0}, {2, 0, 0}, {0, 0, 1}}, kSquare)},
      {"an open loop", faceOf(kPlaneXY, {kSquare[0], kSquare[1], kSquare[2]})},
      {"a circle in the middle of a loop of several curves", faceOf(kPlaneXY, withCircle)},
      {"a line of zero length", faceOf(kPlaneXY, zeroLine)},
      {"an arc with unequal radii",
       faceOf(kPlaneXY, {line({0, -1}, {0, 1.5}), arc({0, 0}, {0, 1.5}, {0, -1}, true)})},
      {"an empty outer loop", faceOf(kPlaneXY, {})},
      {"a spline with too few knots", faceOf(kPlaneXY, shortKnots)},
  };
  for (const auto& [name, input] : cases) {
    EXPECT_EQ(codeOf(kernel.makeFace(input)), KernelErrorCode::InvalidInput) << name;
    EXPECT_EQ(kernel.liveHandleCount(), 0U) << name;
  }
}

// --- test/unit/kernel-occt/occt-sketch.test.ts ------------------------------------------------

/** A cubic spline from (4, 3) to (0, 3) with an interior knot, waving above and below y = 3. */
Curve2 wave() {
  return Curve2::bspline(3, {{4, 3}, {3, 5}, {2, 1.5}, {1, 4.5}, {0, 3}},
                         {0, 0, 0, 0, 0.4, 1, 1, 1, 1});
}

/** The area of the face by BRepGProp, the adaptive variant with a relative precision (M29). */
double areaOf(const FaceInput& input) {
  detail::ShapeTable table;
  const ShapeHandle handle = detail::makeFaceShape(table, input).shape;
  GProp_GProps props;
  BRepGProp::SurfaceProperties(table.find(handle).shape(), props, 1e-9, false);
  return props.Mass();
}

/** The rectangle [0, 4]×[0, 3] with `top` as its top side from (4, 3) to (0, 3). */
ProfileLoop withTop(const Curve2& top) {
  return {line({0, 0}, {4, 0}), line({4, 0}, {4, 3}), top, line({0, 3}, {0, 0})};
}

/** The area of withTop(top), the spline densely sampled. */
double areaWithTop(const Curve2& top) {
  std::vector<Vec2> points{{0, 0}, {4, 0}};
  const std::vector<Vec2> sampled = splinePoints(top, 20000);
  points.insert(points.end(), sampled.begin(), sampled.end());
  return polygonArea(points);
}

TEST_F(Face, AFaceHasOneFaceInItsMesh) {
  const ShapeHandle shape =
      ok(kernel.makeFace(
             faceOf(kPlaneXY, polygon({{0, 0}, {4, 0}, {4, 4}, {0, 4}}), {{circle({2, 2}, 1)}})))
          .shape;
  const MeshData mesh = ok(kernel.tessellate(shape, {0.01, 0.1}));
  EXPECT_EQ(validateMeshData(mesh), std::vector<std::string>{});
  EXPECT_EQ(faceCount(mesh), 1U);
}

TEST_F(Face, TheAreaOfASquareWithACircularHole) {
  expectRelativelyClose(
      areaOf(faceOf(kPlaneXY, polygon({{0, 0}, {4, 0}, {4, 4}, {0, 4}}), {{circle({2, 2}, 1)}})),
      16 - std::numbers::pi, 1e-6);
}

TEST_F(Face, TheHoleMayHaveEitherOrientation) {
  expectRelativelyClose(areaOf(faceOf(kPlaneXY, polygon({{0, 0}, {4, 0}, {4, 4}, {0, 4}}),
                                      {polygon({{1, 1}, {1, 3}, {3, 3}, {3, 1}}),
                                       polygon({{3.5, 0.5}, {3.8, 0.5}, {3.8, 0.8}})})),
                        16 - 4 - 0.045, 1e-6);
}

TEST_F(Face, TheAreaOfADIsTheRectanglePlusOrMinusTheHalfCircle) {
  const auto d = [](bool ccw) {
    return faceOf(kPlaneXY, {line({-2, -1}, {0, -1}), arc({0, 0}, {0, -1}, {0, 1}, ccw),
                             line({0, 1}, {-2, 1}), line({-2, 1}, {-2, -1})});
  };
  expectRelativelyClose(areaOf(d(true)), 4 + std::numbers::pi / 2, 1e-6);
  expectRelativelyClose(areaOf(d(false)), 4 - std::numbers::pi / 2, 1e-6);
}

TEST_F(Face, AFaceInAMovedTiltedPlaneKeepsItsArea) {
  const double s = std::numbers::sqrt2 / 2;
  expectRelativelyClose(
      areaOf(faceOf({{1, 2, 3}, {s, s, 0}, {0, 0, 1}}, polygon({{0, 0}, {3, 0}, {3, 2}, {0, 2}}))),
      6, 1e-6);
}

TEST_F(Face, ARectangleWithASplineSideHasTheAreaOfAFineTessellation) {
  expectRelativelyClose(areaOf(faceOf(kPlaneXY, withTop(wave()))), areaWithTop(wave()), 1e-6);
}

TEST_F(Face, ASplineHoleInAMovedTiltedPlane) {
  const double s = std::numbers::sqrt2 / 2;
  const double area =
      areaOf(faceOf({{1, 2, 3}, {s, 0, s}, {-s, 0, s}},
                    polygon({{-1, -1}, {5, -1}, {5, 6}, {-1, 6}}), {withTop(wave())}));
  expectRelativelyClose(area, 42 - areaWithTop(wave()), 1e-6);
}

TEST_F(Face, SplinesWithUnusualKnotVectorsBuild) {
  for (const std::vector<double>& knots :
       {std::vector<double>{2, 2, 2, 2, 3, 3, 5, 7, 7, 7, 7},
        std::vector<double>{0, 0, 0, 0, 0.5, 0.5, 0.5, 1, 1, 1, 1}}) {
    const Curve2 side =
        Curve2::bspline(3, {{4, 3}, {3.5, 4}, {3, 2.5}, {2, 4}, {1, 2.5}, {0.5, 4}, {0, 3}}, knots);
    expectRelativelyClose(areaOf(faceOf(kPlaneXY, withTop(side))), areaWithTop(side), 1e-6);
  }
}

TEST_F(Face, ASplineCrossingAnotherSideOfItsLoopFailsWithOperationFailed) {
  Curve2 dipping = wave();
  dipping.poles[1] = {3, -4};
  EXPECT_EQ(codeOf(kernel.makeFace(faceOf(kPlaneXY, withTop(dipping)))),
            KernelErrorCode::OperationFailed);
  EXPECT_EQ(kernel.liveHandleCount(), 0U);
}

TEST_F(Face, ASelfIntersectingLoopFailsWithOperationFailed) {
  EXPECT_EQ(codeOf(kernel.makeFace(faceOf(kPlaneXY, polygon({{0, 0}, {2, 2}, {2, 0}, {0, 2}})))),
            KernelErrorCode::OperationFailed);
  EXPECT_EQ(kernel.liveHandleCount(), 0U);
}

}  // namespace
}  // namespace tinycad::kernel
