#include "transform/builder.hpp"

#include "common/mat4.hpp"
#include "common/params.hpp"
#include "tinycad/regen/body_operation.hpp"

namespace tinycad::features {

namespace {

/** R = Rz · Ry · Rx: x first, z last (M19, Euler angles). */
core::Mat4 rotationOf(double rx, double ry, double rz) {
  return math::multiply(math::rotationAxisAngle({0, 0, 1}, rz),
                        math::multiply(math::rotationAxisAngle({0, 1, 0}, ry),
                                       math::rotationAxisAngle({1, 0, 0}, rx)));
}

}  // namespace

const std::string& TransformBuilder::type() const {
  static const std::string kType = "transform";
  return kType;
}

regen::BuildResult TransformBuilder::build(const regen::BuildInput& input,
                                           regen::BuildContext& ctx) const {
  // Params are valid here: evaluateParams ran the transform schema first.
  const auto& p = input.params;
  auto bodies = ctx.resolveBodies(refsOf(p, "bodies", document::RefKind::Body));
  if (!bodies) return core::fail(regen::unresolvedReference("bodies", bodies.error()));
  const std::string pivot = stringOf(p, "pivot");

  // From the input shapes, so it depends neither on translate nor on the angles (anchor invariant).
  core::Vec3 center{0, 0, 0};
  if (pivot == "bodiesCenter") {
    std::vector<kernel::ShapeHandle> shapes;
    for (const auto& b : *bodies) shapes.push_back(b->shape());
    auto c = centerOf(ctx.kernel(), shapes);
    if (!c) return core::fail(regen::kernelFailure(c.error()));
    center = *c;
  } else if (pivot == "point") {
    center = vec3Of(p, "pivotPoint");
  }

  // Rotate through the pivot first, then translate: T(translate) · T(p) · R · T(−p).
  const core::Mat4 rotation = math::multiply(
      math::translation(center),
      math::multiply(rotationOf(numberOf(p, "rx"), numberOf(p, "ry"), numberOf(p, "rz")),
                     math::translation(math::scale(center, -1))));
  const core::Mat4 m = math::multiply(math::translation(vec3Of(p, "translate")), rotation);

  std::map<document::BodyId, regen::BodyPtr> changed;
  for (const auto& body : *bodies) {
    auto result = ctx.kernel().transform(body->shape(), m);
    if (!result) return core::fail(regen::kernelFailure(result.error()));
    // The history of a rigid motion is the identity, so the names stay the same (spec 08).
    auto moved = regen::modifyBody(ctx.kernel(), input.feature.id, *body, *result, {body->names()});
    if (!moved) return core::fail(regen::kernelFailure(moved.error()));
    changed[body->bodyId()] = std::move(*moved);
  }
  // Every moved body stays where it was; origin and pivotPoint come from the params, so only
  // bodiesCenter needs the anchor.
  regen::FeatureAnchors anchors;
  if (pivot == "bodiesCenter") anchors["pivot"] = regen::Anchor{center, std::nullopt};
  return regen::BuildOutput{input.state->replaceBodies(changed, {}), std::move(anchors)};
}

}  // namespace tinycad::features
