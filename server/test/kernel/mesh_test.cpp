// validateMeshData and isRigidMotion (port of test/unit/kernel/mesh.test.ts and transform.test.ts).

#include <gtest/gtest.h>

#include <cmath>
#include <limits>
#include <string>
#include <vector>

#include "kernel_test_support.hpp"

namespace tinycad::kernel {
namespace {

using test::fromRows;
using test::identity;
using test::multiply;
using test::rotationAxisAngle;
using test::translation;

const std::vector<std::string> kNone;
constexpr float kInf = std::numeric_limits<float>::infinity();
constexpr float kNaN = std::numeric_limits<float>::quiet_NaN();

/** Two triangles of one face (unit square in z = 0, normal +z) and one edge along its bottom. */
MeshData aSquare() {
  return {{0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0},
          {0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1},
          {0, 1, 2, 0, 2, 3},
          {0, 0, 2},
          {0, 0, 0, 1, 0, 0},
          {0, 0, 2}};
}

/** Unit box built by hand: 6 faces × 4 own vertices × 2 triangles, 12 edges × 2 points. */
MeshData aBox() {
  struct Side {
    std::array<float, 3> n;
    std::array<std::array<float, 3>, 4> corners;
  };
  const std::vector<Side> faces{
      {{-1, 0, 0}, {{{0, 0, 0}, {0, 0, 1}, {0, 1, 1}, {0, 1, 0}}}},
      {{1, 0, 0}, {{{1, 0, 0}, {1, 1, 0}, {1, 1, 1}, {1, 0, 1}}}},
      {{0, -1, 0}, {{{0, 0, 0}, {1, 0, 0}, {1, 0, 1}, {0, 0, 1}}}},
      {{0, 1, 0}, {{{0, 1, 0}, {0, 1, 1}, {1, 1, 1}, {1, 1, 0}}}},
      {{0, 0, -1}, {{{0, 0, 0}, {0, 1, 0}, {1, 1, 0}, {1, 0, 0}}}},
      {{0, 0, 1}, {{{0, 0, 1}, {1, 0, 1}, {1, 1, 1}, {0, 1, 1}}}},
  };
  MeshData mesh;
  for (std::uint32_t i = 0; i < faces.size(); ++i) {
    for (const auto& c : faces[i].corners) {
      mesh.positions.insert(mesh.positions.end(), c.begin(), c.end());
      mesh.normals.insert(mesh.normals.end(), faces[i].n.begin(), faces[i].n.end());
    }
    const std::uint32_t v = i * 4;
    mesh.indices.insert(mesh.indices.end(), {v, v + 1, v + 2, v, v + 2, v + 3});
    mesh.faceRanges.insert(mesh.faceRanges.end(), {i, i * 2, 2});
  }
  const std::vector<std::array<float, 6>> edges{
      {0, 0, 0, 1, 0, 0}, {1, 0, 0, 1, 1, 0}, {1, 1, 0, 0, 1, 0}, {0, 1, 0, 0, 0, 0},
      {0, 0, 1, 1, 0, 1}, {1, 0, 1, 1, 1, 1}, {1, 1, 1, 0, 1, 1}, {0, 1, 1, 0, 0, 1},
      {0, 0, 0, 0, 0, 1}, {1, 0, 0, 1, 0, 1}, {1, 1, 0, 1, 1, 1}, {0, 1, 0, 0, 1, 1}};
  for (std::uint32_t i = 0; i < edges.size(); ++i) {
    mesh.edgePositions.insert(mesh.edgePositions.end(), edges[i].begin(), edges[i].end());
    mesh.edgeRanges.insert(mesh.edgeRanges.end(), {i, i * 2, 2});
  }
  return mesh;
}

std::string joined(const std::vector<std::string>& messages) {
  std::string text;
  for (const std::string& m : messages) text += m + "\n";
  return text;
}

TEST(ValidateMeshData, AcceptsTwoTrianglesOfOneFaceWithOneEdge) {
  EXPECT_EQ(validateMeshData(aSquare()), kNone);
}

TEST(ValidateMeshData, AcceptsAHandBuiltBox) { EXPECT_EQ(validateMeshData(aBox()), kNone); }

TEST(ValidateMeshData, AcceptsAnEmptyMesh) { EXPECT_EQ(validateMeshData(MeshData{}), kNone); }

TEST(ValidateMeshData, ReportsLengthsNotDivisibleByThree) {
  MeshData m = aSquare();
  m.positions.pop_back();
  EXPECT_NE(validateMeshData(m), kNone) << "positions";
  m = aSquare();
  m.normals.resize(9);
  EXPECT_NE(validateMeshData(m), kNone) << "normals length differs";
  m = aSquare();
  m.indices.pop_back();
  EXPECT_NE(validateMeshData(m), kNone) << "indices";
  m = aSquare();
  m.faceRanges.push_back(1);
  EXPECT_NE(validateMeshData(m), kNone) << "faceRanges";
  m = aSquare();
  m.edgePositions.pop_back();
  EXPECT_NE(validateMeshData(m), kNone) << "edgePositions";
  m = aSquare();
  m.edgeRanges.push_back(1);
  EXPECT_NE(validateMeshData(m), kNone) << "edgeRanges";
}

TEST(ValidateMeshData, DoesNotThrowWhenEveryLengthIsWrongAtOnce) {
  const MeshData m{{0, 0}, {0}, {5}, {0, 0}, {1}, {0}};
  EXPECT_GE(validateMeshData(m).size(), 6U);
}

TEST(ValidateMeshData, ReportsNonFiniteNumbers) {
  for (const float bad : {kInf, -kInf, kNaN}) {
    MeshData m = aSquare();
    m.positions[4] = bad;
    EXPECT_NE(validateMeshData(m), kNone) << "positions " << bad;
    m = aSquare();
    m.normals[5] = bad;
    EXPECT_NE(validateMeshData(m), kNone) << "normals " << bad;
    m = aSquare();
    m.edgePositions[3] = bad;
    EXPECT_NE(validateMeshData(m), kNone) << "edgePositions " << bad;
  }
}

TEST(ValidateMeshData, ChecksUnitNormalsWithinTheTolerance) {
  MeshData m = aSquare();
  m.normals[5] = 0.5F;
  EXPECT_NE(validateMeshData(m), kNone) << "not unit";
  m.normals[5] = 0;
  EXPECT_NE(validateMeshData(m), kNone) << "zero";
  m.normals[5] = 1.00005F;
  EXPECT_EQ(validateMeshData(m), kNone) << "within 1e-4";
}

TEST(ValidateMeshData, ReportsAVertexIndexOutOfRange) {
  MeshData m = aSquare();
  m.indices = {0, 1, 2, 0, 2, 4};
  EXPECT_NE(validateMeshData(m), kNone);
}

TEST(ValidateMeshData, FaceRanges) {
  MeshData m = aSquare();
  m.faceRanges = {0, 0, 1};
  EXPECT_NE(validateMeshData(m), kNone) << "a triangle not covered";
  m.faceRanges = {0, 0, 2, 1, 1, 1};
  EXPECT_NE(joined(validateMeshData(m)).find("faceRanges[1]"), std::string::npos) << "overlap";
  m.faceRanges = {0, 0, 3};
  EXPECT_NE(validateMeshData(m), kNone) << "past the last triangle";
  m.faceRanges = {0, 0, 1, 0, 1, 1};
  EXPECT_NE(validateMeshData(m), kNone) << "duplicate faceIndex";
  m.faceRanges = {1, 0, 1, 0, 1, 1};
  EXPECT_EQ(validateMeshData(m), kNone) << "face indices in any order";
  m.faceRanges = {0, 1, 1, 1, 0, 1};
  EXPECT_NE(joined(validateMeshData(m)).find("faceRanges[1]"), std::string::npos) << "unsorted";
  m.faceRanges = {0, 0, 1, 1, 0, 2};
  EXPECT_NE(joined(validateMeshData(m)).find("firstTriangle"), std::string::npos) << "same first";
  m.faceRanges = {0, 0, 2, 1, 2, 0};
  const std::vector<std::string> messages = validateMeshData(m);
  ASSERT_EQ(messages.size(), 1U);
  EXPECT_NE(messages[0].find("faceRanges[1]: 0 triangles"), std::string::npos);
}

TEST(ValidateMeshData, EdgeRanges) {
  MeshData m = aSquare();
  m.edgePositions = {0, 0, 0, 1, 0, 0, 1, 1, 0};
  m.edgeRanges = {0, 0, 2, 1, 2, 1};
  EXPECT_NE(validateMeshData(m), kNone) << "a single point";
  m.edgeRanges = {0, 0, 2};
  EXPECT_NE(validateMeshData(m), kNone) << "a point not covered";
  m.edgeRanges = {0, 0, 2, 1, 1, 2};
  EXPECT_NE(validateMeshData(m), kNone) << "overlap";
  m = aSquare();
  m.edgeRanges = {0, 0, 3};
  EXPECT_NE(validateMeshData(m), kNone) << "past the last point";
  m.edgePositions = {0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0};
  m.edgeRanges = {0, 0, 2, 0, 2, 2};
  EXPECT_NE(validateMeshData(m), kNone) << "duplicate edgeIndex";
  m.edgeRanges = {0, 2, 2, 1, 0, 2};
  EXPECT_NE(joined(validateMeshData(m)).find("edgeRanges[1]"), std::string::npos) << "unsorted";
}

TEST(IsRigidMotion, AcceptsIdentityTranslationAndRotation) {
  EXPECT_TRUE(isRigidMotion(identity()));
  EXPECT_TRUE(isRigidMotion(translation({10, -2, 3.5})));
  EXPECT_TRUE(
      isRigidMotion(multiply(translation({1, 2, 3}), rotationAxisAngle({1, -2, 0.5}, 1.234))));
}

TEST(IsRigidMotion, RejectsMirrorScaleShearProjectiveAndNonFinite) {
  const double nan = std::numeric_limits<double>::quiet_NaN();
  const double inf = std::numeric_limits<double>::infinity();
  const core::Mat4 mirror = fromRows({-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1});
  EXPECT_FALSE(isRigidMotion(mirror)) << "mirror";
  EXPECT_FALSE(isRigidMotion(fromRows({2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1})))
      << "scale";
  EXPECT_FALSE(isRigidMotion(fromRows({1, 0.5, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1})))
      << "shear";
  EXPECT_FALSE(isRigidMotion(fromRows({1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0.1, 0, 0, 1})))
      << "projective";
  EXPECT_FALSE(isRigidMotion(fromRows({1, 0, 0, nan, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1})))
      << "NaN";
  EXPECT_FALSE(isRigidMotion(fromRows({inf, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1})))
      << "Infinity";
  EXPECT_FALSE(isRigidMotion(multiply(mirror, rotationAxisAngle({1, 0, 0}, std::numbers::pi))))
      << "point reflection";
}

TEST(IsRigidMotion, ComparesElementWiseWithin1e9) {
  core::Mat4 m = identity();
  m[0] = 1 + 1e-7;
  EXPECT_FALSE(isRigidMotion(m));
  m[0] = 1 + 1e-10;
  EXPECT_TRUE(isRigidMotion(m));
}

}  // namespace
}  // namespace tinycad::kernel
