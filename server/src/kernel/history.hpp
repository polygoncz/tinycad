#pragma once

// The history of an OCCT algorithm as ShapeHistory (spec 06 "Historie, role a topologie v
// adaptéru (M14)"; history.ts in TS). Internal to tinycad_kernel.

#include <BRepBuilderAPI_MakeShape.hxx>

#include <vector>

#include "shape_table.hpp"
#include "tinycad/kernel/types.hpp"

namespace tinycad::kernel::detail {

/**
 * Collects the history of one algorithm from its inputs to its output entry. Every algorithm of
 * the kernel (BRepBuilderAPI_Transform, BRepAlgoAPI_*, BRepPrimAPI_MakePrism/MakeRevol,
 * BRepFilletAPI_*) is a BRepBuilderAPI_MakeShape with Modified, Generated and IsDeleted.
 */
class HistoryCollector {
 public:
  HistoryCollector(BRepBuilderAPI_MakeShape& maker, const ShapeEntry& output)
      : maker_(maker), output_(output) {}

  /**
   * The history from `inputs` (in call order) to the output:
   * - every face of every input exactly once: IsDeleted → deleted; otherwise the output faces
   *   IsSame as an item of Modified; none of them and the face itself in the output → the
   *   identity, not in the output → deleted;
   * - Generated of every face, edge and vertex of the inputs → only the faces in the output.
   * Entries are ordered by input, kind (face, edge, vertex) and index; targets ascend.
   */
  [[nodiscard]] ShapeHistory collect(const std::vector<const ShapeEntry*>& inputs);

  /** Indices of the output faces IsSame as an item of `list`, ascending without duplicates. */
  [[nodiscard]] std::vector<SubShapeIndex> outputFaces(const ShapeList& list) const;

 private:
  void collectGenerated(int input, SubShapeType type, const ShapeMap& map,
                        std::vector<HistoryLink>& generated);

  BRepBuilderAPI_MakeShape& maker_;
  const ShapeEntry& output_;
};

}  // namespace tinycad::kernel::detail
