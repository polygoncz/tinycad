#include <BRepLib_ToolTriangulatedShape.hxx>
#include <BRepMesh_IncrementalMesh.hxx>
#include <BRep_Tool.hxx>
#include <Poly_PolygonOnTriangulation.hxx>
#include <Poly_Triangulation.hxx>
#include <TopAbs_Orientation.hxx>
#include <TopLoc_Location.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Vertex.hxx>
#include <gp_Trsf.hxx>

#include <cmath>
#include <cstdint>

#include "guarded.hpp"
#include "operations.hpp"

// Tessellation (spec 06 "Tessellace v adaptéru"; tessellate.ts in TS): BRepMesh, then the
// triangulation of every face and the polygon of every edge copied into the flat arrays of
// MeshData. Faces and edges go in the order of the sub-shape maps, so faceIndex / edgeIndex is
// the SubShapeIndex.

namespace tinycad::kernel::detail {

namespace {

void pushPoint(std::vector<float>& out, const gp_Pnt& p) {
  out.push_back(static_cast<float>(p.X()));
  out.push_back(static_cast<float>(p.Y()));
  out.push_back(static_cast<float>(p.Z()));
}

/**
 * Appends the triangulation of one face with its own vertices. Nodes and normals are moved by
 * the face location; a REVERSED face gets two vertices of every triangle swapped and its normals
 * flipped, so triangles are counter-clockwise from outside and the normals point out. A face
 * without triangles is left out of faceRanges.
 */
void appendFace(const TopoDS_Shape& shape, int faceIndex, MeshData& out) {
  const TopoDS_Face& face = TopoDS::Face(shape);
  TopLoc_Location location;
  const Handle(Poly_Triangulation) triangulation = BRep_Tool::Triangulation(face, location);
  if (triangulation.IsNull() || triangulation->NbTriangles() == 0) return;
  // Normals of the real surface at the UV of every node (GeomLib::NormEstim), in the frame of
  // the surface without the face location and ignoring the face orientation; does nothing if
  // the triangulation already has normals.
  BRepLib_ToolTriangulatedShape::ComputeNormals(face, triangulation);
  if (!triangulation->HasNormals()) return;
  const gp_Trsf trsf = location.Transformation();
  const bool reversed = face.Orientation() == TopAbs_REVERSED;
  const double sign = reversed ? -1 : 1;

  const auto base = static_cast<std::uint32_t>(out.positions.size() / 3);
  const auto firstTriangle = static_cast<std::uint32_t>(out.indices.size() / 3);
  for (int i = 1; i <= triangulation->NbNodes(); ++i) {
    pushPoint(out.positions, triangulation->Node(i).Transformed(trsf));
    // gp_Dir::Transformed applies only the rotation part of the location.
    const gp_Dir normal = triangulation->Normal(i).Transformed(trsf);
    out.normals.push_back(static_cast<float>(sign * normal.X()));
    out.normals.push_back(static_cast<float>(sign * normal.Y()));
    out.normals.push_back(static_cast<float>(sign * normal.Z()));
  }
  const int triangleCount = triangulation->NbTriangles();
  for (int t = 1; t <= triangleCount; ++t) {
    int a = 0;
    int b = 0;
    int c = 0;
    triangulation->Triangle(t).Get(a, b, c);
    const auto index = [base](int node) { return base + static_cast<std::uint32_t>(node - 1); };
    out.indices.push_back(index(a));
    out.indices.push_back(index(reversed ? c : b));
    out.indices.push_back(index(reversed ? b : c));
  }
  out.faceRanges.push_back(static_cast<std::uint32_t>(faceIndex));
  out.faceRanges.push_back(firstTriangle);
  out.faceRanges.push_back(static_cast<std::uint32_t>(triangleCount));
}

/**
 * Appends the polyline of one edge: BRep_Tool::PolygonOnTriangulation picks the polygon on the
 * triangulation of a face adjacent to the edge; its nodes index that triangulation and the
 * returned location places them. A degenerated edge or an edge without a polygon of ≥ 2 points
 * is left out of edgeRanges.
 */
void appendEdge(const TopoDS_Shape& shape, int edgeIndex, MeshData& out) {
  const TopoDS_Edge& edge = TopoDS::Edge(shape);
  if (BRep_Tool::Degenerated(edge)) return;
  Handle(Poly_PolygonOnTriangulation) polygon;
  Handle(Poly_Triangulation) triangulation;
  TopLoc_Location location;
  BRep_Tool::PolygonOnTriangulation(edge, polygon, triangulation, location);
  if (polygon.IsNull() || triangulation.IsNull()) return;
  const int pointCount = polygon->NbNodes();
  if (pointCount < 2) return;
  const gp_Trsf trsf = location.Transformation();
  const auto firstPoint = static_cast<std::uint32_t>(out.edgePositions.size() / 3);
  for (int i = 1; i <= pointCount; ++i) {
    pushPoint(out.edgePositions, triangulation->Node(polygon->Node(i)).Transformed(trsf));
  }
  out.edgeRanges.push_back(static_cast<std::uint32_t>(edgeIndex));
  out.edgeRanges.push_back(firstPoint);
  out.edgeRanges.push_back(static_cast<std::uint32_t>(pointCount));
}

bool positive(double x) { return std::isfinite(x) && x > 0; }

}  // namespace

MeshData tessellateEntry(const ShapeEntry& entry, const MeshQuality& q) {
  if (!positive(q.linearDeflection)) {
    fail(KernelErrorCode::InvalidInput, "tessellate: linearDeflection must be finite and > 0");
  }
  if (!positive(q.angularDeflection)) {
    fail(KernelErrorCode::InvalidInput, "tessellate: angularDeflection must be finite and > 0");
  }
  // Absolute deflection, not in parallel (one caller per kernel, decision N13). The constructor
  // does the meshing and stores the triangulation in the shape.
  const BRepMesh_IncrementalMesh mesher(entry.shape(), q.linearDeflection, false,
                                        q.angularDeflection, false);
  MeshData out;
  for (int f = 0; f < entry.faces().Extent(); ++f) appendFace(entry.face(f), f, out);
  for (int e = 0; e < entry.edges().Extent(); ++e) appendEdge(entry.edge(e), e, out);
  return out;
}

}  // namespace tinycad::kernel::detail
