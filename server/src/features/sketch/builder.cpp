#include "sketch/builder.hpp"

#include <memory>
#include <vector>

#include "tinycad/core/result.hpp"
#include "tinycad/sketch/model.hpp"
#include "tinycad/sketch/sketch.hpp"

namespace tinycad::features {

using core::Json;

namespace {

const std::string kPlane(sketch::SKETCH_PARAM_PLANE);
const std::string kEntities(sketch::SKETCH_PARAM_ENTITIES);
const std::string kConstraints(sketch::SKETCH_PARAM_CONSTRAINTS);

/** The plane param: PlaneRef or TopoRef (a planar body face, M14) items, valid after evaluation. */
std::vector<document::EntityRef> planeRefsOf(const Json& params) {
  TINYCAD_ASSERT(params.contains(kPlane) && params.at(kPlane).is_array(),
                 "Evaluated sketch params without a plane list");
  std::vector<document::EntityRef> refs;
  for (const auto& item : params.at(kPlane)) {
    auto ref = document::readRefOf({document::RefKind::Plane, document::RefKind::Topo}, item);
    TINYCAD_ASSERT(ref.has_value(), "The sketch plane param holds a malformed reference");
    refs.push_back(std::move(*ref));
  }
  return refs;
}

/** Every line entity (construction lines too) with its point coordinates, for resolveAxis. */
std::vector<regen::SketchLineSegment> linesOf(const sketch::Sketch& data) {
  std::vector<regen::SketchLineSegment> lines;
  for (const auto& entity : data.entities()) {
    if (entity->kind() != sketch::EntityKind::Line) continue;
    const auto& line = entity->as<sketch::SketchLine>();
    const auto* p1 = data.findPoint(line.p1);
    const auto* p2 = data.findPoint(line.p2);
    // Sketch::parse checked that both ends are points of the sketch.
    TINYCAD_ASSERT(p1 != nullptr && p2 != nullptr, "A sketch line without its points");
    lines.push_back({line.id().str(), {p1->x, p1->y}, {p2->x, p2->y}});
  }
  return lines;
}

/** The pattern copies as entity JSON, the derived entities of SketchView. */
Json derivedEntitiesOf(const sketch::Sketch& data) {
  Json out = Json::array();
  for (const auto& copy : data.patternCopies()) out.push_back(sketch::entityJson(*copy));
  return out;
}

}  // namespace

const std::string& SketchBuilder::type() const {
  static const std::string kType(sketch::SKETCH_FEATURE_TYPE);
  return kType;
}

regen::BuildResult SketchBuilder::build(const regen::BuildInput& input,
                                        regen::BuildContext& ctx) const {
  const auto& feature = input.feature;
  const auto& params = input.params;
  auto resolved = ctx.resolvePlanes(planeRefsOf(params));
  if (!resolved) return core::fail(regen::unresolvedReference(kPlane, resolved.error()));
  // The schema allows exactly one plane (min 1, max 1) and validated the params already.
  TINYCAD_ASSERT(resolved->size() == 1, "Sketch '" + feature.id.str() + "' has no single plane");
  const core::Plane plane = resolved->front().plane;

  // evaluateParams ran the sketch schema first: invalid data here is a program error.
  auto parsed = sketch::Sketch::parse(params.at(kEntities), params.at(kConstraints));
  TINYCAD_ASSERT(parsed.has_value(),
                 "Sketch '" + feature.id.str() + "' has invalid data after validation");
  const sketch::Sketch& data = *parsed;

  // Curve2 of the sketch is ProfileCurve of the kernel (N12): no conversion.
  auto profile = ctx.kernel().profileRegions(data.regionCurves());
  if (!profile) return core::fail(regen::kernelFailure(profile.error()));
  // A crossing gives no regions (Q093).
  if (profile->crossing) ctx.warn("Sketch curves cross each other; no regions");

  auto artifact = std::make_shared<regen::SketchArtifact>(feature.id);
  artifact->plane = plane;
  artifact->entities = std::make_shared<const Json>(data.entitiesJson());
  artifact->derivedEntities = std::make_shared<const Json>(derivedEntitiesOf(data));
  artifact->lines = linesOf(data);
  // One face after another, in the order of the regions.
  for (const auto& region : profile->regions) {
    auto face = ctx.kernel().makeFace({plane, region.outer, region.holes});
    if (!face) return core::fail(regen::kernelFailure(face.error()));
    artifact->regions.push_back({region.name, face->shape});
  }
  artifact->outlines = std::move(profile->regions);
  return regen::BuildOutput{input.state->with(std::move(artifact)), {}};
}

}  // namespace tinycad::features
