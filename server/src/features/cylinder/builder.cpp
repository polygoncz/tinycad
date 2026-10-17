#include "cylinder/builder.hpp"

#include "common/params.hpp"
#include "tinycad/regen/names.hpp"

namespace tinycad::features {

namespace {

/** Unit direction of each axis option; the kernel takes any non-zero axis (spec 06). */
core::Vec3 axisOf(const std::string& axis) {
  if (axis == "x") return {1, 0, 0};
  if (axis == "y") return {0, 1, 0};
  return {0, 0, 1};
}

}  // namespace

const std::string& CylinderBuilder::type() const {
  static const std::string kType = "cylinder";
  return kType;
}

regen::BuildResult CylinderBuilder::build(const regen::BuildInput& input,
                                          regen::BuildContext& ctx) const {
  // Params are valid here: evaluateParams ran the cylinder schema first.
  const auto& p = input.params;
  const kernel::CylinderInput cylinder{vec3Of(p, "base"), axisOf(stringOf(p, "axis")),
                                       numberOf(p, "radius"), numberOf(p, "height")};
  auto result = ctx.kernel().makeCylinder(cylinder);
  if (!result) return core::fail(regen::kernelFailure(result.error()));
  // Names from the roles of the kernel (spec 08); a new body has no input names.
  auto names = regen::nameShape(ctx.kernel(), input.feature.id, *result, {});
  if (!names) return core::fail(regen::kernelFailure(names.error()));
  // The cylinder creates its body (ADR 0015).
  const auto& id = input.feature.id;
  auto body = std::make_shared<const regen::Body>(document::bodyId(id), id, id, result->shape,
                                                  std::move(*names));
  return regen::BuildOutput{input.state->with(std::move(body)), {}};
}

}  // namespace tinycad::features
