#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <gp_Ax2.hxx>
#include <gp_Dir.hxx>
#include <gp_Pnt.hxx>

#include <algorithm>
#include <cmath>
#include <utility>
#include <vector>

#include "guarded.hpp"
#include "operations.hpp"

// The primitives with their roles (spec 06 "Stav po M14", "Modelovací operace v adaptéru (M11)").

namespace tinycad::kernel::detail {

namespace {

/** Spec 06: a cylinder axis must be longer than this. */
constexpr double kMinAxisLength = 1e-9;

/** The face of the entry IsSame as `face`, as a role; Internal if it is not there. */
std::vector<SubShapeIndex> faceRole(const ShapeEntry& entry, const TopoDS_Shape& face,
                                    const std::string& role) {
  const int index = entry.faceIndex(face);
  if (index < 0) fail(KernelErrorCode::Internal, role + ": the face is not in the shape");
  return {{SubShapeType::Face, index}};
}

double dot(const Vec3& a, const Vec3& b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

bool positive(double x) { return std::isfinite(x) && x > 0; }

}  // namespace

ShapeResult makeBoxShape(ShapeTable& shapes, const BoxInput& p) {
  if (!isFinite(p.origin)) fail(KernelErrorCode::InvalidInput, "makeBox: origin must be finite");
  if (!(positive(p.size[0]) && positive(p.size[1]) && positive(p.size[2]))) {
    fail(KernelErrorCode::InvalidInput, "makeBox: size must be finite and > 0");
  }
  BRepPrimAPI_MakeBox maker(gp_Pnt(p.origin[0], p.origin[1], p.origin[2]), p.size[0], p.size[1],
                            p.size[2]);
  ShapeEntry entry(maker.Shape());
  // Roles by world axes (spec 06, R93). BRepPrimAPI_MakeBox names its faces after its own view:
  // Left/Right are YMin/YMax, Back/Front are XMin/XMax.
  Roles roles;
  roles["face:top"] = faceRole(entry, maker.TopFace(), "face:top");
  roles["face:bottom"] = faceRole(entry, maker.BottomFace(), "face:bottom");
  roles["face:front"] = faceRole(entry, maker.LeftFace(), "face:front");
  roles["face:back"] = faceRole(entry, maker.RightFace(), "face:back");
  roles["face:left"] = faceRole(entry, maker.BackFace(), "face:left");
  roles["face:right"] = faceRole(entry, maker.FrontFace(), "face:right");
  ShapeResult result;
  result.roles = std::move(roles);
  result.shape = shapes.add(std::move(entry));
  return result;
}

ShapeResult makeCylinderShape(ShapeTable& shapes, const CylinderInput& p) {
  if (!isFinite(p.base) || !isFinite(p.axis)) {
    fail(KernelErrorCode::InvalidInput, "makeCylinder: base and axis must be finite");
  }
  if (!(lengthOf(p.axis) > kMinAxisLength)) {
    fail(KernelErrorCode::InvalidInput, "makeCylinder: axis must not be zero");
  }
  if (!positive(p.radius) || !positive(p.height)) {
    fail(KernelErrorCode::InvalidInput, "makeCylinder: radius and height must be finite and > 0");
  }
  const gp_Ax2 frame(gp_Pnt(p.base[0], p.base[1], p.base[2]),
                     gp_Dir(p.axis[0], p.axis[1], p.axis[2]));
  BRepPrimAPI_MakeCylinder maker(frame, p.radius, p.height);
  ShapeEntry entry(maker.Shape());
  // face:side is the lateral face of BRepPrimAPI_MakeOneAxis; of the two planar faces, the
  // bottom is the one whose plane point projects lower onto the axis (spec 06, M14).
  const std::vector<SubShapeIndex> side = faceRole(entry, maker.Face(), "face:side");
  std::vector<std::pair<double, int>> caps;
  for (int index = 0; index < entry.faces().Extent(); ++index) {
    if (index == side.front().index) continue;
    const FaceInfo info = faceInfoOf(entry.face(index));
    if (info.plane) caps.emplace_back(dot(info.plane->origin, p.axis), index);
  }
  if (caps.size() != 2) fail(KernelErrorCode::Internal, "makeCylinder: expected two planar caps");
  std::sort(caps.begin(), caps.end());
  Roles roles;
  roles["face:bottom"] = {{SubShapeType::Face, caps[0].second}};
  roles["face:top"] = {{SubShapeType::Face, caps[1].second}};
  roles["face:side"] = side;
  ShapeResult result;
  result.roles = std::move(roles);
  result.shape = shapes.add(std::move(entry));
  return result;
}

}  // namespace tinycad::kernel::detail
