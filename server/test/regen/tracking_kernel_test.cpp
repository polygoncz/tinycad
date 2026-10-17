// The tracked kernel (Q041; port of test/unit/regen/tracking-kernel.test.ts) over OcctKernel with
// the counting decorator (N45).

#include <gtest/gtest.h>

#include <numbers>

#include "regen/testing.hpp"

namespace tinycad::regen::test {
namespace {

const kernel::BoxInput kBox{{0, 0, 0}, {1, 2, 3}};
const kernel::CylinderInput kCylinder{{0, 0, 0}, {0, 0, 1}, 1, 2};
const kernel::FaceInput kFace{
    core::Plane{{0, 0, 0}, {1, 0, 0}, {0, 0, 1}}, {core::Curve2::circle({0, 0}, 1)}, {}};
const kernel::Axis kYAxis{{0, 0, 0}, {0, 1, 0}};

core::Mat4 translation(double x) { return {1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, 0, 0, 1}; }

struct Rig {
  CountingKernel real;
  OwnedHandles owned;
  TrackingKernel kernel{real, owned};
};

std::vector<ShapeHandle> ownedOf(const Rig& s) { return {s.owned.begin(), s.owned.end()}; }

TEST(TrackingKernel, AddsTheHandleOfMakeBoxAndReturnsTheRealResult) {
  Rig s;
  auto result = s.kernel.makeBox(kBox);
  ASSERT_TRUE(result);
  EXPECT_EQ(ownedOf(s), std::vector<ShapeHandle>{result->shape});
  EXPECT_TRUE(result->roles.has_value());
}

TEST(TrackingKernel, RecordsEveryHandleAlsoIntermediateOnes) {
  Rig s;
  auto a = s.kernel.makeBox(kBox);
  auto b = s.kernel.makeBox(kBox);
  EXPECT_EQ(ownedOf(s), (std::vector<ShapeHandle>{a->shape, b->shape}));
}

TEST(TrackingKernel, AddsTheHandlesOfMakeCylinderTransformAndBoolean) {
  Rig s;
  auto cylinder = s.kernel.makeCylinder(kCylinder);
  ASSERT_TRUE(cylinder);
  auto moved = s.kernel.transform(cylinder->shape, translation(10));
  ASSERT_TRUE(moved);
  const std::vector<ShapeHandle> targets{cylinder->shape};
  const std::vector<ShapeHandle> tools{moved->shape};
  auto united = s.kernel.boolean(kernel::BooleanOp::Union, targets, tools);
  ASSERT_TRUE(united);
  EXPECT_EQ(ownedOf(s), (std::vector<ShapeHandle>{cylinder->shape, moved->shape, united->shape}));
}

TEST(TrackingKernel, AddsTheHandlesOfMakeFaceExtrudeAndRevolve) {
  Rig s;
  auto face = s.kernel.makeFace(kFace);
  ASSERT_TRUE(face);
  auto prism = s.kernel.extrude(face->shape, {0, 0, 1}, 2);
  ASSERT_TRUE(prism);
  // Moved off the axis, so the revolution does not cross itself.
  auto offAxis = s.real.occt().transform(face->shape, translation(3));
  ASSERT_TRUE(offAxis);
  auto revolved = s.kernel.revolve(offAxis->shape, kYAxis, std::numbers::pi);
  ASSERT_TRUE(revolved);
  EXPECT_EQ(ownedOf(s), (std::vector<ShapeHandle>{face->shape, prism->shape, revolved->shape}));
  EXPECT_EQ(s.real.calls("makeFace"), 1);
  EXPECT_EQ(s.real.calls("extrude"), 1);
  EXPECT_EQ(s.real.calls("revolve"), 1);
  auto box = s.real.boundingBox(prism->shape);
  ASSERT_TRUE(box);
  EXPECT_NEAR(box->max[2], 2, 1e-6);
}

TEST(TrackingKernel, AddsTheHandlesOfFilletAndChamfer) {
  Rig s;
  auto box = s.kernel.makeBox(kBox);
  ASSERT_TRUE(box);
  const std::vector<int> e0{0};
  const std::vector<int> e12{1, 2};
  auto filleted = s.kernel.fillet(box->shape, e0, 0.1);
  ASSERT_TRUE(filleted);
  auto chamfered = s.kernel.chamfer(box->shape, e12, 0.1);
  ASSERT_TRUE(chamfered);
  EXPECT_EQ(ownedOf(s), (std::vector<ShapeHandle>{box->shape, filleted->shape, chamfered->shape}));
  EXPECT_TRUE(filleted->history.has_value());
}

TEST(TrackingKernel, PassesTopologyBoundingBoxAndProfileRegionsThroughWithoutOwning) {
  Rig s;
  auto box = s.kernel.makeBox(kBox);
  ASSERT_TRUE(box);
  auto topology = s.kernel.topology(box->shape);
  ASSERT_TRUE(topology);
  EXPECT_EQ(topology->faces.size(), 6U);
  auto bbox = s.kernel.boundingBox(box->shape);
  ASSERT_TRUE(bbox);
  EXPECT_NEAR(bbox->max[2], 3, 1e-6);
  const std::vector<kernel::ProfileCurve> curves{core::Curve2::circle({0, 0}, 1, "c1")};
  auto regions = s.kernel.profileRegions(curves);
  ASSERT_TRUE(regions);
  EXPECT_EQ(regions->regions.size(), 1U);
  EXPECT_EQ(ownedOf(s), std::vector<ShapeHandle>{box->shape});
  EXPECT_EQ(s.real.calls("profileRegions"), 1);
}

TEST(TrackingKernel, PassesKernelErrorsThroughUnchangedAndRecordsNothingNew) {
  for (const std::string op : {"makeBox", "makeCylinder", "transform", "boolean", "makeFace",
                               "extrude", "revolve", "fillet", "chamfer"}) {
    Rig s;
    auto a = s.real.occt().makeBox(kBox);
    auto b = s.real.occt().makeBox(kBox);
    auto face = s.real.occt().makeFace(kFace);
    s.real.failNext(op, {kernel::KernelErrorCode::OperationFailed, "boom"});
    const std::vector<ShapeHandle> ta{a->shape};
    const std::vector<ShapeHandle> tb{b->shape};
    const std::vector<int> e0{0};
    kernel::KernelResult<kernel::ShapeResult> r;
    if (op == "makeBox") r = s.kernel.makeBox(kBox);
    if (op == "makeCylinder") r = s.kernel.makeCylinder(kCylinder);
    if (op == "transform") r = s.kernel.transform(a->shape, translation(0));
    if (op == "boolean") r = s.kernel.boolean(kernel::BooleanOp::Union, ta, tb);
    if (op == "makeFace") r = s.kernel.makeFace(kFace);
    if (op == "extrude") r = s.kernel.extrude(face->shape, {0, 0, 1}, 2);
    if (op == "revolve") r = s.kernel.revolve(face->shape, kYAxis, 1);
    if (op == "fillet") r = s.kernel.fillet(a->shape, e0, 0.1);
    if (op == "chamfer") r = s.kernel.chamfer(a->shape, e0, 0.1);
    ASSERT_FALSE(r) << op;
    EXPECT_EQ(r.error().code, kernel::KernelErrorCode::OperationFailed) << op;
    EXPECT_EQ(r.error().message, "boom") << op;
    EXPECT_TRUE(s.owned.empty()) << op;
  }
}

}  // namespace
}  // namespace tinycad::regen::test
