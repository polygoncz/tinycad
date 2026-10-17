#include <BRepBndLib.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <Bnd_Box.hxx>
#include <TopAbs_ShapeEnum.hxx>
#include <TopExp_Explorer.hxx>

#include <cmath>

#include "operations.hpp"

// The queries of a shape (spec 06 Kontrakt `boundingBox`) and the checks the operations share.

namespace tinycad::kernel::detail {

BoundingBox boundingBoxOf(const ShapeEntry& entry) {
  Bnd_Box box;
  // Without the shape tolerance: the box of makeBox is exactly [origin, origin + size] (spec 06).
  BRepBndLib::AddOptimal(entry.shape(), box, false, false);
  double xMin = 0;
  double yMin = 0;
  double zMin = 0;
  double xMax = 0;
  double yMax = 0;
  double zMax = 0;
  box.Get(xMin, yMin, zMin, xMax, yMax, zMax);
  return {{xMin, yMin, zMin}, {xMax, yMax, zMax}};
}

bool hasSolid(const TopoDS_Shape& shape) {
  const TopExp_Explorer explorer(shape, TopAbs_SOLID);
  return explorer.More();
}

bool isValidShape(const TopoDS_Shape& shape) {
  const BRepCheck_Analyzer analyzer(shape, true);
  return analyzer.IsValid();
}

bool isFinite(const Vec3& v) {
  return std::isfinite(v[0]) && std::isfinite(v[1]) && std::isfinite(v[2]);
}

double lengthOf(const Vec3& v) { return std::hypot(v[0], v[1], v[2]); }

}  // namespace tinycad::kernel::detail
