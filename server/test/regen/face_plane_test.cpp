// Planes of references (port of test/unit/regen/face-plane.test.ts) over OcctKernel.

#include <gtest/gtest.h>

#include <cmath>

#include "regen/testing.hpp"
#include "tinycad/regen/face_plane.hpp"

namespace tinycad::regen::test {
namespace {

using document::EntityRef;

void expectVec(const core::Vec3& actual, const core::Vec3& expected, double tol = 1e-12) {
  for (std::size_t i = 0; i < 3; ++i) EXPECT_NEAR(actual[i], expected[i], tol) << "component " << i;
}

core::Vec3 yDirOf(const core::Plane& p) {
  const auto& n = p.normal;
  const auto& x = p.xDir;
  return {n[1] * x[2] - n[2] * x[1], n[2] * x[0] - n[0] * x[2], n[0] * x[1] - n[1] * x[0]};
}

EntityRef topoRef(const std::string& origin, const std::string& name) {
  return EntityRef::toTopo(document::bodyId(fid(origin)), TopoName(name));
}

TEST(SketchPlaneOfFace, GivesTheFrameOfXyMovedUpForTheNormalPlusZ) {
  const auto p = sketchPlaneOfFace({{5, 5, 10}, {0, 0, 1}});
  expectVec(p.origin, {0, 0, 10});
  expectVec(p.xDir, {1, 0, 0});
  expectVec(p.normal, {0, 0, 1});
}

TEST(SketchPlaneOfFace, GivesXDirPlusXForTheNormalMinusZ) {
  const auto p = sketchPlaneOfFace({{3, 4, 2}, {0, 0, -1}});
  expectVec(p.origin, {0, 0, 2});
  expectVec(p.xDir, {1, 0, 0});
  expectVec(p.normal, {0, 0, -1});
}

TEST(SketchPlaneOfFace, GivesTheFrameOfXzForTheNormalMinusY) {
  const auto p = sketchPlaneOfFace({{5, -3, 5}, {0, -1, 0}});
  expectVec(p.origin, {0, -3, 0});
  expectVec(p.xDir, {1, 0, 0});
  expectVec(p.normal, {0, -1, 0});
  // Up in the sketch is +Z, like on the origin plane XZ (spec 12).
  expectVec(yDirOf(p), {0, 0, 1});
}

TEST(SketchPlaneOfFace, GivesXDirPlusXForTheNormalPlusY) {
  const auto p = sketchPlaneOfFace({{1, 7, 1}, {0, 1, 0}});
  expectVec(p.origin, {0, 7, 0});
  expectVec(p.xDir, {1, 0, 0});
}

TEST(SketchPlaneOfFace, TakesPlusYAsXDirForTheNormalsPlusAndMinusX) {
  for (const double sign : {1.0, -1.0}) {
    const auto p = sketchPlaneOfFace({{4 * sign, 2, 3}, {sign, 0, 0}});
    expectVec(p.origin, {4 * sign, 0, 0});
    expectVec(p.xDir, {0, 1, 0});
    expectVec(p.normal, {sign, 0, 0});
  }
}

TEST(SketchPlaneOfFace, GivesAnOrthonormalFrameOnTheFaceForAnObliqueNormal) {
  const double k = 1 / std::sqrt(3.0);
  const kernel::FacePlane face{{1, 2, 3}, {k, k, k}};
  const auto p = sketchPlaneOfFace(face);
  const auto dot = [](const core::Vec3& a, const core::Vec3& b) {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  };
  EXPECT_NEAR(dot(p.xDir, p.xDir), 1, 1e-12);
  EXPECT_NEAR(dot(p.normal, p.normal), 1, 1e-12);
  EXPECT_NEAR(dot(p.xDir, p.normal), 0, 1e-12);
  // The origin lies on the face plane and is the projection of the world origin.
  const core::Vec3 d{p.origin[0] - 1, p.origin[1] - 2, p.origin[2] - 3};
  EXPECT_NEAR(dot(d, face.normal), 0, 1e-12);
  expectVec(p.origin, {2, 2, 2});
  // xDir is the projection of +X.
  EXPECT_GT(p.xDir[0], 0);
  EXPECT_NEAR(p.xDir[1], p.xDir[2], 1e-12);
}

TEST(SketchPlaneOfFace, NormalisesANormalThatIsNotUnitLength) {
  const auto p = sketchPlaneOfFace({{0, 0, 5}, {0, 0, 3}});
  expectVec(p.normal, {0, 0, 1});
  expectVec(p.origin, {0, 0, 5});
}

/** The OCCT box [0, 10]³ of the feature 'b', named by nameShape, behind the origin artifacts. */
StatePtr boxState(CountingKernel& kernel) {
  auto result = kernel.makeBox({{0, 0, 0}, {10, 10, 10}});
  auto names = nameShape(kernel, fid("b"), *result, {});
  return RegenState::empty()->with(aBody("b", result->shape, *names));
}

TEST(PlaneOfRef, GivesThePlaneOfAnOriginPlaneArtifact) {
  const auto p = planeOfRef(*RegenState::empty(),
                            EntityRef::toPlane(document::PlaneId("origin/plane:xz")));
  ASSERT_TRUE(p.has_value());
  EXPECT_EQ(*p, RegenState::empty()->planes()[1]->plane());
}

TEST(PlaneOfRef, GivesNothingForAMissingPlane) {
  EXPECT_FALSE(planeOfRef(*RegenState::empty(),
                          EntityRef::toPlane(document::PlaneId("origin/plane:ab"))));
}

TEST(PlaneOfRef, GivesTheFrameOfTheTopFaceOfABox) {
  CountingKernel kernel;
  const auto p = planeOfRef(*boxState(kernel), topoRef("b", "b/face:top"));
  ASSERT_TRUE(p.has_value());
  expectVec(p->origin, {0, 0, 10}, 1e-9);
  expectVec(p->xDir, {1, 0, 0}, 1e-9);
  expectVec(p->normal, {0, 0, 1}, 1e-9);
}

TEST(PlaneOfRef, GivesNothingForAMissingBodyAMissingNameAndANonPlanarFace) {
  CountingKernel kernel;
  const auto state = boxState(kernel);
  EXPECT_FALSE(planeOfRef(*state, topoRef("x", "b/face:top")));
  EXPECT_FALSE(planeOfRef(*state, topoRef("b", "b/face:none")));
  const auto curved =
      state->with(aBody("c", ShapeHandle{1}, aNameTable({{"c/face:side", {0}}})));
  EXPECT_FALSE(planeOfRef(*curved, topoRef("c", "c/face:side")));
}

TEST(PlaneOfRef, GivesNothingForATopoRefWhoseBodyIdNamesAnotherKind) {
  const auto ref = EntityRef::toTopo(document::BodyId("origin/plane:xy"), TopoName("b/face:top"));
  EXPECT_FALSE(planeOfRef(*RegenState::empty(), ref));
}

}  // namespace
}  // namespace tinycad::regen::test
