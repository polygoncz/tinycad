// The identity rule of a changed body and the body operation of sketch-based features
// (spec 07 "Builder featury" and "Operace tělesa (M13)", src/regen/body-change.ts and
// body-operation.ts).

#include "tinycad/regen/body_operation.hpp"

#include <algorithm>
#include <utility>

#include "tinycad/core/result.hpp"

namespace tinycad::regen {

kernel::KernelResult<BodyPtr> modifyBody(kernel::QueryOps& kernel, const FeatureId& feature,
                                         const Body& body, const kernel::ShapeResult& result,
                                         const std::vector<NameTablePtr>& inputs,
                                         std::string_view generatedTag) {
  auto names = nameShape(kernel, feature, result, inputs, generatedTag);
  if (!names) return core::fail(names.error());
  return std::make_shared<const Body>(body.bodyId(), body.origin(), feature, result.shape,
                                      std::move(*names));
}

std::optional<BodyOperation> parseBodyOperation(std::string_view name) {
  if (name == "new") return BodyOperation::New;
  if (name == "add") return BodyOperation::Add;
  if (name == "remove") return BodyOperation::Remove;
  if (name == "intersect") return BodyOperation::Intersect;
  return std::nullopt;
}

namespace {

/** A shape with its name table. */
struct Named {
  ShapeHandle shape{};
  NameTablePtr names;
};

/**
 * The names of a new shape of the feature, from its roles. Its inputs (the profile face of a
 * prism) have no names: NameTable::empty() stands for every input its history refers to (spec 08).
 */
kernel::KernelResult<NameTablePtr> nameNewShape(kernel::ModelingKernel& kernel,
                                                const FeatureId& feature,
                                                const kernel::ShapeResult& result) {
  int count = 0;
  if (result.history) {
    for (const auto& link : result.history->modified) count = std::max(count, link.input + 1);
    for (const auto& link : result.history->generated) count = std::max(count, link.input + 1);
    for (const auto& d : result.history->deleted) count = std::max(count, d.input + 1);
  }
  const std::vector<NameTablePtr> inputs(static_cast<std::size_t>(count), NameTable::empty());
  return nameShape(kernel, feature, result, inputs);
}

std::vector<ShapeHandle> shapesOf(const std::vector<Named>& named) {
  std::vector<ShapeHandle> out;
  for (const auto& n : named) out.push_back(n.shape);
  return out;
}

}  // namespace

kernel::KernelResult<StatePtr> applyBodyOperation(kernel::ModelingKernel& kernel,
                                                  const StatePtr& state, const FeatureId& feature,
                                                  BodyOperation op,
                                                  const std::vector<kernel::ShapeResult>& shapes,
                                                  const std::vector<BodyPtr>& targets) {
  TINYCAD_ASSERT(!shapes.empty(), "Body operation without a shape");
  TINYCAD_ASSERT(op == BodyOperation::New || !targets.empty(),
                 "Body operation other than 'new' without a target");

  // One shape after another: a deterministic order of the kernel calls.
  std::vector<Named> named;
  for (const auto& result : shapes) {
    auto names = nameNewShape(kernel, feature, result);
    if (!names) return core::fail(names.error());
    named.push_back(Named{result.shape, std::move(*names)});
  }

  if (op == BodyOperation::New) {
    // One shape is the body; several are united by one union (a compound of one body, R8).
    Named body = named.front();
    if (named.size() > 1) {
      const std::vector<ShapeHandle> first{named.front().shape};
      const std::vector<Named> others(named.begin() + 1, named.end());
      auto united = kernel.boolean(kernel::BooleanOp::Union, first, shapesOf(others));
      if (!united) return core::fail(united.error());
      std::vector<NameTablePtr> inputs;
      for (const auto& n : named) inputs.push_back(n.names);
      auto names = nameShape(kernel, feature, *united, inputs);
      if (!names) return core::fail(names.error());
      body = Named{united->shape, std::move(*names)};
    }
    const BodyId id = document::bodyId(feature);
    return state->with(
        std::make_shared<const Body>(id, feature, feature, body.shape, std::move(body.names)));
  }

  if (op == BodyOperation::Add) {
    // One union of the first target with the other targets and the shapes.
    const BodyPtr& first = targets.front();
    std::vector<Named> others;
    for (std::size_t i = 1; i < targets.size(); ++i) {
      others.push_back(Named{targets[i]->shape(), targets[i]->names()});
    }
    others.insert(others.end(), named.begin(), named.end());
    const std::vector<ShapeHandle> firstShape{first->shape()};
    auto result = kernel.boolean(kernel::BooleanOp::Union, firstShape, shapesOf(others));
    if (!result) return core::fail(result.error());
    std::vector<NameTablePtr> inputs{first->names()};
    for (const auto& o : others) inputs.push_back(o.names);
    auto body = modifyBody(kernel, feature, *first, *result, inputs);
    if (!body) return core::fail(body.error());
    std::set<BodyId> consumed;
    for (std::size_t i = 1; i < targets.size(); ++i) consumed.insert(targets[i]->bodyId());
    return state->replaceBodies({{first->bodyId(), std::move(*body)}}, consumed);
  }

  // Remove / Intersect: each target on its own, one after another.
  const kernel::BooleanOp booleanOp =
      op == BodyOperation::Remove ? kernel::BooleanOp::Subtract : kernel::BooleanOp::Intersect;
  const std::vector<ShapeHandle> tools = shapesOf(named);
  std::map<BodyId, BodyPtr> changed;
  for (const auto& target : targets) {
    const std::vector<ShapeHandle> targetShape{target->shape()};
    auto result = kernel.boolean(booleanOp, targetShape, tools);
    if (!result) return core::fail(result.error());
    std::vector<NameTablePtr> inputs{target->names()};
    for (const auto& n : named) inputs.push_back(n.names);
    auto body = modifyBody(kernel, feature, *target, *result, inputs);
    if (!body) return core::fail(body.error());
    changed[target->bodyId()] = std::move(*body);
  }
  return state->replaceBodies(changed, {});
}

}  // namespace tinycad::regen
