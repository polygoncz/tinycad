#include "sketch/schema.hpp"

#include <string>

#include "tinycad/document/origin.hpp"
#include "tinycad/sketch/model.hpp"
#include "tinycad/sketch/sketch.hpp"

namespace tinycad::features {

using document::ParamKind;

namespace {

const std::string kPlane(sketch::SKETCH_PARAM_PLANE);
const std::string kEntities(sketch::SKETCH_PARAM_ENTITIES);
const std::string kConstraints(sketch::SKETCH_PARAM_CONSTRAINTS);

document::ParamSpec dataParam(std::string label) {
  document::ParamSpec spec;
  spec.kind = ParamKind::Data;
  spec.label = std::move(label);
  return spec;
}

/** A sketch issue as a param issue: { entities | constraints, sketch.invalid…, { index } }. */
document::ParamIssue paramIssueOf(const sketch::SketchIssue& issue) {
  const bool entity = issue.path == sketch::SketchIssue::Path::Entities;
  return {entity ? kEntities : kConstraints,
          entity ? "sketch.invalidEntity" : "sketch.invalidConstraint",
          Json{{"index", issue.index}}};
}

}  // namespace

SketchSchema::SketchSchema()
    : BuiltInSchema(std::string(sketch::SKETCH_FEATURE_TYPE), 1, "sketch.label", "pencil",
                    {{kPlane, referenceList(ParamKind::Planes, "sketch.plane", 1, 1)},
                     {kEntities, dataParam("sketch.entities")},
                     {kConstraints, dataParam("sketch.constraints")}},
                    Json{{kPlane, Json::array({Json{{"kind", "plane"},
                                                    {"plane", document::ORIGIN_PLANES[0].id}}})},
                         {kEntities, Json::array()},
                         {kConstraints, Json::array()}}) {}

/**
 * The generic checks, then the sketch data by Sketch::parse. A missing entities or constraints is
 * reported by the generic checks already, so the data are parsed only as a complete pair.
 */
std::vector<document::ParamIssue> SketchSchema::validate(const Json& params) const {
  auto issues = BuiltInSchema::validate(params);
  if (!params.is_object() || !params.contains(kEntities) || !params.contains(kConstraints)) {
    return issues;
  }
  const auto parsed = sketch::Sketch::parse(params.at(kEntities), params.at(kConstraints));
  if (parsed) return issues;
  for (const auto& issue : parsed.error()) issues.push_back(paramIssueOf(issue));
  return issues;
}

}  // namespace tinycad::features
