#include <BRepAlgoAPI_BooleanOperation.hxx>
#include <BRepAlgoAPI_Common.hxx>
#include <BRepAlgoAPI_Cut.hxx>
#include <BRepAlgoAPI_Fuse.hxx>

#include <memory>
#include <utility>
#include <vector>

#include "guarded.hpp"
#include "history.hpp"
#include "operations.hpp"

// Booleans of several targets and tools (spec 06 Kontrakt `boolean`, "Modelovací operace v
// adaptéru (M11)").

namespace tinycad::kernel::detail {

namespace {

/** The OCCT algorithm of the operation; nullptr for a value outside the enum. */
std::unique_ptr<BRepAlgoAPI_BooleanOperation> booleanAlgo(BooleanOp op) {
  switch (op) {
    case BooleanOp::Union:
      return std::make_unique<BRepAlgoAPI_Fuse>();
    case BooleanOp::Subtract:
      return std::make_unique<BRepAlgoAPI_Cut>();
    case BooleanOp::Intersect:
      return std::make_unique<BRepAlgoAPI_Common>();
  }
  return nullptr;
}

ShapeList shapeList(const std::vector<const ShapeEntry*>& entries) {
  ShapeList list;
  for (const ShapeEntry* entry : entries) list.Append(entry->shape());
  return list;
}

}  // namespace

ShapeResult booleanShape(ShapeTable& shapes, BooleanOp op, std::span<const ShapeHandle> targets,
                         std::span<const ShapeHandle> tools) {
  std::unique_ptr<BRepAlgoAPI_BooleanOperation> algo = booleanAlgo(op);
  if (!algo) fail(KernelErrorCode::InvalidInput, "boolean: unknown op");
  if (targets.empty() || tools.empty()) {
    fail(KernelErrorCode::InvalidInput, "boolean: targets and tools must not be empty");
  }
  std::vector<ShapeHandle> all(targets.begin(), targets.end());
  all.insert(all.end(), tools.begin(), tools.end());
  if (!allDistinct(all)) fail(KernelErrorCode::InvalidInput, "boolean: the same handle twice");

  // History inputs are [...targets, ...tools] in call order.
  std::vector<const ShapeEntry*> inputs;
  for (const ShapeHandle h : all) inputs.push_back(&shapes.find(h));
  const std::vector<const ShapeEntry*> targetEntries(inputs.begin(),
                                                     inputs.begin() + std::ssize(targets));
  const std::vector<const ShapeEntry*> toolEntries(inputs.begin() + std::ssize(targets),
                                                   inputs.end());
  algo->SetArguments(shapeList(targetEntries));
  algo->SetTools(shapeList(toolEntries));
  algo->Build();
  // A failed algorithm or a result without a solid (an empty intersection, a cut that removes
  // the whole target) is OperationFailed.
  if (algo->HasErrors() || !algo->IsDone()) {
    fail(KernelErrorCode::OperationFailed, "boolean: the algorithm failed");
  }
  ShapeEntry output(algo->Shape());
  if (!hasSolid(output.shape())) {
    fail(KernelErrorCode::OperationFailed, "boolean: the result has no solid");
  }
  ShapeResult result;
  result.history = HistoryCollector(*algo, output).collect(inputs);
  result.shape = shapes.add(std::move(output));
  return result;
}

}  // namespace tinycad::kernel::detail
