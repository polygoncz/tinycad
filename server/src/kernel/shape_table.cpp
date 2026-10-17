#include "shape_table.hpp"

#include <TopAbs_ShapeEnum.hxx>
#include <TopExp.hxx>

#include <set>
#include <utility>

#include "guarded.hpp"

namespace tinycad::kernel::detail {

ShapeEntry::ShapeEntry(const TopoDS_Shape& shape) : shape_(shape) {
  TopExp::MapShapes(shape_, TopAbs_FACE, faces_);
  TopExp::MapShapes(shape_, TopAbs_EDGE, edges_);
  TopExp::MapShapes(shape_, TopAbs_VERTEX, vertices_);
}

int ShapeEntry::faceIndex(const TopoDS_Shape& shape) const { return faces_.FindIndex(shape) - 1; }

int ShapeEntry::edgeIndex(const TopoDS_Shape& shape) const { return edges_.FindIndex(shape) - 1; }

int ShapeEntry::vertexIndex(const TopoDS_Shape& shape) const {
  return vertices_.FindIndex(shape) - 1;
}

const ShapeEntry& ShapeTable::find(ShapeHandle handle) const {
  const auto found = entries_.find(static_cast<std::uint64_t>(handle));
  if (found == entries_.end()) {
    fail(KernelErrorCode::UnknownHandle,
         "Unknown shape handle " + std::to_string(static_cast<std::uint64_t>(handle)));
  }
  return found->second;
}

ShapeHandle ShapeTable::add(ShapeEntry entry) {
  ++lastHandle_;
  entries_.emplace(lastHandle_, std::move(entry));
  return ShapeHandle{lastHandle_};
}

void ShapeTable::release(std::span<const ShapeHandle> handles) {
  // Check everything first: release is atomic.
  if (!allDistinct(handles)) fail(KernelErrorCode::InvalidInput, "release: the same handle twice");
  for (const ShapeHandle h : handles) static_cast<void>(find(h));
  for (const ShapeHandle h : handles) entries_.erase(static_cast<std::uint64_t>(h));
}

bool allDistinct(std::span<const ShapeHandle> handles) {
  const std::set<ShapeHandle> distinct(handles.begin(), handles.end());
  return distinct.size() == handles.size();
}

}  // namespace tinycad::kernel::detail
