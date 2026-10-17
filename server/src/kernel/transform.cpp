#include <BRepBuilderAPI_Transform.hxx>
#include <gp_Trsf.hxx>

#include <map>
#include <string>
#include <utility>

#include "guarded.hpp"
#include "history.hpp"
#include "operations.hpp"
#include "tinycad/kernel/mesh.hpp"

// A rigid motion of a shape (spec 06 "Modelovací operace v adaptéru (M11)", M14).

namespace tinycad::kernel::detail {

ShapeResult transformShape(ShapeTable& shapes, ShapeHandle shape, const core::Mat4& m) {
  if (!isRigidMotion(m)) fail(KernelErrorCode::InvalidInput, "transform: m must be a rigid motion");
  const ShapeEntry& input = shapes.find(shape);
  // gp_Trsf takes the rows a11 … a34; Mat4 is column-major, so a_rc = m[c * 4 + r]. A rigid
  // motion only sets a location: the geometry (TShape) is shared, not copied.
  gp_Trsf trsf;
  trsf.SetValues(m[0], m[4], m[8], m[12], m[1], m[5], m[9], m[13], m[2], m[6], m[10], m[14]);
  BRepBuilderAPI_Transform maker(input.shape(), trsf, false, false);
  ShapeEntry moved(maker.Shape());
  // The edge roles of a makeFace result move along through Modified of the edges (M14).
  std::map<int, std::string> edgeRoles;
  for (const auto& [index, id] : input.edgeRoles()) {
    for (const TopoDS_Shape& item : maker.Modified(input.edge(index))) {
      const int target = moved.edgeIndex(item);
      if (target >= 0) edgeRoles[target] = id;
    }
  }
  moved.setEdgeRoles(std::move(edgeRoles));
  ShapeResult result;
  result.history = HistoryCollector(maker, moved).collect({&input});
  result.shape = shapes.add(std::move(moved));
  return result;
}

}  // namespace tinycad::kernel::detail
