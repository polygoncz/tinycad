// Tessellation: the contract blocks `tessellate` and `tessellate a box` of src/kernel/testing.ts
// and test/unit/kernel-occt/tessellate.test.ts (over shapes built directly with OCCT). The TS
// checks of separate ArrayBuffers have no C++ counterpart: MeshData owns six std::vectors.

#include <BRepAdaptor_Surface.hxx>
#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <BRepPrimAPI_MakeSphere.hxx>
#include <TopLoc_Location.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Face.hxx>
#include <gp_Ax1.hxx>
#include <gp_Trsf.hxx>
#include <gp_Vec.hxx>
#include <gtest/gtest.h>

#include <algorithm>
#include <cmath>
#include <limits>
#include <map>
#include <set>
#include <string>
#include <vector>

#include "kernel_test_support.hpp"
#include "operations.hpp"
#include "shape_table.hpp"

namespace tinycad::kernel {
namespace {

using namespace test;  // NOLINT(google-build-using-namespace): the fixtures of the suite
using detail::ShapeEntry;

constexpr double kNaN = std::numeric_limits<double>::quiet_NaN();
constexpr double kInf = std::numeric_limits<double>::infinity();
const std::vector<std::string> kValid;

struct Range {
  std::uint32_t key;
  std::uint32_t first;
  std::uint32_t count;
};

std::vector<Range> rangesOf(const std::vector<std::uint32_t>& ranges) {
  std::vector<Range> out;
  for (std::size_t r = 0; r + 2 < ranges.size(); r += 3) {
    out.push_back({ranges[r], ranges[r + 1], ranges[r + 2]});
  }
  return out;
}

std::vector<std::uint32_t> keysOf(const std::vector<std::uint32_t>& ranges) {
  std::vector<std::uint32_t> keys;
  for (const Range& r : rangesOf(ranges)) keys.push_back(r.key);
  return keys;
}

std::vector<std::uint32_t> iota(std::uint32_t n) {
  std::vector<std::uint32_t> v(n);
  for (std::uint32_t i = 0; i < n; ++i) v[i] = i;
  return v;
}

Vec3 sub(const Vec3& a, const Vec3& b) { return {a[0] - b[0], a[1] - b[1], a[2] - b[2]}; }

Vec3 cross(const Vec3& a, const Vec3& b) {
  return {a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]};
}

double dot(const Vec3& a, const Vec3& b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

Vec3 unitOf(const Vec3& v) {
  const double length = std::hypot(v[0], v[1], v[2]);
  return {v[0] / length, v[1] / length, v[2] / length};
}

/** Angle between the mesh normal and the expected unit direction. */
double angleTo(const Vec3& n, const Vec3& expected) {
  return std::acos(std::clamp(dot(unitOf(n), expected), -1.0, 1.0));
}

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

std::array<std::uint32_t, 3> triangleAt(const MeshData& mesh, std::size_t t) {
  return {mesh.indices[3 * t], mesh.indices[3 * t + 1], mesh.indices[3 * t + 2]};
}

/** Geometric normal of the triangle from its winding (not normalised). */
Vec3 windingNormal(const MeshData& mesh, std::size_t t) {
  const auto [a, b, c] = triangleAt(mesh, t);
  const Vec3 pa = pointAt(mesh.positions, a);
  return cross(sub(pointAt(mesh.positions, b), pa), sub(pointAt(mesh.positions, c), pa));
}

std::vector<std::size_t> faceTriangles(const MeshData& mesh, std::uint32_t face) {
  for (const Range& r : rangesOf(mesh.faceRanges)) {
    if (r.key != face) continue;
    std::vector<std::size_t> triangles;
    for (std::uint32_t k = 0; k < r.count; ++k) triangles.push_back(r.first + k);
    return triangles;
  }
  return {};
}

std::set<std::uint32_t> faceVertices(const MeshData& mesh, std::uint32_t face) {
  std::set<std::uint32_t> vertices;
  for (const std::size_t t : faceTriangles(mesh, face)) {
    for (const std::uint32_t v : triangleAt(mesh, t)) vertices.insert(v);
  }
  return vertices;
}

class Tessellate : public ::testing::Test {
 protected:
  ShapeHandle aBox() { return ok(kernel.makeBox(kBox)).shape; }
  MeshData aBoxMesh() { return ok(kernel.tessellate(aBox(), kQuality)); }

  OcctKernel kernel;
};

TEST_F(Tessellate, AnInvalidQualityFailsWithInvalidInput) {
  const ShapeHandle a = aBox();
  const std::vector<MeshQuality> cases{{0, 0.5}, {-0.1, 0.5}, {kNaN, 0.5}, {kInf, 0.5},
                                       {0.1, 0}, {0.1, -0.5}, {0.1, kNaN}, {0.1, kInf}};
  for (const MeshQuality& q : cases) {
    EXPECT_EQ(codeOf(kernel.tessellate(a, q)), KernelErrorCode::InvalidInput);
    EXPECT_EQ(kernel.liveHandleCount(), 1U);
  }
}

TEST_F(Tessellate, ARepeatedCallGivesAValidMeshWithTheSameFacesAndEdges) {
  // Spec 06: a repeated call need not return the same data (OCCT may refine the mesh).
  const ShapeHandle a = aBox();
  const MeshData first = ok(kernel.tessellate(a, kQuality));
  const MeshData second = ok(kernel.tessellate(a, kQuality));
  EXPECT_EQ(validateMeshData(second), kValid);
  EXPECT_EQ(keysOf(second.faceRanges), keysOf(first.faceRanges));
  EXPECT_EQ(keysOf(second.edgeRanges), keysOf(first.edgeRanges));
}

TEST_F(Tessellate, ABoxMeshPassesValidateMeshData) {
  EXPECT_EQ(validateMeshData(aBoxMesh()), kValid);
}

TEST_F(Tessellate, ABoxMeshHasExactlyFaces0To5AndEdges0To11) {
  const MeshData mesh = aBoxMesh();
  std::vector<std::uint32_t> faces = keysOf(mesh.faceRanges);
  std::vector<std::uint32_t> edges = keysOf(mesh.edgeRanges);
  std::sort(faces.begin(), faces.end());
  std::sort(edges.begin(), edges.end());
  EXPECT_EQ(faces, iota(6));
  EXPECT_EQ(edges, iota(12));
}

TEST_F(Tessellate, EveryBoxFaceHasAtLeastTwoTriangles) {
  for (const Range& face : rangesOf(aBoxMesh().faceRanges)) EXPECT_GE(face.count, 2U);
}

TEST_F(Tessellate, VerticesAndEdgePointsLieInTheBoxAndSpanIt) {
  const MeshData mesh = aBoxMesh();
  for (const std::vector<float>* list : {&mesh.positions, &mesh.edgePositions}) {
    Vec3 min{kInf, kInf, kInf};
    Vec3 max{-kInf, -kInf, -kInf};
    for (std::size_t i = 0; i < list->size() / 3; ++i) {
      const Vec3 p = pointAt(*list, i);
      for (std::size_t k = 0; k < 3; ++k) {
        EXPECT_GE(p[k], kOrigin[k] - kMeshTolerance);
        EXPECT_LE(p[k], kBoxMax[k] + kMeshTolerance);
        min[k] = std::min(min[k], p[k]);
        max[k] = std::max(max[k], p[k]);
      }
    }
    expectVecClose(min, kOrigin, kMeshTolerance, "min");
    expectVecClose(max, kBoxMax, kMeshTolerance, "max");
  }
}

TEST_F(Tessellate, EachBoxFaceHasOneAxisAlignedOutwardNormalOneFacePerSide) {
  const MeshData mesh = aBoxMesh();
  std::set<std::pair<std::size_t, int>> sides;
  for (const Range& face : rangesOf(mesh.faceRanges)) {
    const std::set<std::uint32_t> vertices = faceVertices(mesh, face.key);
    const Vec3 normal = pointAt(mesh.normals, *vertices.begin());
    const auto side = axisOf(normal);
    ASSERT_TRUE(side.has_value()) << "face " << face.key << ": normal not axis-aligned";
    for (const std::uint32_t v : vertices) {
      expectVecClose(pointAt(mesh.normals, v), normal, kNormalTolerance, "normal");
      // Pointing out: the face lies on the box side its normal points to.
      const double plane = (side->second > 0 ? kBoxMax : kOrigin)[side->first];
      EXPECT_NEAR(pointAt(mesh.positions, v)[side->first], plane, kMeshTolerance);
    }
    sides.insert(*side);
  }
  EXPECT_EQ(sides.size(), 6U);
}

TEST_F(Tessellate, TriangleWindingAgreesWithTheNormal) {
  const MeshData mesh = aBoxMesh();
  for (std::size_t t = 0; t < mesh.indices.size() / 3; ++t) {
    EXPECT_GT(dot(windingNormal(mesh, t), pointAt(mesh.normals, triangleAt(mesh, t)[0])), 0)
        << "triangle " << t;
  }
}

// --- test/unit/kernel-occt/tessellate.test.ts -------------------------------------------------

TopoDS_Shape aBoxShape(const Vec3& origin, const Vec3& size) {
  BRepPrimAPI_MakeBox maker(gp_Pnt(origin[0], origin[1], origin[2]), size[0], size[1], size[2]);
  return maker.Shape();
}

/** A cylinder of radius r and height h on the Z axis, rotated by `angle` about the X axis. */
TopoDS_Shape aCylinderShape(double r, double h, double angle = 0) {
  BRepPrimAPI_MakeCylinder maker(r, h);
  const TopoDS_Shape cylinder = maker.Shape();
  if (angle == 0) return cylinder;
  gp_Trsf trsf;
  trsf.SetRotation(gp_Ax1(gp_Pnt(0, 0, 0), gp_Dir(1, 0, 0)), angle);
  return cylinder.Moved(TopLoc_Location(trsf));
}

/** Index of the first face of the entry whose surface has the given type. */
std::uint32_t faceOfType(const ShapeEntry& entry, GeomAbs_SurfaceType type) {
  for (int f = 0; f < entry.faces().Extent(); ++f) {
    const BRepAdaptor_Surface surface(TopoDS::Face(entry.face(f)), true);
    if (surface.GetType() == type) return static_cast<std::uint32_t>(f);
  }
  ADD_FAILURE() << "no face of the type";
  return 0;
}

// Float32 normals of the exact surface normal: well under a thousandth of a radian.
constexpr double kSurfaceNormalTolerance = 1e-4;

TEST(TessellateEntry, MeshesABoxWithFaces0To5AndEdges0To11InOrder) {
  const MeshData mesh =
      detail::tessellateEntry(ShapeEntry(aBoxShape({1, -2, 3}, {2, 3, 4})), kQuality);
  EXPECT_EQ(validateMeshData(mesh), kValid);
  EXPECT_EQ(keysOf(mesh.faceRanges), iota(6));
  EXPECT_EQ(keysOf(mesh.edgeRanges), iota(12));
}

TEST(TessellateEntry, GivesEveryFaceItsOwnVertices) {
  const MeshData mesh =
      detail::tessellateEntry(ShapeEntry(aBoxShape({0, 0, 0}, {1, 1, 1})), kQuality);
  std::map<std::uint32_t, std::uint32_t> owner;
  for (std::uint32_t face = 0; face < 6; ++face) {
    for (const std::uint32_t v : faceVertices(mesh, face)) {
      const auto [it, inserted] = owner.emplace(v, face);
      EXPECT_EQ(it->second, face);
    }
  }
  EXPECT_EQ(owner.size(), mesh.positions.size() / 3);
}

TEST(TessellateEntry, WindsAReversedFaceCounterClockwiseFromOutsideWithNormalsOut) {
  const ShapeEntry entry(aBoxShape({0, 0, 0}, {1, 1, 1}));
  // Face 0 of MakeBox is the −X side and is REVERSED in its shell (precondition).
  ASSERT_EQ(entry.face(0).Orientation(), TopAbs_REVERSED);
  const MeshData mesh = detail::tessellateEntry(entry, kQuality);
  const std::vector<std::size_t> triangles = faceTriangles(mesh, 0);
  EXPECT_GE(triangles.size(), 2U);
  for (const std::size_t t : triangles) {
    EXPECT_GT(dot(windingNormal(mesh, t), {-1, 0, 0}), 0);
    for (const std::uint32_t v : triangleAt(mesh, t)) {
      expectVecClose(pointAt(mesh.normals, v), {-1, 0, 0}, 1e-6, "normal");
    }
  }
}

TEST(TessellateEntry, MovesFaceNodesAndEdgePointsByTheLocationOfTheShape) {
  gp_Trsf trsf;
  trsf.SetTranslation(gp_Vec(10, 20, 30));
  const ShapeEntry entry(aBoxShape({0, 0, 0}, {1, 1, 1}).Moved(TopLoc_Location(trsf)));
  const MeshData mesh = detail::tessellateEntry(entry, kQuality);
  EXPECT_EQ(validateMeshData(mesh), kValid);
  const Vec3 lo{10, 20, 30};
  for (const std::vector<float>* list : {&mesh.positions, &mesh.edgePositions}) {
    for (std::size_t i = 0; i < list->size(); ++i) {
      EXPECT_GE((*list)[i], lo[i % 3] - 1e-5);
      EXPECT_LE((*list)[i], lo[i % 3] + 1 + 1e-5);
    }
  }
}

TEST(TessellateEntry, GivesTheLateralFaceOfACylinderTheRadialSurfaceNormal) {
  const ShapeEntry entry(aCylinderShape(2, 5));
  const std::uint32_t lateral = faceOfType(entry, GeomAbs_Cylinder);
  const MeshData mesh = detail::tessellateEntry(entry, kQuality);
  const std::set<std::uint32_t> vertices = faceVertices(mesh, lateral);
  EXPECT_GT(vertices.size(), 8U);
  for (const std::uint32_t v : vertices) {
    const Vec3 p = pointAt(mesh.positions, v);
    EXPECT_LT(angleTo(pointAt(mesh.normals, v), unitOf({p[0], p[1], 0})), kSurfaceNormalTolerance);
  }
}

TEST(TessellateEntry, GivesASphereTheDirectionFromTheCentreAlsoAtThePoles) {
  BRepPrimAPI_MakeSphere maker(gp_Pnt(1, 2, 3), 4);
  const MeshData mesh = detail::tessellateEntry(ShapeEntry(maker.Shape()), kQuality);
  const std::size_t count = mesh.positions.size() / 3;
  EXPECT_GT(count, 8U);
  for (std::size_t v = 0; v < count; ++v) {
    const Vec3 fromCenter = unitOf(sub(pointAt(mesh.positions, v), {1, 2, 3}));
    EXPECT_LT(angleTo(pointAt(mesh.normals, v), fromCenter), kSurfaceNormalTolerance);
  }
}

TEST(TessellateEntry, TurnsTheNormalsOfAReversedCurvedFaceInward) {
  const ShapeEntry entry(aCylinderShape(2, 5).Reversed());
  const std::uint32_t lateral = faceOfType(entry, GeomAbs_Cylinder);
  ASSERT_EQ(entry.face(static_cast<int>(lateral)).Orientation(), TopAbs_REVERSED);
  const MeshData mesh = detail::tessellateEntry(entry, kQuality);
  for (const std::uint32_t v : faceVertices(mesh, lateral)) {
    const Vec3 p = pointAt(mesh.positions, v);
    EXPECT_LT(angleTo(pointAt(mesh.normals, v), unitOf({-p[0], -p[1], 0})),
              kSurfaceNormalTolerance);
  }
  for (const std::size_t t : faceTriangles(mesh, lateral)) {
    EXPECT_GT(dot(windingNormal(mesh, t), pointAt(mesh.normals, triangleAt(mesh, t)[0])), 0);
  }
}

TEST(TessellateEntry, RotatesTheNormalsByTheLocationOfTheShape) {
  // Rotated by 90° about X: the cylinder axis becomes −Y, the lateral normals lie in XZ.
  const ShapeEntry entry(aCylinderShape(2, 5, std::numbers::pi / 2));
  const std::uint32_t lateral = faceOfType(entry, GeomAbs_Cylinder);
  const MeshData mesh = detail::tessellateEntry(entry, kQuality);
  for (const std::uint32_t v : faceVertices(mesh, lateral)) {
    const Vec3 p = pointAt(mesh.positions, v);
    EXPECT_LT(angleTo(pointAt(mesh.normals, v), unitOf({p[0], 0, p[2]})), kSurfaceNormalTolerance);
  }
}

}  // namespace
}  // namespace tinycad::kernel
