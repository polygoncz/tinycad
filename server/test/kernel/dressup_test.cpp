// Fillet and chamfer: the contract block `fillet/chamfer (M14)` of src/kernel/testing.ts and
// test/unit/kernel-occt/occt-dressup.test.ts.

#include <gtest/gtest.h>

#include <algorithm>
#include <cmath>
#include <functional>
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

/** The fillet or the chamfer of the kernel, so one test covers both. */
struct Op {
  std::string name;
  std::function<KernelResult<ShapeResult>(OcctKernel&, ShapeHandle, std::span<const int>, double)>
      call;
};

const std::vector<Op> kOps{
    {"fillet", [](OcctKernel& k, ShapeHandle s, std::span<const int> e,
                  double r) { return k.fillet(s, e, r); }},
    {"chamfer", [](OcctKernel& k, ShapeHandle s, std::span<const int> e,
                   double d) { return k.chamfer(s, e, d); }},
};

class Dressup : public ::testing::Test {
 protected:
  ShapeHandle aBox() { return ok(kernel.makeBox(kBox)).shape; }

  /** A box 10 × 10 × 10 and the index of its edge between face:top and face:front. */
  struct BoxEdge {
    ShapeHandle box;
    int edge;
    int top;
    int front;
  };
  BoxEdge aBoxEdge() {
    const ShapeResult box = ok(kernel.makeBox({{0, 0, 0}, {10, 10, 10}}));
    const int top = roleIndex(box.roles, "face:top");
    const int front = roleIndex(box.roles, "face:front");
    const std::vector<int> pair{std::min(top, front), std::max(top, front)};
    const TopologySummary topology = ok(kernel.topology(box.shape));
    const auto found = std::find_if(topology.edges.begin(), topology.edges.end(),
                                    [&](const EdgeInfo& e) { return e.faces == pair; });
    EXPECT_NE(found, topology.edges.end());
    return {box.shape, static_cast<int>(found - topology.edges.begin()), top, front};
  }

  /** A cylinder r = 1, h = 10: a cap edge lies on two faces, its seam on the side face only. */
  struct CylinderSeam {
    ShapeHandle shape;
    int cap;
    int seam;
  };
  CylinderSeam aCylinderSeam() {
    const ShapeHandle shape = ok(kernel.makeCylinder({{0, 0, 0}, {0, 0, 1}, 1, 10})).shape;
    const std::vector<EdgeInfo> edges = ok(kernel.topology(shape)).edges;
    const auto index = [&](std::size_t faces) {
      const auto found = std::find_if(edges.begin(), edges.end(),
                                      [&](const EdgeInfo& e) { return e.faces.size() == faces; });
      EXPECT_NE(found, edges.end());
      return static_cast<int>(found - edges.begin());
    };
    return {shape, index(2), index(1)};
  }

  OcctKernel kernel;
};

TEST_F(Dressup, OfOneBoxEdgeANewHandleTheBoundingBoxOfTheBoxAndTheInputStaysValid) {
  for (const Op& op : kOps) {
    OcctKernel fresh;
    const ShapeHandle a = ok(fresh.makeBox(kBox)).shape;
    const int edge[] = {0};
    const ShapeHandle shape = ok(op.call(fresh, a, edge, 0.5)).shape;
    EXPECT_NE(shape, a);
    EXPECT_EQ(fresh.liveHandleCount(), 2U);
    expectBoxClose(ok(fresh.boundingBox(shape)), kOrigin, kBoxMax, op.name);
    expectEnclosesBox(ok(fresh.boundingBox(a)), kOrigin, kBoxMax, "input");
    EXPECT_EQ(validateMeshData(ok(fresh.tessellate(shape, kQuality))), std::vector<std::string>{});
  }
}

TEST_F(Dressup, InvalidInputsFailWithInvalidInputAndCreateNoHandle) {
  const std::vector<std::pair<std::vector<int>, double>> cases{
      {{}, 0.5}, {{0, 0}, 0.5}, {{12}, 0.5}, {{-1}, 0.5},
      {{0}, 0},  {{0}, -1},     {{0}, kNaN}, {{0}, kInf}};
  for (const Op& op : kOps) {
    OcctKernel fresh;
    const ShapeHandle a = ok(fresh.makeBox(kBox)).shape;
    for (const auto& [edges, size] : cases) {
      EXPECT_EQ(codeOf(op.call(fresh, a, edges, size)), KernelErrorCode::InvalidInput) << op.name;
      EXPECT_EQ(fresh.liveHandleCount(), 1U);
    }
  }
}

