#include "extrude/builder.hpp"

#include <cmath>

#include "common/mat4.hpp"
#include "common/params.hpp"
#include "tinycad/regen/body_operation.hpp"

namespace tinycad::features {

using document::RefKind;

namespace {

/** Tolerance of the up-to-face checks (R109): parallel and in front of the profile. */
constexpr double kUpToTolerance = 1e-9;

/** The INVALID_PARAMS of a face the extrude cannot go up to. */
regen::FeatureError unusableFace(std::string message) {
  return regen::FeatureError{regen::FeatureErrorCode::InvalidParams,
                             std::move(message),
                             {document::ParamIssue{"upTo", "extrude.upToFace", nullptr}}};
}

/**
 * The length from the plane of each region up to the face upTo (R109): its plane from
 * resolvePlanes (a missing or non-planar face is an unresolved reference, spec 08). A face that
 * is not parallel to the sketch or not in front of a region is INVALID_PARAMS at upTo.
 */
core::Result<std::vector<double>, regen::FeatureError> upToLengths(
    regen::BuildContext& ctx, const core::Json& params,
    const std::vector<regen::ResolvedRegion>& regions, const core::Vec3& direction) {
  auto resolved = ctx.resolvePlanes(refsOf(params, "upTo", RefKind::Topo));
  if (!resolved) return core::fail(regen::unresolvedReference("upTo", resolved.error()));
  TINYCAD_ASSERT(!resolved->empty(), "Extrude up to no face");
  const regen::ResolvedPlane& target = resolved->front();
  const std::string name =
      target.ref.kind == RefKind::Topo ? target.ref.name.str() : target.ref.plane.str();
  // Either side of the face counts: the normal points out of the solid, along or against d̂.
  if (std::abs(math::dot(target.plane.normal, direction)) < 1 - kUpToTolerance) {
    return core::fail(unusableFace("Face '" + name + "' is not parallel to the sketch"));
  }
  std::vector<double> lengths;
  for (const auto& region : regions) {
    const double length =
        math::dot(math::sub(target.plane.origin, region.sketch->plane.origin), direction);
    if (length <= kUpToTolerance) {
      return core::fail(unusableFace("Face '" + name + "' is not in the extrude direction"));
    }
    lengths.push_back(length);
  }
  return lengths;
}

}  // namespace

const std::string& ExtrudeBuilder::type() const {
  static const std::string kType = "extrude";
  return kType;
}

regen::BuildResult ExtrudeBuilder::build(const regen::BuildInput& input,
                                         regen::BuildContext& ctx) const {
  // Params are valid here: at least one region and, for an operation other than 'new', at least
  // one target.
  const auto& p = input.params;
  const auto op = regen::parseBodyOperation(stringOf(p, "operation"));
  TINYCAD_ASSERT(op.has_value(), "Extrude with an unknown operation");
  const std::string endType = stringOf(p, "endType");
  auto regions = ctx.resolveRegions(refsOf(p, "regions", RefKind::Region));
  if (!regions) return core::fail(regen::unresolvedReference("regions", regions.error()));

  // A hidden targets param is never read: for 'new' it may hold anything (spec 03).
  std::vector<regen::BodyPtr> targets;
  if (*op != regen::BodyOperation::New) {
    auto resolved = ctx.resolveBodies(refsOf(p, "targets", RefKind::Body));
    if (!resolved) return core::fail(regen::unresolvedReference("targets", resolved.error()));
    targets = std::move(*resolved);
  }

  TINYCAD_ASSERT(!regions->empty(), "Extrude without a region");
  const core::Plane sketchPlane = regions->front().sketch->plane;
  const core::Vec3 normal = sketchPlane.normal;
  // flip is hidden unless 'blind', where its value is not validated, so it must not count.
  const bool flip = endType == "blind" && boolOf(p, "flip");
  const core::Vec3 direction = flip ? math::scale(normal, -1) : normal;

  // The length of every prism in the order of the regions; distance is hidden for 'upToFace',
  // where the face gives each region its own length (R109).
  std::vector<double> lengths;
  if (endType == "upToFace") {
    auto upTo = upToLengths(ctx, p, *regions, direction);
    if (!upTo) return core::fail(std::move(upTo.error()));
    lengths = std::move(*upTo);
  } else {
    lengths.assign(regions->size(), numberOf(p, "distance"));
  }

  // One prism per region in the order of the regions: a deterministic order of kernel calls.
  std::vector<kernel::ShapeResult> shapes;
  for (std::size_t i = 0; i < regions->size(); ++i) {
    kernel::ShapeHandle profile = (*regions)[i].face;
    if (endType == "symmetric") {
      // The region moved back by half the distance, so the prism is centred on the sketch.
      auto moved = ctx.kernel().transform(
          profile, math::translation(math::scale(direction, -lengths[i] / 2)));
      if (!moved) return core::fail(regen::kernelFailure(moved.error()));
      profile = moved->shape;
    }
    auto prism = ctx.kernel().extrude(profile, direction, lengths[i]);
    if (!prism) return core::fail(regen::kernelFailure(prism.error()));
    shapes.push_back(std::move(*prism));
  }

  auto next =
      regen::applyBodyOperation(ctx.kernel(), input.state, input.feature.id, *op, shapes, targets);
  if (!next) return core::fail(regen::kernelFailure(next.error()));
  // Up to face has no handle, so no anchor.
  if (endType == "upToFace") return regen::BuildOutput{std::move(*next), {}};

  // From the regions and the sketch plane only: it depends neither on distance nor on flip. The
  // center of the joined box of the region faces, projected into the sketch plane.
  std::vector<kernel::ShapeHandle> faces;
  for (const auto& region : *regions) faces.push_back(region.face);
  auto q = centerOf(ctx.kernel(), faces);
  if (!q) return core::fail(regen::kernelFailure(q.error()));
  const core::Vec3 base =
      math::sub(*q, math::scale(normal, math::dot(math::sub(*q, sketchPlane.origin), normal)));
  regen::FeatureAnchors anchors;
  anchors["base"] = regen::Anchor{base, normal};
  return regen::BuildOutput{std::move(*next), std::move(anchors)};
}

}  // namespace tinycad::features
