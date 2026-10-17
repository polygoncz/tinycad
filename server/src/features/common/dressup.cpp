#include "common/dressup.hpp"

#include "common/params.hpp"
#include "tinycad/regen/body_operation.hpp"

namespace tinycad::features {

regen::BuildResult buildDressup(DressupKind kind, const regen::BuildInput& input,
                                regen::BuildContext& ctx) {
  const bool fillet = kind == DressupKind::Fillet;
  // The size param, its issue code and the tag of the generated faces.
  const std::string param = fillet ? "radius" : "distance";
  const std::string issue = fillet ? "fillet.failed" : "chamfer.failed";
  const std::string tag = fillet ? "fillet" : "chamfer";

  // Params are valid here: evaluateParams ran the schema first.
  const auto& p = input.params;
  auto resolved =
      ctx.resolveTopo(refsOf(p, "edges", document::RefKind::Topo), regen::TopoKind::Edge);
  if (!resolved) return core::fail(regen::unresolvedReference("edges", resolved.error()));
  const double size = numberOf(p, param);

  std::map<document::BodyId, regen::BodyPtr> changed;
  for (const auto& [body, indices] : groupByBody(*resolved)) {
    auto result = fillet ? ctx.kernel().fillet(body->shape(), indices, size)
                         : ctx.kernel().chamfer(body->shape(), indices, size);
    if (!result) {
      if (result.error().code != kernel::KernelErrorCode::OperationFailed) {
        return core::fail(regen::kernelFailure(result.error()));
      }
      // A radius or distance too large, an edge OCCT cannot use: a hint at the param (D6).
      return core::fail(regen::FeatureError{regen::FeatureErrorCode::InvalidParams,
                                            result.error().message,
                                            {document::ParamIssue{param, issue, nullptr}}});
    }
    auto modified =
        regen::modifyBody(ctx.kernel(), input.feature.id, *body, *result, {body->names()}, tag);
    if (!modified) return core::fail(regen::kernelFailure(modified.error()));
    changed[body->bodyId()] = std::move(*modified);
  }
  // Each result takes the place of its body, everything else stays the same pointer.
  return regen::BuildOutput{input.state->replaceBodies(changed, {}), {}};
}

}  // namespace tinycad::features
