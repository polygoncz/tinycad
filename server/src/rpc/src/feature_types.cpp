#include "tinycad/rpc/feature_types.hpp"

#include <cstdint>
#include <string>

#include "struct_json.hpp"
#include "tinycad/core/json.hpp"

namespace tinycad::rpc {

namespace v1 = tinycad::v1;
using document::ParamKind;
using document::ParamSpec;

namespace {

double numberDefault(const ParamSpec& spec) {
  return core::isFiniteNumber(spec.defaultValue) ? core::numberOf(spec.defaultValue) : 0.0;
}

void describeNumber(const ParamSpec& spec, v1::NumberParam* out) {
  out->set_default_value(numberDefault(spec));
  if (spec.min) out->set_min(*spec.min);
  if (spec.max) out->set_max(*spec.max);
  out->set_exclusive_min(spec.exclusiveMin);
  out->set_exclusive_max(spec.exclusiveMax);
  out->set_integer(spec.kind == ParamKind::Number && spec.integer);
}

/** The optional count range of a reference list (ParamSpec min/max are doubles). */
void describeCount(const ParamSpec& spec, v1::RefListParam* out) {
  if (spec.min) out->set_min(static_cast<std::uint32_t>(*spec.min));
  if (spec.max) out->set_max(static_cast<std::uint32_t>(*spec.max));
}

void describeCount(const ParamSpec& spec, v1::TopoParam* out) {
  if (spec.min) out->set_min(static_cast<std::uint32_t>(*spec.min));
  if (spec.max) out->set_max(static_cast<std::uint32_t>(*spec.max));
}

v1::TopoParam::Entity entityOf(document::TopoEntity entity) {
  switch (entity) {
    case document::TopoEntity::Face:
      return v1::TopoParam::ENTITY_FACE;
    case document::TopoEntity::Edge:
      return v1::TopoParam::ENTITY_EDGE;
    case document::TopoEntity::Vertex:
      return v1::TopoParam::ENTITY_VERTEX;
  }
  return v1::TopoParam::ENTITY_UNSPECIFIED;
}

void describeVisibleWhen(const document::VisibleWhen& when, v1::VisibleWhen* out) {
  out->set_param(when.param);
  switch (when.test) {
    case document::VisibleWhen::Test::EqualsAny:
      listOfJson(core::Json(when.values), out->mutable_equals_any());
      break;
    case document::VisibleWhen::Test::EqualsNone:
      listOfJson(core::Json(when.values), out->mutable_equals_none());
      break;
    case document::VisibleWhen::Test::LessThan:
      out->set_less_than(when.limit);
      break;
  }
}

void describeParam(const document::ParamEntry& entry, v1::ParamDescriptor* out) {
  const ParamSpec& spec = entry.spec;
  out->set_key(entry.key);
  out->set_label(spec.label);
  out->set_group(spec.group.value_or(""));
  if (spec.visibleWhen) describeVisibleWhen(*spec.visibleWhen, out->mutable_visible_when());

  switch (spec.kind) {
    case ParamKind::Length:
      describeNumber(spec, out->mutable_length());
      break;
    case ParamKind::Angle:
      describeNumber(spec, out->mutable_angle());
      break;
    case ParamKind::Number:
      describeNumber(spec, out->mutable_number());
      break;
    case ParamKind::Boolean:
      out->mutable_boolean()->set_default_value(spec.defaultValue.is_boolean() &&
                                                spec.defaultValue.get<bool>());
      break;
    case ParamKind::Enum: {
      auto* enumeration = out->mutable_enumeration();
      if (spec.defaultValue.is_string()) {
        enumeration->set_default_value(spec.defaultValue.get<std::string>());
      }
      for (const auto& option : spec.options) {
        auto* added = enumeration->add_options();
        added->set_value(option.value);
        added->set_label(option.label);
      }
      break;
    }
    case ParamKind::Point: {
      auto* point = out->mutable_point()->mutable_default_value();
      if (const auto v = core::readVec3(spec.defaultValue)) {
        point->set_x((*v)[0]);
        point->set_y((*v)[1]);
        point->set_z((*v)[2]);
      }
      break;
    }
    case ParamKind::Data:
      out->mutable_data();
      break;
    case ParamKind::Bodies:
      describeCount(spec, out->mutable_bodies());
      break;
    case ParamKind::Topo: {
      auto* topo = out->mutable_topo();
      topo->set_entity(entityOf(spec.entity));
      describeCount(spec, topo);
      break;
    }
    case ParamKind::Region:
      describeCount(spec, out->mutable_region());
      break;
    case ParamKind::Planes:
      describeCount(spec, out->mutable_planes());
      break;
    case ParamKind::Axis:
      out->mutable_axis();
      break;
  }
}

}  // namespace

void describeFeatureType(const document::FeatureSchema& schema, v1::FeatureTypeDescriptor* out) {
  out->Clear();
  out->set_type(schema.type());
  out->set_version(static_cast<std::uint32_t>(schema.version()));
  out->set_label(schema.label());
  out->set_icon(schema.icon());
  for (const auto& entry : schema.params()) describeParam(entry, out->add_params());
  structOfJson(schema.defaults(), out->mutable_defaults());
}

std::vector<v1::FeatureTypeDescriptor> describeFeatureTypes(
    const document::FeatureSchemaRegistryReader& schemas) {
  std::vector<v1::FeatureTypeDescriptor> out;
  for (const auto* schema : schemas.all()) {
    describeFeatureType(*schema, &out.emplace_back());
  }
  return out;
}

}  // namespace tinycad::rpc
