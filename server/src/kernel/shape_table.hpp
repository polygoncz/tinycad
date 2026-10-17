#pragma once

// What the kernel keeps per handle (spec 06 "Datové struktury na obou stranách"; shape-entry.ts
// and the Map of OcctKernelImpl in TS). Internal to tinycad_kernel.

#include <NCollection_IndexedMap.hxx>
#include <NCollection_List.hxx>
#include <TopTools_ShapeMapHasher.hxx>
#include <TopoDS_Shape.hxx>

#include <cstdint>
#include <map>
#include <span>
#include <string>
#include <unordered_map>

#include "tinycad/kernel/types.hpp"

namespace tinycad::kernel::detail {

/** Distinct sub-shapes in the order of TopExp::MapShapes, looked up by IsSame. */
using ShapeMap = NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher>;
using ShapeList = NCollection_List<TopoDS_Shape>;

/**
 * A shape with its sub-shape maps, computed once when the entry is made: the position in a map
 * minus one is the SubShapeIndex, stable for the handle. A plain value: TopoDS_Shape and the maps
 * hold OCCT handles (reference counted), so destroying the entry frees what it owned.
 */
class ShapeEntry {
 public:
  explicit ShapeEntry(const TopoDS_Shape& shape);

  [[nodiscard]] const TopoDS_Shape& shape() const { return shape_; }
  [[nodiscard]] const ShapeMap& faces() const { return faces_; }
  [[nodiscard]] const ShapeMap& edges() const { return edges_; }
  [[nodiscard]] const ShapeMap& vertices() const { return vertices_; }

  /** The face at a SubShapeIndex (from 0). */
  [[nodiscard]] const TopoDS_Shape& face(int index) const { return faces_.FindKey(index + 1); }
  [[nodiscard]] const TopoDS_Shape& edge(int index) const { return edges_.FindKey(index + 1); }

  /** SubShapeIndex of the face IsSame as `shape`, or -1. */
  [[nodiscard]] int faceIndex(const TopoDS_Shape& shape) const;
  /** SubShapeIndex of the edge IsSame as `shape`, or -1. */
  [[nodiscard]] int edgeIndex(const TopoDS_Shape& shape) const;
  /** SubShapeIndex of the vertex IsSame as `shape`, or -1. */
  [[nodiscard]] int vertexIndex(const TopoDS_Shape& shape) const;

  /**
   * Edge index → id of the sketch entity the edge was made from (spec 06, M14): set by makeFace,
   * carried over by transform, read by extrude and revolve for the roles face:side:<id>.
   */
  [[nodiscard]] const std::map<int, std::string>& edgeRoles() const { return edgeRoles_; }
  void setEdgeRoles(std::map<int, std::string> roles) { edgeRoles_ = std::move(roles); }

 private:
  TopoDS_Shape shape_;
  ShapeMap faces_;
  ShapeMap edges_;
  ShapeMap vertices_;
  std::map<int, std::string> edgeRoles_;
};

/**
 * Handle → ShapeEntry. Handles come from a growing counter starting at 1, so a handle is never
 * reused (decision N14). References returned by find stay valid until that handle is released.
 */
class ShapeTable {
 public:
  /** The entry of a live handle; UnknownHandle (KernelFailure) otherwise. */
  [[nodiscard]] const ShapeEntry& find(ShapeHandle handle) const;

  /** Stores the entry under a new handle. Call only when the operation has succeeded. */
  ShapeHandle add(ShapeEntry entry);

  /**
   * Atomic: the same handle twice → InvalidInput, an unknown one → UnknownHandle, and then
   * nothing is released.
   */
  void release(std::span<const ShapeHandle> handles);

  [[nodiscard]] std::size_t liveCount() const { return entries_.size(); }

 private:
  std::unordered_map<std::uint64_t, ShapeEntry> entries_;
  std::uint64_t lastHandle_ = 0;
};

/** The handles of `handles` are pairwise different. */
bool allDistinct(std::span<const ShapeHandle> handles);

}  // namespace tinycad::kernel::detail
