#include <BRepBuilderAPI_MakeEdge.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_MakeWire.hxx>
#include <Geom_BSplineCurve.hxx>
#include <NCollection_Array1.hxx>
#include <ShapeFix_Face.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Wire.hxx>
#include <gp_Ax2.hxx>
#include <gp_Ax3.hxx>
#include <gp_Circ.hxx>
#include <gp_Dir.hxx>
#include <gp_Pln.hxx>
#include <gp_Pnt.hxx>

#include <map>
#include <string>
#include <utility>
#include <vector>

#include "tinycad/occt2d/curves.hpp"

#include "guarded.hpp"
#include "operations.hpp"

// A planar face from closed loops (spec 06 "Rovinná plocha v adaptéru (M12)", M14, M29; face.ts
// in TS). The edges are built in space from the plane frame, exactly as the TS adapter does.

namespace tinycad::kernel::detail {

using occt2d::CompressedKnots;
using occt2d::compressKnots;
using occt2d::Curve2;
using occt2d::dist;
using occt2d::Kind;
using occt2d::Vec2;

namespace {

/** An edge of the face built from a curve with an entity id (as it is in its wire). */
struct IdEdge {
  TopoDS_Edge edge;
  std::string id;
};

/** Builds the face of one input: the plane, the wires and the edges with ids. */
class FaceBuilder {
 public:
  explicit FaceBuilder(const core::Plane& plane) : plane_(plane) {}

  /**
   * gp_Pln with the frame of the plane, the wires by BRepBuilderAPI_MakeWire, the face by
   * BRepBuilderAPI_MakeFace with the holes added, then ShapeFix_Face::FixOrientation (orients
   * the holes). A wire that does not close or a face BRepCheck_Analyzer finds invalid (a
   * self-intersecting loop) is OperationFailed.
   */
  TopoDS_Shape build(const FaceInput& input) {
    const gp_Pln pln(gp_Ax3(point({0, 0}), normal(), xDir()));
    BRepBuilderAPI_MakeFace maker(pln, wireOf(input.outer), true);
    for (const ProfileLoop& hole : input.holes) maker.Add(wireOf(hole));
    if (!maker.IsDone())
      fail(KernelErrorCode::OperationFailed, "makeFace: the face could not be built");
    ShapeFix_Face fix(maker.Face());
    // FixOrientation, not Perform: Perform alone leaves a hole with the orientation of the outer
    // wire, which BRepCheck_Analyzer rejects (checked on a square with a circular hole, M12).
    fix.FixOrientation();
    const TopoDS_Face fixed = fix.Face();
    if (!isValidShape(fixed))
      fail(KernelErrorCode::OperationFailed, "makeFace: the face is not valid");
    return fixed;
  }

  [[nodiscard]] const std::vector<IdEdge>& idEdges() const { return idEdges_; }

 private:
  /**
   * The wire of the loop. For a curve with an id, the edge as it is in the wire (MakeWire.Edge(),
   * possibly a copy with merged vertices) goes to idEdges_.
   */
  TopoDS_Wire wireOf(const ProfileLoop& loop) {
    BRepBuilderAPI_MakeWire maker;
    for (const Curve2& c : loop) {
      maker.Add(edgeOf(c));
      if (!c.id.empty() && maker.IsDone()) idEdges_.push_back({maker.Edge(), c.id});
    }
    if (!maker.IsDone())
      fail(KernelErrorCode::OperationFailed, "makeFace: a loop does not form a wire");
    return maker.Wire();
  }

  TopoDS_Edge edgeOf(const Curve2& c) const {
    switch (c.kind) {
      case Kind::Line:
        return done(BRepBuilderAPI_MakeEdge(point(c.from), point(c.to)));
      case Kind::Arc: {
        const gp_Circ circle = circleOf(c.center, dist(c.from, c.center));
        // An OCCT circle runs counter-clockwise about the normal: a clockwise arc is the
        // counter-clockwise arc from `to` to `from`.
        return c.ccw ? done(BRepBuilderAPI_MakeEdge(circle, point(c.from), point(c.to)))
                     : done(BRepBuilderAPI_MakeEdge(circle, point(c.to), point(c.from)));
      }
      case Kind::Circle:
        return done(BRepBuilderAPI_MakeEdge(circleOf(c.center, c.radius)));
      case Kind::BSpline:
        break;
    }
    return done(BRepBuilderAPI_MakeEdge(splineOf(c)));
  }

