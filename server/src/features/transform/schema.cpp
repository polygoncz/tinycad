#include "transform/schema.hpp"

#include <string>

namespace tinycad::features {

namespace {

using document::ParamKind;
using document::ParamSchema;
using document::ParamSpec;

ParamSpec angleParam(std::string label) {
  ParamSpec spec;
  spec.kind = ParamKind::Angle;
  spec.label = std::move(label);
  spec.defaultValue = 0;
  return spec;
}

ParamSchema transformParams() {
  // p.pivot === 'point'.
  ParamSpec pivotPoint = pointParam("transform.pivotPoint");
  pivotPoint.visibleWhen = whenAny("pivot", {"point"});
  return {{"bodies", referenceList(ParamKind::Bodies, "transform.bodies", 1)},
          {"pivot", enumParam("transform.pivot", "bodiesCenter",
                              {{"bodiesCenter", "transform.pivot.bodiesCenter"},
                               {"origin", "transform.pivot.origin"},
                               {"point", "transform.pivot.point"}})},
          {"pivotPoint", pivotPoint},
          {"translate", pointParam("transform.translate")},
          {"rx", angleParam("transform.rx")},
          {"ry", angleParam("transform.ry")},
          {"rz", angleParam("transform.rz")}};
}

/** The raw params as an object; anything else is data the migration does not know. */
core::Result<Json, std::string> objectOf(const Json& raw, int version) {
  if (!raw.is_object()) {
    return core::fail("Transform params of version " + std::to_string(version) +
                      " must be an object");
  }
  return raw;
}

/**
 * Version 1 rotated about an axis through the world origin: the pivot 'origin' keeps old
 * documents and log entries where they were.
 */
core::Result<Json, std::string> fromVersion1(const Json& raw) {
  auto params = objectOf(raw, 1);
  if (!params) return params;
  (*params)["pivot"] = "origin";
  (*params)["pivotPoint"] = Json::array({0, 0, 0});
  return params;
}

/**
 * Version 2 rotated by one angle about one world axis: that angle goes to r<axis>, the others are
 * 0. Params with an unknown or missing axis pass unchanged: validate then reports them on the
 * feature (axis and angle unexpected, rx, ry, rz missing) and the document still loads.
 */
core::Result<Json, std::string> fromVersion2(const Json& raw) {
  auto params = objectOf(raw, 2);
  if (!params) return params;
  const auto axis = params->find("axis");
  std::string key;
  if (axis != params->end() && axis->is_string()) {
    const std::string& name = axis->get_ref<const std::string&>();
    if (name == "x" || name == "y" || name == "z") key = "r" + name;
  }
  if (key.empty()) return params;
  const auto angle = params->find("angle");
  // TS writes { [key]: undefined } for a missing angle, which is no plain JSON object: the load
  // reports it at 'params'. The same here, as a failed migration.
  if (angle == params->end()) return core::fail(std::string("Transform params of version 2 have no angle"));
  Json out = *params;
  const Json value = *angle;
  out.erase("axis");
  out.erase("angle");
  out["rx"] = 0;
  out["ry"] = 0;
  out["rz"] = 0;
  out[key] = value;
  return out;
}

}  // namespace

// M18: version 2 added the pivot of the rotation; M19: version 3 replaced the axis and the angle
// with three angles rx, ry, rz (R = Rz · Ry · Rx).
TransformSchema::TransformSchema()
    : BuiltInSchema("transform", 3, "transform.label", "arrows-move", transformParams(),
                    Json{{"bodies", Json::array()},
                         {"pivot", "bodiesCenter"},
                         {"pivotPoint", {0, 0, 0}},
                         {"translate", {0, 0, 0}},
                         {"rx", 0},
                         {"ry", 0},
                         {"rz", 0}}) {}

/** Migrates step by step to the current version: 1 → 2 → 3. */
core::Result<Json, std::string> TransformSchema::migrate(int fromVersion, const Json& raw) const {
  switch (fromVersion) {
    case 1: {
      auto v2 = fromVersion1(raw);
      if (!v2) return v2;
      return fromVersion2(*v2);
    }
    case 2: return fromVersion2(raw);
    default:
      return core::fail("Cannot migrate transform params from version " +
                        std::to_string(fromVersion));
  }
}

}  // namespace tinycad::features
