#include <BRepAdaptor_Curve.hxx>
#include <BRepAdaptor_Surface.hxx>
#include <BRep_Tool.hxx>
#include <NCollection_IndexedDataMap.hxx>
#include <TopAbs_Orientation.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Vertex.hxx>
#include <gp_Pln.hxx>

#include <cmath>
#include <limits>
#include <set>
#include <vector>

#include "operations.hpp"

// Topology of a shape for naming (spec 06 "Historie, role a topologie v adaptéru (M14)";
// topology.ts in TS). Native OCCT has TopExp::MapShapesAndAncestors, so the adjacency edge →
// faces is one map instead of the O(F · E) explorer loop of the WASM build.

namespace tinycad::kernel {

const char* surfaceTypeName(SurfaceType type) {
  switch (type) {
    case SurfaceType::Plane:
      return "plane";
    case SurfaceType::Cylinder:
      return "cylinder";
    case SurfaceType::Cone:
      return "cone";
    case SurfaceType::Sphere:
      return "sphere";
    case SurfaceType::Torus:
      return "torus";
    case SurfaceType::Other:
      break;
  }
  return "other";
}

}  // namespace tinycad::kernel

namespace tinycad::kernel::detail {

namespace {

using AncestorMap = NCollection_IndexedDataMap<TopoDS_Shape, NCollection_List<TopoDS_Shape>,
                                               TopTools_ShapeMapHasher>;

SurfaceType surfaceTypeOf(GeomAbs_SurfaceType type) {
  switch (type) {
    case GeomAbs_Plane:
      return SurfaceType::Plane;
    case GeomAbs_Cylinder:
      return SurfaceType::Cylinder;
    case GeomAbs_Cone:
      return SurfaceType::Cone;
    case GeomAbs_Sphere:
      return SurfaceType::Sphere;
    case GeomAbs_Torus:
      return SurfaceType::Torus;
    default:
      return SurfaceType::Other;
  }
}

/** Indices of the end vertices of the edge, ascending without duplicates. */
std::vector<int> edgeVertices(const ShapeEntry& entry, const TopoDS_Shape& edge) {
  std::set<int> found;
  for (TopExp_Explorer explorer(edge, TopAbs_VERTEX); explorer.More(); explorer.Next()) {
    const int index = entry.vertexIndex(explorer.Current());
    if (index >= 0) found.insert(index);
  }
  return {found.begin(), found.end()};
}

/**
 * The point at the middle of the parameter range of the edge. A degenerated edge (the pole of a
 * revolved profile touching the axis) has no 3D curve: its vertex instead.
 */
Vec3 midpointOf(const TopoDS_Shape& shape) {
  const TopoDS_Edge& edge = TopoDS::Edge(shape);
  if (BRep_Tool::Degenerated(edge)) {
    const TopExp_Explorer explorer(edge, TopAbs_VERTEX);
    if (!explorer.More()) {
      const double nan = std::numeric_limits<double>::quiet_NaN();
      return {nan, nan, nan};
    }
    const gp_Pnt p = BRep_Tool::Pnt(TopoDS::Vertex(explorer.Current()));
    return {p.X(), p.Y(), p.Z()};
  }
  const BRepAdaptor_Curve curve(edge);
  const gp_Pnt p = curve.Value((curve.FirstParameter() + curve.LastParameter()) / 2);
  return {p.X(), p.Y(), p.Z()};
}

}  // namespace

FaceInfo faceInfoOf(const TopoDS_Shape& shape) {
  const TopoDS_Face& face = TopoDS::Face(shape);
  const BRepAdaptor_Surface surface(face, true);
  FaceInfo info;
  info.surface = surfaceTypeOf(surface.GetType());
  if (info.surface != SurfaceType::Plane) return info;
  const gp_Pln pln = surface.Plane();
  const gp_Pnt& location = pln.Location();
  const gp_Dir& direction = pln.Axis().Direction();
  // The surface normal is XDir × YDir of the plane frame: the axis direction for a right-handed
  // frame, its opposite for a left-handed one (gp_Pln::Direct). A reversed face points against
  // the normal of its surface.
  const double handed = pln.Direct() ? 1 : -1;
  const double reversed = face.Orientation() == TopAbs_REVERSED ? -1 : 1;
  const double sign = handed * reversed;
  info.plane = FacePlane{{location.X(), location.Y(), location.Z()},
                         {sign * direction.X(), sign * direction.Y(), sign * direction.Z()}};
  return info;
}

TopologySummary topologyOf(const ShapeEntry& entry) {
  AncestorMap ancestors;
  TopExp::MapShapesAndAncestors(entry.shape(), TopAbs_EDGE, TopAbs_FACE, ancestors);
  TopologySummary summary;
  for (int f = 0; f < entry.faces().Extent(); ++f)
    summary.faces.push_back(faceInfoOf(entry.face(f)));
  for (int e = 0; e < entry.edges().Extent(); ++e) {
    const TopoDS_Shape& edge = entry.edge(e);
    std::set<int> faces;
    if (const NCollection_List<TopoDS_Shape>* list = ancestors.Seek(edge)) {
      for (const TopoDS_Shape& face : *list) {
        const int index = entry.faceIndex(face);
        if (index >= 0) faces.insert(index);
      }
    }
    EdgeInfo info;
    info.faces.assign(faces.begin(), faces.end());
    info.vertices = edgeVertices(entry, edge);
    info.midpoint = midpointOf(edge);
    summary.edges.push_back(std::move(info));
  }
  summary.vertexCount = entry.vertices().Extent();
  return summary;
}

}  // namespace tinycad::kernel::detail
