#include "revolve/builder.hpp"

#include <numbers>

#include "common/params.hpp"
#include "tinycad/regen/body_operation.hpp"

namespace tinycad::features {

using document::RefKind;

namespace {

/** flipApplies of the revolve schema: flip is visible only below a full turn. */
bool flipApplies(double angle) { return angle < 2 * std::numbers::pi - 1e-9; }

}  // namespace

const std::string& RevolveBuilder::type() const {
  static const std::string kType = "revolve";
  return kType;
}

regen::BuildResult RevolveBuilder::build(const regen::BuildInput& input,
                                         regen::BuildContext& ctx) const {
  // Params are valid here: evaluateParams ran the revolve schema first.
  const auto& p = input.params;
  const auto op = regen::parseBodyOperation(stringOf(p, "operation"));
  TINYCAD_ASSERT(op.has_value(), "Revolve with an unknown operation");
  const double angle = numberOf(p, "angle");
  auto regions = ctx.resolveRegions(refsOf(p, "regions", RefKind::Region));
  if (!regions) return core::fail(regen::unresolvedReference("regions", regions.error()));
  // The schema requires an axis (param.tooFewRefs for null).
  auto axis = ctx.resolveAxis(refOf(p, "axis", {RefKind::Axis, RefKind::SketchEntity}));
  if (!axis) return core::fail(regen::unresolvedReference("axis", axis.error()));
  // A hidden targets (operation 'new') is not read: its value is not validated.
  std::vector<regen::BodyPtr> targets;
  if (*op != regen::BodyOperation::New) {
    auto resolved = ctx.resolveBodies(refsOf(p, "targets", RefKind::Body));
    if (!resolved) return core::fail(regen::unresolvedReference("targets", resolved.error()));
    targets = std::move(*resolved);
  }

  // flip is hidden at a full turn, where its value is not validated, so it must not count.
  const bool flip = flipApplies(angle) && boolOf(p, "flip");
  const core::Vec3& d = axis->direction;
  const kernel::Axis kernelAxis{axis->origin, flip ? core::Vec3{-d[0], -d[1], -d[2]} : d};
  // One region after another: a deterministic order of the kernel calls.
  std::vector<kernel::ShapeResult> shapes;
  for (const auto& region : *regions) {
    auto solid = ctx.kernel().revolve(region.face, kernelAxis, angle);
    if (!solid) return core::fail(regen::kernelFailure(solid.error()));
    shapes.push_back(std::move(*solid));
  }
  auto next =
      regen::applyBodyOperation(ctx.kernel(), input.state, input.feature.id, *op, shapes, targets);
  if (!next) return core::fail(regen::kernelFailure(next.error()));
  return regen::BuildOutput{std::move(*next), {}};
}

}  // namespace tinycad::features