  /** The non-rational spline in space: the poles mapped into the plane, compressed knots. */
  Handle(Geom_BSplineCurve) splineOf(const Curve2& c) const {
    const CompressedKnots compressed = compressKnots(c.knots);
    const int poleCount = static_cast<int>(c.poles.size());
    const int knotCount = static_cast<int>(compressed.knots.size());
    NCollection_Array1<gp_Pnt> poles(1, poleCount);
    for (int i = 0; i < poleCount; ++i)
      poles.SetValue(i + 1, point(c.poles[static_cast<std::size_t>(i)]));
    NCollection_Array1<double> knots(1, knotCount);
    NCollection_Array1<int> multiplicities(1, knotCount);
    for (int i = 0; i < knotCount; ++i) {
      knots.SetValue(i + 1, compressed.knots[static_cast<std::size_t>(i)]);
      multiplicities.SetValue(i + 1, compressed.multiplicities[static_cast<std::size_t>(i)]);
    }
    return new Geom_BSplineCurve(poles, knots, multiplicities, c.degree, false);
  }

  static TopoDS_Edge done(BRepBuilderAPI_MakeEdge&& maker) {
    if (!maker.IsDone())
      fail(KernelErrorCode::OperationFailed, "makeFace: an edge could not be built");
    return maker.Edge();
  }

  /** The circle in the plane: centre `center`, axis = plane normal, x axis = plane xDir. */
  [[nodiscard]] gp_Circ circleOf(Vec2 center, double radius) const {
    return {gp_Ax2(point(center), normal(), xDir()), radius};
  }

  /** The plane point (x, y) in space: origin + x·xDir + y·(normal × xDir). */
  [[nodiscard]] gp_Pnt point(Vec2 v) const {
    const core::Vec3& o = plane_.origin;
    const core::Vec3& x = plane_.xDir;
    const core::Vec3& n = plane_.normal;
    const core::Vec3 y{n[1] * x[2] - n[2] * x[1], n[2] * x[0] - n[0] * x[2],
                       n[0] * x[1] - n[1] * x[0]};
    return {o[0] + v[0] * x[0] + v[1] * y[0], o[1] + v[0] * x[1] + v[1] * y[1],
            o[2] + v[0] * x[2] + v[1] * y[2]};
  }

  [[nodiscard]] gp_Dir normal() const {
    return {plane_.normal[0], plane_.normal[1], plane_.normal[2]};
  }
  [[nodiscard]] gp_Dir xDir() const { return {plane_.xDir[0], plane_.xDir[1], plane_.xDir[2]}; }

  const core::Plane& plane_;
  std::vector<IdEdge> idEdges_;
};

}  // namespace

ShapeResult makeFaceShape(ShapeTable& shapes, const FaceInput& p) {
  const std::vector<std::string> errors = validateFaceInput(p);
  if (!errors.empty()) {
    std::string text = "makeFace:";
    for (std::size_t i = 0; i < errors.size(); ++i) text += (i == 0 ? " " : "; ") + errors[i];
    fail(KernelErrorCode::InvalidInput, text);
  }
  FaceBuilder builder(p.plane);
  ShapeEntry entry(builder.build(p));
  // Edge index → id: each edge of the face IsSame as an edge built with an id; ShapeFix_Face
  // only reorients, which IsSame ignores (spec 06, R119).
  std::map<int, std::string> edgeRoles;
  for (const IdEdge& e : builder.idEdges()) {
    const int index = entry.edgeIndex(e.edge);
    if (index >= 0) edgeRoles[index] = e.id;
  }
  ShapeResult result;
  if (!edgeRoles.empty()) {
    Roles roles;
    for (const auto& [index, id] : edgeRoles)
      roles["edge:" + id].push_back({SubShapeType::Edge, index});
    result.roles = std::move(roles);
  }
  entry.setEdgeRoles(std::move(edgeRoles));
  result.shape = shapes.add(std::move(entry));
  return result;
}

}  // namespace tinycad::kernel::detail