TEST_F(Dressup, AFilletOfABoxEdgeGeneratesOneCylindricalFaceAndModifiesTheNeighbours) {
  const BoxEdge b = aBoxEdge();
  const int edge[] = {b.edge};
  const ShapeResult result = ok(kernel.fillet(b.box, edge, 2));
  const TopologySummary topology = ok(kernel.topology(result.shape));
  EXPECT_EQ(topology.faces.size(), 7U);
  std::vector<HistoryLink> fromEdge;
  for (const HistoryLink& l : result.history->generated) {
    if (l.from.type == SubShapeType::Edge && l.from.index == b.edge) fromEdge.push_back(l);
  }
  ASSERT_EQ(fromEdge.size(), 1U);
  ASSERT_EQ(fromEdge[0].to.size(), 1U);
  EXPECT_EQ(topology.faces[static_cast<std::size_t>(fromEdge[0].to[0].index)].surface,
            SurfaceType::Cylinder);
  for (const int neighbour : {b.top, b.front}) {
    const auto link = std::find_if(result.history->modified.begin(), result.history->modified.end(),
                                   [&](const HistoryLink& l) { return l.from.index == neighbour; });
    ASSERT_NE(link, result.history->modified.end());
    EXPECT_EQ(link->to.size(), 1U) << "face " << neighbour;
  }
  EXPECT_TRUE(result.history->deleted.empty());
  EXPECT_EQ(validateMeshData(ok(kernel.tessellate(result.shape, kFine))),
            std::vector<std::string>{});
}

TEST_F(Dressup, AChamferOfABoxEdgeGivesAPlanarFaceBetweenItsNeighbours) {
  const BoxEdge b = aBoxEdge();
  const int edge[] = {b.edge};
  const ShapeResult result = ok(kernel.chamfer(b.box, edge, 2));
  const TopologySummary topology = ok(kernel.topology(result.shape));
  EXPECT_EQ(topology.faces.size(), 7U);
  const auto link =
      std::find_if(result.history->generated.begin(), result.history->generated.end(),
                   [&](const HistoryLink& l) {
                     return l.from.type == SubShapeType::Edge && l.from.index == b.edge;
                   });
  ASSERT_NE(link, result.history->generated.end());
  const auto& plane = topology.faces[static_cast<std::size_t>(link->to[0].index)].plane;
  ASSERT_TRUE(plane.has_value());
  // Between +Z and −Y: the normal is (0, −1, 1)/√2.
  EXPECT_NEAR(plane->normal[1], -std::numbers::sqrt2 / 2, 1e-9);
  EXPECT_NEAR(plane->normal[2], std::numbers::sqrt2 / 2, 1e-9);
}

TEST_F(Dressup, SeveralEdgesAtOnceWork) {
  for (const Op& op : kOps) {
    const BoxEdge b = aBoxEdge();
    const int edges[] = {0, 1, 2, 3};
    const ShapeHandle shape = ok(op.call(kernel, b.box, edges, 1)).shape;
    EXPECT_GT(ok(kernel.topology(shape)).faces.size(), 6U) << op.name;
  }
}

TEST_F(Dressup, ASizeOf11OnABoxOf10FailsWithOperationFailed) {
  for (const Op& op : kOps) {
    OcctKernel fresh;
    const ShapeHandle box = ok(fresh.makeBox({{0, 0, 0}, {10, 10, 10}})).shape;
    const int edge[] = {0};
    EXPECT_EQ(codeOf(op.call(fresh, box, edge, 11)), KernelErrorCode::OperationFailed) << op.name;
    EXPECT_EQ(fresh.liveHandleCount(), 1U);
    EXPECT_EQ(ok(fresh.topology(box)).faces.size(), 6U);
  }
}

TEST_F(Dressup, AFilletOfACylinderCapLargerThanTheRadiusFailsWithOperationFailed) {
  const CylinderSeam c = aCylinderSeam();
  const int edge[] = {c.cap};
  EXPECT_EQ(codeOf(kernel.fillet(c.shape, edge, 5)), KernelErrorCode::OperationFailed);
  EXPECT_EQ(kernel.liveHandleCount(), 1U);
}

TEST_F(Dressup, TheSeamOfACylinderIsAnEdgeOcctDoesNotAccept) {
  // Without the Contour check OCCT drops the seam silently and builds the cap only (M19.1).
  for (const Op& op : kOps) {
    OcctKernel fresh;
    const ShapeHandle shape = ok(fresh.makeCylinder({{0, 0, 0}, {0, 0, 1}, 1, 10})).shape;
    const std::vector<EdgeInfo> edges = ok(fresh.topology(shape)).edges;
    int cap = -1;
    int seam = -1;
    for (std::size_t i = 0; i < edges.size(); ++i) {
      if (edges[i].faces.size() == 2 && cap < 0) cap = static_cast<int>(i);
      if (edges[i].faces.size() == 1) seam = static_cast<int>(i);
    }
    ASSERT_GE(cap, 0);
    ASSERT_GE(seam, 0);
    const std::string named = "edge " + std::to_string(seam);
    for (const std::vector<int>& list : {std::vector<int>{cap, seam}, std::vector<int>{seam}}) {
      const auto result = op.call(fresh, shape, list, 0.5);
      EXPECT_EQ(codeOf(result), KernelErrorCode::OperationFailed) << op.name;
      EXPECT_NE(messageOf(result).find(named), std::string::npos) << messageOf(result);
      EXPECT_EQ(fresh.liveHandleCount(), 1U);
    }
  }
}

TEST_F(Dressup, AnEdgeOfAReleasedShapeFailsWithUnknownHandle) {
  const BoxEdge b = aBoxEdge();
  ok(kernel.release(std::span(&b.box, 1)));
  const int edge[] = {0};
  EXPECT_EQ(codeOf(kernel.fillet(b.box, edge, 1)), KernelErrorCode::UnknownHandle);
}

}  // namespace
}  // namespace tinycad::kernel
