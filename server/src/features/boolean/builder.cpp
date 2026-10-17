#include "boolean/builder.hpp"

#include <set>

#include "common/params.hpp"
#include "tinycad/regen/body_operation.hpp"

namespace tinycad::features {

using document::RefKind;

const std::string& BooleanBuilder::type() const {
  static const std::string kType = "boolean";
  return kType;
}

regen::BuildResult BooleanBuilder::build(const regen::BuildInput& input,
                                         regen::BuildContext& ctx) const {
  // Params are valid here: both lists have at least one body and no body is in both.
  const auto& p = input.params;
  const std::string op = stringOf(p, "op");
  const bool keepTools = boolOf(p, "keepTools");
  auto targets = ctx.resolveBodies(refsOf(p, "targets", RefKind::Body));
  if (!targets) return core::fail(regen::unresolvedReference("targets", targets.error()));
  auto tools = ctx.resolveBodies(refsOf(p, "tools", RefKind::Body));
  if (!tools) return core::fail(regen::unresolvedReference("tools", tools.error()));
  TINYCAD_ASSERT(!targets->empty(), "Boolean without a target");
  const regen::BodyPtr first = targets->front();

  // union merges everything into the first target; subtract and intersect apply the tools to all
  // targets. The inputs in the order of the kernel call are also the inputs of nameShape.
  std::vector<regen::BodyPtr> kernelTargets;
  std::vector<regen::BodyPtr> kernelTools;
  kernel::BooleanOp kernelOp = kernel::BooleanOp::Union;
  if (op == "union") {
    kernelTargets = {first};
    kernelTools.assign(targets->begin() + 1, targets->end());
    kernelTools.insert(kernelTools.end(), tools->begin(), tools->end());
  } else {
    kernelOp = op == "subtract" ? kernel::BooleanOp::Subtract : kernel::BooleanOp::Intersect;
    kernelTargets = *targets;
    kernelTools = *tools;
  }
  std::vector<kernel::ShapeHandle> targetShapes;
  std::vector<kernel::ShapeHandle> toolShapes;
  std::vector<regen::NameTablePtr> inputs;
  for (const auto& b : kernelTargets) {
    targetShapes.push_back(b->shape());
    inputs.push_back(b->names());
  }
  for (const auto& b : kernelTools) {
    toolShapes.push_back(b->shape());
    inputs.push_back(b->names());
  }
  // A kernel error (an empty result) becomes KERNEL.
  auto shape = ctx.kernel().boolean(kernelOp, targetShapes, toolShapes);
  if (!shape) return core::fail(regen::kernelFailure(shape.error()));
  // The result changes the first target: it keeps id and origin (ADR 0015).
  auto result = regen::modifyBody(ctx.kernel(), input.feature.id, *first, *shape, inputs);
  if (!result) return core::fail(regen::kernelFailure(result.error()));

  std::set<document::BodyId> consumed;
  for (std::size_t i = 1; i < targets->size(); ++i) consumed.insert((*targets)[i]->bodyId());
  if (!keepTools) {
    for (const auto& tool : *tools) consumed.insert(tool->bodyId());
  }
  return regen::BuildOutput{
      input.state->replaceBodies({{first->bodyId(), std::move(*result)}}, consumed), {}};
}

}  // namespace tinycad::features
