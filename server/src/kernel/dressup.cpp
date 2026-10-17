#include <BRepFilletAPI_LocalOperation.hxx>
#include <BRepFilletAPI_MakeChamfer.hxx>
#include <BRepFilletAPI_MakeFillet.hxx>
#include <Standard_Failure.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Vertex.hxx>

#include <cmath>
#include <memory>
#include <set>
#include <string>
#include <utility>

#include "guarded.hpp"
#include "history.hpp"
#include "operations.hpp"

// Fillet and chamfer of edges (spec 06 "Historie, role a topologie v adaptéru (M14)"; dressup.ts
// in TS).

namespace tinycad::kernel::detail {

namespace {

std::string nameOf(Dressup kind) { return kind == Dressup::Fillet ? "fillet" : "chamfer"; }

/**
 * The algorithm with every edge added; an edge OCCT does not take (Add is void and skips e.g.
 * the seam of a cylinder, M19.1: it ends up in no contour) is OperationFailed.
 */
std::unique_ptr<BRepFilletAPI_LocalOperation> makerWithEdges(Dressup kind, const ShapeEntry& entry,
                                                             std::span<const int> edges,
                                                             double size) {
  const std::string name = nameOf(kind);
  if (kind == Dressup::Fillet) {
    auto fillet = std::make_unique<BRepFilletAPI_MakeFillet>(entry.shape());
    for (const int index : edges) {
      const TopoDS_Edge& edge = TopoDS::Edge(entry.edge(index));
      fillet->Add(size, edge);
      if (fillet->Contour(edge) == 0) {
        fail(KernelErrorCode::OperationFailed,
             name + ": OCCT did not accept edge " + std::to_string(index));
      }
    }
    return fillet;
  }
  auto chamfer = std::make_unique<BRepFilletAPI_MakeChamfer>(entry.shape());
  for (const int index : edges) {
    const TopoDS_Edge& edge = TopoDS::Edge(entry.edge(index));
    chamfer->Add(size, edge);
    if (chamfer->Contour(edge) == 0) {
      fail(KernelErrorCode::OperationFailed,
           name + ": OCCT did not accept edge " + std::to_string(index));
    }
  }
  return chamfer;
}

/** Build and Shape; an OCCT exception or not done → OperationFailed. */
TopoDS_Shape built(BRepFilletAPI_LocalOperation& maker, const std::string& name) {
  try {
    maker.Build();
    if (!maker.IsDone()) fail(KernelErrorCode::OperationFailed, name + ": the algorithm failed");
    return maker.Shape();
  } catch (const Standard_Failure& e) {
    fail(KernelErrorCode::OperationFailed, name + ": " + e.ExceptionType() + ": " + e.what());
  }
}

}  // namespace

ShapeResult dressupShape(ShapeTable& shapes, Dressup kind, ShapeHandle shape,
                         std::span<const int> edges, double size) {
  const std::string name = nameOf(kind);
  if (!(std::isfinite(size) && size > 0)) {
    fail(KernelErrorCode::InvalidInput, name + ": the size must be finite and > 0");
  }
  const ShapeEntry& entry = shapes.find(shape);
  const int count = entry.edges().Extent();
  if (edges.empty()) fail(KernelErrorCode::InvalidInput, name + ": edges must not be empty");
  for (const int e : edges) {
    if (e < 0 || e >= count) {
      fail(KernelErrorCode::InvalidInput,
           name + ": edge " + std::to_string(e) + " is not in [0, " + std::to_string(count) + ")");
    }
  }
  if (std::set<int>(edges.begin(), edges.end()).size() != edges.size()) {
    fail(KernelErrorCode::InvalidInput, name + ": the same edge more than once");
  }
  // Every failure of the algorithm is OperationFailed, never Internal (spec 06 Kontrakt).
  const std::unique_ptr<BRepFilletAPI_LocalOperation> maker =
      makerWithEdges(kind, entry, edges, size);
  ShapeEntry output(built(*maker, name));
  if (!hasSolid(output.shape()))
    fail(KernelErrorCode::OperationFailed, name + ": the result has no solid");
  if (!isValidShape(output.shape()))
    fail(KernelErrorCode::OperationFailed, name + ": the result is not valid");
  ShapeResult result;
  result.history = HistoryCollector(*maker, output).collect({&entry});
  result.shape = shapes.add(std::move(output));
  return result;
}

}  // namespace tinycad::kernel::detail
