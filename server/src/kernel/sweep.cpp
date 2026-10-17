#include <BRepPrimAPI_MakePrism.hxx>
#include <BRepPrimAPI_MakeRevol.hxx>
#include <BRepPrimAPI_MakeSweep.hxx>
#include <TopAbs_ShapeEnum.hxx>
#include <TopExp_Explorer.hxx>
#include <gp_Ax1.hxx>
#include <gp_Dir.hxx>
#include <gp_Pnt.hxx>
#include <gp_Vec.hxx>

#include <algorithm>
#include <cmath>
#include <map>
#include <numbers>
#include <set>
#include <string>
#include <utility>
#include <vector>

#include "guarded.hpp"
#include "history.hpp"
#include "operations.hpp"

// Sweeping a planar face (spec 06 "Tažení v adaptéru (M13)"): a prism and a solid of revolution,
// with roles and history (M14; sweep.ts in TS).

namespace tinycad::kernel::detail {

namespace {

/** Spec 06: an extrude direction and a revolve axis must be longer than this. */
constexpr double kMinAxisLength = 1e-9;
/** Spec 06: revolve takes 0 < angle ≤ 2π + this. */
constexpr double kAngleTolerance = 1e-9;
constexpr double kTurn = 2 * std::numbers::pi;

/** InvalidInput unless the profile is a face (TopAbs_FACE). */
void requireFace(const ShapeEntry& profile, const std::string& op) {
  if (profile.shape().ShapeType() != TopAbs_FACE) {
    fail(KernelErrorCode::InvalidInput, op + ": the profile is not a face");
  }
}

/**
 * The result of the sweep, if the algorithm is done and the result contains a valid solid;
 * otherwise OperationFailed (an axis through the profile, spec 06 R63).
 */
TopoDS_Shape checkedSolid(BRepPrimAPI_MakeSweep& maker, const std::string& op) {
  if (!maker.IsDone()) fail(KernelErrorCode::OperationFailed, op + ": the algorithm failed");
  const TopoDS_Shape& result = maker.Shape();
  if (!hasSolid(result)) fail(KernelErrorCode::OperationFailed, op + ": the result has no solid");
  if (!isValidShape(result))
    fail(KernelErrorCode::OperationFailed, op + ": the result is not valid");
  return result;
}

/**
 * Roles and history of one sweep (spec 06, M14): face:start and face:end from FirstShape and
 * LastShape, only when they are in the result (a full revolution has neither); face:side:<id>
 * from Generated of each profile edge with a role; the history with the profile as input 0.
 */
class SweepDescription {
 public:
  SweepDescription(BRepPrimAPI_MakeSweep& maker, const ShapeEntry& profile,
                   const ShapeEntry& output)
      : maker_(maker), profile_(profile), output_(output), history_(maker, output) {}

  ShapeResult describe() {
    Roles roles;
    std::set<int> claimed;
    const auto end = [&](const std::string& role, const TopoDS_Shape& shape) {
      const int index = output_.faceIndex(shape);
      if (index < 0) return;
      roles[role] = {{SubShapeType::Face, index}};
      claimed.insert(index);
    };
    end("face:start", maker_.FirstShape());
    end("face:end", maker_.LastShape());
    // Faces swept from each profile edge by Generated; an edge whose Generated is empty gets the
    // fallback by its vertices, among the faces nobody else claims (sweptByVertices).
    std::vector<std::vector<int>> generated;
    for (int e = 0; e < profile_.edges().Extent(); ++e) {
      std::vector<int> faces;
      for (const SubShapeIndex& f : history_.outputFaces(maker_.Generated(profile_.edge(e)))) {
        faces.push_back(f.index);
        claimed.insert(f.index);
      }
      generated.push_back(std::move(faces));
    }
    std::map<std::string, std::set<int>> sides;
    for (const auto& [edgeIndex, id] : profile_.edgeRoles()) {
      std::vector<int> swept = generated[static_cast<std::size_t>(edgeIndex)];
      if (swept.empty()) swept = sweptByVertices(profile_.edge(edgeIndex), claimed);
      sides[id].insert(swept.begin(), swept.end());
    }
    for (const auto& [id, faces] : sides) {
      if (faces.empty()) continue;
      std::vector<SubShapeIndex>& role = roles["face:side:" + id];
      for (const int f : faces) role.push_back({SubShapeType::Face, f});
    }
    ShapeResult result;
    result.history = history_.collect({&profile_});
    if (!roles.empty()) result.roles = std::move(roles);
    return result;
  }

