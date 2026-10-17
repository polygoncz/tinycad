// Topology and roles: the contract blocks `topology (M14)` and `roles (M14)` of
// src/kernel/testing.ts and test/unit/kernel-occt/occt-topology.test.ts.

#include <gtest/gtest.h>

#include <algorithm>
#include <cmath>
#include <map>
#include <set>
#include <string>
#include <vector>

#include "kernel_test_support.hpp"

namespace tinycad::kernel {
namespace {

using namespace test;  // NOLINT(google-build-using-namespace): the fixtures of the suite

/** Axis and sign of an axis-aligned unit vector, or nullopt. */
std::optional<std::pair<std::size_t, int>> axisOf(const Vec3& n) {
  for (std::size_t axis = 0; axis < 3; ++axis) {
    if (std::abs(std::abs(n[axis]) - 1) > kNormalTolerance) continue;
    for (std::size_t k = 0; k < 3; ++k) {
      if (k != axis && std::abs(n[k]) > kNormalTolerance) return std::nullopt;
    }
    return std::pair{axis, n[axis] > 0 ? 1 : -1};
  }
  return std::nullopt;
}

double dot(const Vec3& a, const Vec3& b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

Vec3 sub(const Vec3& a, const Vec3& b) { return {a[0] - b[0], a[1] - b[1], a[2] - b[2]}; }

void expectClose(const Vec3& actual, const Vec3& expected, const std::string& what = "vector") {
  expectVecClose(actual, expected, 1e-9, what);
}

class Topology : public ::testing::Test {
 protected:
  ShapeHandle aBox() { return ok(kernel.makeBox(kBox)).shape; }

  FacePlane planeOf(const TopologySummary& t, int face) {
    const auto& plane = t.faces.at(static_cast<std::size_t>(face)).plane;
    if (!plane) {
      ADD_FAILURE() << "face " << face << " has no plane";
      return {};
    }
    return *plane;
  }

  OcctKernel kernel;
};

TEST_F(Topology, ABoxHasSixPlanarFacesWithOutwardNormals12EdgesAnd8Vertices) {
  const TopologySummary topology = ok(kernel.topology(aBox()));
  ASSERT_EQ(topology.faces.size(), 6U);
  ASSERT_EQ(topology.edges.size(), 12U);
  EXPECT_EQ(topology.vertexCount, 8);
  std::set<std::pair<std::size_t, int>> walls;
  for (std::size_t i = 0; i < topology.faces.size(); ++i) {
    const FaceInfo& face = topology.faces[i];
    EXPECT_EQ(face.surface, SurfaceType::Plane) << "face " << i;
    ASSERT_TRUE(face.plane.has_value());
    EXPECT_NEAR(std::hypot(face.plane->normal[0], face.plane->normal[1], face.plane->normal[2]), 1,
                1e-6);
    const auto wall = axisOf(face.plane->normal);
    ASSERT_TRUE(wall.has_value()) << "face " << i << ": normal not axis-aligned";
    // Outward: the plane point lies on the wall the normal points away from the box.
    const double level = (wall->second > 0 ? kBoxMax : kOrigin)[wall->first];
    EXPECT_LT(std::abs(face.plane->origin[wall->first] - level), 1e-6);
    walls.insert(*wall);
  }
  EXPECT_EQ(walls.size(), 6U);
  for (std::size_t i = 0; i < topology.edges.size(); ++i) {
    const EdgeInfo& edge = topology.edges[i];
    ASSERT_EQ(edge.faces.size(), 2U) << "edge " << i;
    ASSERT_EQ(edge.vertices.size(), 2U) << "edge " << i;
    EXPECT_LT(edge.faces[0], edge.faces[1]);
    EXPECT_LT(edge.vertices[0], edge.vertices[1]);
    EXPECT_LT(edge.vertices[1], 8);
    // The midpoint lies on the planes of both adjacent faces.
    for (const int f : edge.faces) {
      const FacePlane plane = planeOf(topology, f);
      EXPECT_LT(std::abs(dot(sub(edge.midpoint, plane.origin), plane.normal)), 1e-6);
    }
  }
}

TEST_F(Topology, HasAsManyFacesAndEdgesAsTheMeshAndCreatesNoHandle) {
  const ShapeHandle shape = aBox();
  const TopologySummary topology = ok(kernel.topology(shape));
  const MeshData mesh = ok(kernel.tessellate(shape, kQuality));
  EXPECT_EQ(topology.faces.size(), mesh.faceRanges.size() / 3);
  EXPECT_EQ(topology.edges.size(), mesh.edgeRanges.size() / 3);
  EXPECT_EQ(kernel.liveHandleCount(), 1U);
}

TEST_F(Topology, SurfaceTypeNamesAreTheTsNames) {
  EXPECT_STREQ(surfaceTypeName(SurfaceType::Plane), "plane");
  EXPECT_STREQ(surfaceTypeName(SurfaceType::Cylinder), "cylinder");
  EXPECT_STREQ(surfaceTypeName(SurfaceType::Cone), "cone");
  EXPECT_STREQ(surfaceTypeName(SurfaceType::Sphere), "sphere");
  EXPECT_STREQ(surfaceTypeName(SurfaceType::Torus), "torus");
  EXPECT_STREQ(surfaceTypeName(SurfaceType::Other), "other");
}

// --- roles (M14) ------------------------------------------------------------------------------

TEST_F(Topology, ABoxHasTheSixWorldAxisRolesWithTheNormalOfTheTable) {
  const std::map<std::string, Vec3> normals{{"face:top", {0, 0, 1}},    {"face:bottom", {0, 0, -1}},
                                            {"face:front", {0, -1, 0}}, {"face:back", {0, 1, 0}},
                                            {"face:left", {-1, 0, 0}},  {"face:right", {1, 0, 0}}};
  const ShapeResult box = ok(kernel.makeBox(kBox));
  const TopologySummary topology = ok(kernel.topology(box.shape));
  std::vector<std::string> expectedKeys;
  for (const auto& [key, normal] : normals) expectedKeys.push_back(key);
  EXPECT_EQ(roleKeys(box.roles), expectedKeys);
  std::set<int> faces;
  for (const auto& [role, normal] : normals) {
    const int index = roleIndex(box.roles, role);
    ASSERT_GE(index, 0);
    EXPECT_EQ(box.roles->at(role).front().type, SubShapeType::Face);
    faces.insert(index);
    expectVecClose(planeOf(topology, index).normal, normal, kNormalTolerance, role);
  }
  EXPECT_EQ(faces.size(), 6U);
}

TEST_F(Topology, ACylinderHasTopAndBottomAlongTheAxisAndADisjointSide) {
  const ShapeResult cylinder = ok(kernel.makeCylinder(kCylinder));
  const TopologySummary topology = ok(kernel.topology(cylinder.shape));
  EXPECT_EQ(roleKeys(cylinder.roles),
            (std::vector<std::string>{"face:bottom", "face:side", "face:top"}));
  for (const auto& [role, normal] : std::vector<std::pair<std::string, Vec3>>{
           {"face:bottom", {0, 0, -1}}, {"face:top", {0, 0, 1}}}) {
    const int index = roleIndex(cylinder.roles, role);
    ASSERT_GE(index, 0);
    EXPECT_EQ(topology.faces[static_cast<std::size_t>(index)].surface, SurfaceType::Plane);
    expectVecClose(planeOf(topology, index).normal, normal, kNormalTolerance, role);
  }
  std::vector<int> all;
  for (const auto& [role, subs] : *cylinder.roles) {
    for (std::size_t k = 0; k < subs.size(); ++k) {
      EXPECT_EQ(subs[k].type, SubShapeType::Face);
      if (k > 0) {
        EXPECT_GT(subs[k].index, subs[k - 1].index);
      }
      all.push_back(subs[k].index);
    }
  }
  EXPECT_FALSE(cylinder.roles->at("face:side").empty());
  EXPECT_EQ(std::set<int>(all.begin(), all.end()).size(), all.size());
}

TEST_F(Topology, AnExtrudeHasStartAgainstTheDirectionAndEndAlongIt) {
  const ShapeHandle profile = ok(kernel.makeFace(square10())).shape;
  const ShapeResult prism = ok(kernel.extrude(profile, {0, 0, 1}, 5));
  const TopologySummary topology = ok(kernel.topology(prism.shape));
  expectVecClose(planeOf(topology, roleIndex(prism.roles, "face:start")).normal, {0, 0, -1},
                 kNormalTolerance, "face:start");
  expectVecClose(planeOf(topology, roleIndex(prism.roles, "face:end")).normal, {0, 0, 1},
                 kNormalTolerance, "face:end");
}

TEST_F(Topology, TransformBooleanFilletAndChamferReturnNoRoles) {
  const ShapeHandle a = aBox();
  const ShapeHandle b = ok(kernel.makeBox(kOverlapping)).shape;
  const int edge[] = {0};
  EXPECT_FALSE(ok(kernel.transform(a, translation({1, 0, 0}))).roles.has_value());
  EXPECT_FALSE(
      ok(kernel.boolean(BooleanOp::Union, std::span(&a, 1), std::span(&b, 1))).roles.has_value());
  EXPECT_FALSE(ok(kernel.fillet(a, edge, 0.5)).roles.has_value());
  EXPECT_FALSE(ok(kernel.chamfer(a, edge, 0.5)).roles.has_value());
}

// --- test/unit/kernel-occt/occt-topology.test.ts: roles from entity ids -----------------------

const std::vector<std::string> kIds{"l1", "l2", "l3", "l4"};

std::vector<std::string> prefixed(const std::string& prefix, const std::vector<std::string>& ids) {
  std::vector<std::string> keys;
  for (const std::string& id : ids) keys.push_back(prefix + id);
  std::sort(keys.begin(), keys.end());
  return keys;
}

std::vector<std::string> sorted(std::vector<std::string> keys) {
  std::sort(keys.begin(), keys.end());
  return keys;
}

TEST_F(Topology, MakeFaceOfARectangleWithFourIdsHasFourEdgeRolesOnDifferentEdges) {
  const ShapeResult face =
      ok(kernel.makeFace(faceOf(kPlaneXY, polygon({{0, 0}, {4, 0}, {4, 3}, {0, 3}}, "l"))));
  EXPECT_EQ(roleKeys(face.roles), prefixed("edge:", kIds));
  std::set<int> edges;
  for (const std::string& id : kIds) edges.insert(roleIndex(face.roles, "edge:" + id));
  EXPECT_EQ(edges.size(), 4U);
  EXPECT_EQ(face.roles->at("edge:l1").front().type, SubShapeType::Edge);
  // The edge of l1 runs from (0, 0) to (4, 0): its midpoint is (2, 0, 0).
  const TopologySummary topology = ok(kernel.topology(face.shape));
  expectClose(topology.edges[static_cast<std::size_t>(roleIndex(face.roles, "edge:l1"))].midpoint,
              {2, 0, 0});
}

TEST_F(Topology, MakeFaceWithoutIdsReturnsNoRoles) {
  EXPECT_FALSE(
      ok(kernel.makeFace(faceOf(kPlaneXY, polygon({{0, 0}, {4, 0}, {4, 3}})))).roles.has_value());
}

TEST_F(Topology, TransformAndExtrudeGiveSideStartAndEndRoles) {
  const ShapeResult face =
      ok(kernel.makeFace(faceOf(kPlaneXY, polygon({{0, 0}, {4, 0}, {4, 3}, {0, 3}}, "l"))));
  const ShapeResult moved = ok(kernel.transform(face.shape, translation({0, 0, 7})));
  const ShapeResult prism = ok(kernel.extrude(moved.shape, {0, 0, 1}, 5));
  std::vector<std::string> keys = prefixed("face:side:", kIds);
  keys.push_back("face:start");
  keys.push_back("face:end");
  EXPECT_EQ(roleKeys(prism.roles), sorted(keys));
  std::set<int> faces;
  for (const std::string& key : keys) faces.insert(roleIndex(prism.roles, key));
  EXPECT_EQ(faces.size(), 6U);
  // The side of l1 (y = 0) faces −Y; start is at z = 7, end at z = 12.
  const TopologySummary topology = ok(kernel.topology(prism.shape));
  expectClose(planeOf(topology, roleIndex(prism.roles, "face:side:l1")).normal, {0, -1, 0});
  EXPECT_NEAR(planeOf(topology, roleIndex(prism.roles, "face:start")).origin[2], 7, 1e-9);
  EXPECT_NEAR(planeOf(topology, roleIndex(prism.roles, "face:end")).origin[2], 12, 1e-9);
}

TEST_F(Topology, RevolveByAFullTurnGivesTheSideRolesButNoStartOrEnd) {
  const ShapeResult face = ok(kernel.makeFace(ringProfile("l")));
  const ShapeResult solid = ok(kernel.revolve(face.shape, kZAxis, kTurn));
  EXPECT_EQ(roleKeys(solid.roles), prefixed("face:side:", kIds));
  std::set<int> faces;
  for (const std::string& id : kIds) faces.insert(roleIndex(solid.roles, "face:side:" + id));
  EXPECT_EQ(faces.size(), 4U);
  // l1 sweeps the bottom annulus, l3 the top one: planar with outward normals.
  const TopologySummary topology = ok(kernel.topology(solid.shape));
  expectClose(planeOf(topology, roleIndex(solid.roles, "face:side:l1")).normal, {0, 0, -1});
  expectClose(planeOf(topology, roleIndex(solid.roles, "face:side:l3")).normal, {0, 0, 1});
}

TEST_F(Topology, RevolveByAFullTurnOfAProfileOnTheAxisGivesDiscsAndTheLateralFace) {
  const ShapeResult face =
      ok(kernel.makeFace(faceOf(kPlaneXZ, polygon({{0, 0}, {5, 0}, {5, 10}, {0, 10}}, "l"))));
  const ShapeResult solid = ok(kernel.revolve(face.shape, kZAxis, kTurn));
  EXPECT_EQ(roleKeys(solid.roles),
            (std::vector<std::string>{"face:side:l1", "face:side:l2", "face:side:l3"}));
  const TopologySummary topology = ok(kernel.topology(solid.shape));
  expectClose(planeOf(topology, roleIndex(solid.roles, "face:side:l1")).normal, {0, 0, -1});
  EXPECT_EQ(
      topology.faces[static_cast<std::size_t>(roleIndex(solid.roles, "face:side:l2"))].surface,
      SurfaceType::Cylinder);
  expectClose(planeOf(topology, roleIndex(solid.roles, "face:side:l3")).normal, {0, 0, 1});
}

TEST_F(Topology, RevolveByAQuarterTurnGivesSideStartAndEnd) {
  const ShapeResult face = ok(kernel.makeFace(ringProfile("l")));
  const ShapeResult solid = ok(kernel.revolve(face.shape, kZAxis, std::numbers::pi / 2));
  std::vector<std::string> keys = prefixed("face:side:", kIds);
  keys.push_back("face:start");
  keys.push_back("face:end");
  EXPECT_EQ(roleKeys(solid.roles), sorted(keys));
  std::set<int> faces;
  for (const std::string& key : keys) faces.insert(roleIndex(solid.roles, key));
  EXPECT_EQ(faces.size(), 6U);
}

TEST_F(Topology, ACircleWithAnIdGivesOneCylindricalSideFace) {
  const ShapeResult face = ok(kernel.makeFace(faceOf(kPlaneXY, {circle({0, 0}, 2, "c1")})));
  EXPECT_EQ(roleKeys(face.roles), std::vector<std::string>{"edge:c1"});
  const ShapeResult prism = ok(kernel.extrude(face.shape, {0, 0, 1}, 3));
  const TopologySummary topology = ok(kernel.topology(prism.shape));
  EXPECT_EQ(
      topology.faces[static_cast<std::size_t>(roleIndex(prism.roles, "face:side:c1"))].surface,
      SurfaceType::Cylinder);
}

TEST_F(Topology, ASplineWithAnIdGivesEdgeAndThenSideRoles) {
  const ProfileLoop outer{
      line({0, 0}, {4, 0}, "l1"),
      core::Curve2::bspline(2, {{4, 0}, {6, 1.5}, {4, 3}}, {0, 0, 0, 1, 1, 1}, "s1"),
      line({4, 3}, {0, 3}, "l3"), line({0, 3}, {0, 0}, "l4")};
  const ShapeResult face = ok(kernel.makeFace(faceOf(kPlaneXY, outer)));
  EXPECT_EQ(roleKeys(face.roles),
            (std::vector<std::string>{"edge:l1", "edge:l3", "edge:l4", "edge:s1"}));
  // The quadratic runs through (5, 1.5) at its middle parameter.
  const TopologySummary faceTopology = ok(kernel.topology(face.shape));
  expectClose(
      faceTopology.edges[static_cast<std::size_t>(roleIndex(face.roles, "edge:s1"))].midpoint,
      {5, 1.5, 0});

  const ShapeResult prism = ok(kernel.extrude(face.shape, {0, 0, 1}, 2));
  const std::vector<std::string> keys{"face:side:l1", "face:side:s1", "face:side:l3",
                                      "face:side:l4", "face:start",   "face:end"};
  EXPECT_EQ(roleKeys(prism.roles), sorted(keys));
  std::set<int> faces;
  for (const std::string& key : keys) faces.insert(roleIndex(prism.roles, key));
  EXPECT_EQ(faces.size(), 6U);
  const TopologySummary topology = ok(kernel.topology(prism.shape));
  EXPECT_EQ(
      topology.faces[static_cast<std::size_t>(roleIndex(prism.roles, "face:side:s1"))].surface,
      SurfaceType::Other);
}

TEST_F(Topology, AHoleWithAnIdGetsItsSideRoleToo) {
  const ShapeResult face =
      ok(kernel.makeFace(faceOf(kPlaneXY, polygon({{0, 0}, {10, 0}, {10, 10}, {0, 10}}, "l"),
                                {{circle({5, 5}, 2, "hole")}})));
  const ShapeResult prism = ok(kernel.extrude(face.shape, {0, 0, 1}, 3));
  EXPECT_TRUE(prism.roles->contains("face:side:hole"));
}

TEST_F(Topology, ACylinderBottomLiesInTheBaseAgainstTheAxis) {
  const ShapeResult result = ok(kernel.makeCylinder({{1, 2, 3}, {0, 0, -1}, 2, 4}));
  const TopologySummary topology = ok(kernel.topology(result.shape));
  const FacePlane bottom = planeOf(topology, roleIndex(result.roles, "face:bottom"));
  EXPECT_NEAR(bottom.origin[2], 3, 1e-9);
  expectClose(bottom.normal, {0, 0, 1});
  EXPECT_NEAR(planeOf(topology, roleIndex(result.roles, "face:top")).origin[2], -1, 1e-9);
}

TEST_F(Topology, ACylinderHasALateralFaceTwoPlanesASeamAndTwoCircles) {
  const ShapeHandle shape = ok(kernel.makeCylinder({{0, 0, 0}, {0, 0, 1}, 2, 4})).shape;
  const TopologySummary topology = ok(kernel.topology(shape));
  std::vector<std::string> surfaces;
  for (const FaceInfo& f : topology.faces) {
    surfaces.emplace_back(surfaceTypeName(f.surface));
    if (f.surface == SurfaceType::Cylinder) {
      EXPECT_FALSE(f.plane.has_value());
    }
  }
  EXPECT_EQ(sorted(surfaces), (std::vector<std::string>{"cylinder", "plane", "plane"}));
  std::vector<std::pair<std::size_t, std::size_t>> shapes;
  for (const EdgeInfo& e : topology.edges) shapes.emplace_back(e.faces.size(), e.vertices.size());
  std::sort(shapes.begin(), shapes.end());
  // Two circles (lateral + cap, one vertex) and the seam (lateral only, two vertices).
  EXPECT_EQ(shapes, (std::vector<std::pair<std::size_t, std::size_t>>{{1, 2}, {2, 1}, {2, 1}}));
  EXPECT_EQ(topology.vertexCount, 2);
}

TEST_F(Topology, DegeneratedEdgesOfARevolvedProfileTouchingTheAxisHaveAFiniteMidpoint) {
  const ShapeResult face =
      ok(kernel.makeFace(faceOf(kPlaneXZ, polygon({{0, 0}, {5, 0}, {5, 10}, {0, 10}}, "l"))));
  const ShapeHandle shape = ok(kernel.revolve(face.shape, kZAxis, kTurn)).shape;
  for (const EdgeInfo& edge : ok(kernel.topology(shape)).edges) {
    for (const double c : edge.midpoint) EXPECT_TRUE(std::isfinite(c));
  }
}

}  // namespace
}  // namespace tinycad::kernel
