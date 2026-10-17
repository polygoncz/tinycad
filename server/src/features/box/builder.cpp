#include "box/builder.hpp"

#include "common/params.hpp"
#include "tinycad/regen/names.hpp"

namespace tinycad::features {

const std::string& BoxBuilder::type() const {
  static const std::string kType = "box";
  return kType;
}

regen::BuildResult BoxBuilder::build(const regen::BuildInput& input,
                                     regen::BuildContext& ctx) const {
  // Params are valid here: evaluateParams ran the box schema first.
  const auto& p = input.params;
  const kernel::BoxInput box{vec3Of(p, "origin"),
                             {numberOf(p, "width"), numberOf(p, "depth"), numberOf(p, "height")}};
  auto result = ctx.kernel().makeBox(box);
  if (!result) return core::fail(regen::kernelFailure(result.error()));
  // Names from the roles of the kernel (spec 08); a new body has no input names.
  auto names = regen::nameShape(ctx.kernel(), input.feature.id, *result, {});
  if (!names) return core::fail(regen::kernelFailure(names.error()));
  // The box creates its body: id from bodyId, origin and lastModifiedBy the feature (ADR 0015).
  const auto& id = input.feature.id;
  auto body = std::make_shared<const regen::Body>(document::bodyId(id), id, id, result->shape,
                                                  std::move(*names));
  return regen::BuildOutput{input.state->with(std::move(body)), {}};
}

}  // namespace tinycad::features