 private:
  /**
   * Fallback of Generated for a side face: the unclaimed output faces bounded by every edge
   * swept from a vertex of the profile edge. BRepPrimAPI_MakeRevol returns an empty Generated
   * for an edge perpendicular to the axis in a full revolution, and the result has no seam on
   * the planar annulus swept from it (M14, R118), so the annulus is found by its circles.
   */
  std::vector<int> sweptByVertices(const TopoDS_Shape& edge, const std::set<int>& claimed) {
    std::set<int> rings;
    for (TopExp_Explorer vertices(edge, TopAbs_VERTEX); vertices.More(); vertices.Next()) {
      for (const TopoDS_Shape& item : maker_.Generated(vertices.Current())) {
        const int index = item.ShapeType() == TopAbs_EDGE ? output_.edgeIndex(item) : -1;
        if (index >= 0) rings.insert(index);
      }
    }
    if (rings.empty()) return {};
    std::vector<int> found;
    for (int f = 0; f < output_.faces().Extent(); ++f) {
      if (claimed.contains(f)) continue;
      std::set<int> bounding;
      for (TopExp_Explorer edges(output_.face(f), TopAbs_EDGE); edges.More(); edges.Next()) {
        bounding.insert(output_.edgeIndex(edges.Current()));
      }
      if (std::includes(bounding.begin(), bounding.end(), rings.begin(), rings.end())) {
        found.push_back(f);
      }
    }
    return found;
  }

  BRepPrimAPI_MakeSweep& maker_;
  const ShapeEntry& profile_;
  const ShapeEntry& output_;
  HistoryCollector history_;
};

ShapeResult storeSweep(ShapeTable& shapes, BRepPrimAPI_MakeSweep& maker, const ShapeEntry& profile,
                       const std::string& op) {
  ShapeEntry output(checkedSolid(maker, op));
  ShapeResult result = SweepDescription(maker, profile, output).describe();
  result.shape = shapes.add(std::move(output));
  return result;
}

}  // namespace

ShapeResult extrudeShape(ShapeTable& shapes, ShapeHandle profile, const Vec3& direction,
                         double distance) {
  if (!isFinite(direction))
    fail(KernelErrorCode::InvalidInput, "extrude: direction must be finite");
  const double length = lengthOf(direction);
  if (!(length > kMinAxisLength)) {
    fail(KernelErrorCode::InvalidInput, "extrude: direction must not be zero");
  }
  if (!(std::isfinite(distance) && distance > 0)) {
    fail(KernelErrorCode::InvalidInput, "extrude: distance must be finite and > 0");
  }
  const ShapeEntry& face = shapes.find(profile);
  requireFace(face, "extrude");
  const double k = distance / length;
  // Without a copy, with canonized surfaces.
  BRepPrimAPI_MakePrism maker(
      face.shape(), gp_Vec(direction[0] * k, direction[1] * k, direction[2] * k), false, true);
  return storeSweep(shapes, maker, face, "extrude");
}

ShapeResult revolveShape(ShapeTable& shapes, ShapeHandle profile, const Axis& axis, double angle) {
  if (!isFinite(axis.origin) || !isFinite(axis.direction)) {
    fail(KernelErrorCode::InvalidInput, "revolve: the axis must be finite");
  }
  if (!(lengthOf(axis.direction) > kMinAxisLength)) {
    fail(KernelErrorCode::InvalidInput, "revolve: the axis direction must not be zero");
  }
  if (!(std::isfinite(angle) && angle > 0 && angle <= kTurn + kAngleTolerance)) {
    fail(KernelErrorCode::InvalidInput, "revolve: angle must be in (0, 2π]");
  }
  const ShapeEntry& face = shapes.find(profile);
  requireFace(face, "revolve");
  const gp_Ax1 ax1(gp_Pnt(axis.origin[0], axis.origin[1], axis.origin[2]),
                   gp_Dir(axis.direction[0], axis.direction[1], axis.direction[2]));
  // An angle within the tolerance above 2π is a full turn. Without a copy.
  BRepPrimAPI_MakeRevol maker(face.shape(), ax1, std::min(angle, kTurn), false);
  return storeSweep(shapes, maker, face, "revolve");
}

}  // namespace tinycad::kernel::detail
