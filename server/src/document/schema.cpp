#include "tinycad/document/schema.hpp"

#include <algorithm>

namespace tinycad::document {

namespace {

/** The kind of JSON value for the type test of EqualsNone: all numbers are one kind. */
enum class JsonKind { Null, Boolean, Number, String, Array, Object, Other };

JsonKind jsonKindOf(const Json& v) {
  if (v.is_null()) return JsonKind::Null;
  if (v.is_boolean()) return JsonKind::Boolean;
  if (v.is_number()) return JsonKind::Number;
  if (v.is_string()) return JsonKind::String;
  if (v.is_array()) return JsonKind::Array;
  if (v.is_object()) return JsonKind::Object;
  return JsonKind::Other;
}

bool equalsOneOf(const Json& value, const std::vector<Json>& values) {
  return std::any_of(values.begin(), values.end(), [&](const Json& v) { return v == value; });
}

bool sameKindAsAnOption(const Json& value, const std::vector<Json>& values) {
  const JsonKind kind = jsonKindOf(value);
  return std::any_of(values.begin(), values.end(),
                     [&](const Json& v) { return jsonKindOf(v) == kind; });
}

}  // namespace

bool ParamSpec::isReference() const {
  switch (kind) {
    case ParamKind::Bodies:
    case ParamKind::Topo:
    case ParamKind::Region:
    case ParamKind::Planes:
    case ParamKind::Axis: return true;
    default: return false;
  }
}

bool isParamVisible(const ParamSpec& spec, const Json& params) {
  if (!spec.visibleWhen) return true;
  const VisibleWhen& when = *spec.visibleWhen;
  const Json* value = nullptr;
  if (params.is_object()) {
    const auto it = params.find(when.param);
    if (it != params.end()) value = &*it;
  }
  switch (when.test) {
    case VisibleWhen::Test::EqualsAny: return value != nullptr && equalsOneOf(*value, when.values);
    case VisibleWhen::Test::EqualsNone:
      // A missing param shows; a value of another type than the options hides (spec 14).
      if (value == nullptr) return true;
      return sameKindAsAnOption(*value, when.values) && !equalsOneOf(*value, when.values);
    case VisibleWhen::Test::LessThan:
      return value != nullptr && core::isFiniteNumber(*value) &&
             core::numberOf(*value) < when.limit;
  }
  return true;
}

Json issueJson(const ParamIssue& issue) {
  Json out = {{"param", issue.param}, {"code", issue.code}};
  if (issue.params.is_object() && !issue.params.empty()) {
    Json params = Json::object();
    for (const auto& item : issue.params.items()) {
      params[item.key()] = item.value().is_number() ? core::numberJson(core::numberOf(item.value()))
                                                    : item.value();
    }
    out["params"] = params;
  }
  return out;
}

core::Result<Json, std::string> FeatureSchema::migrate(int /*fromVersion*/,
                                                       const Json& /*raw*/) const {
  // The registry admits version > 1 only with hasMigrate(), which overrides this.
  TINYCAD_ASSERT(false, "Feature schema '" + type() + "' has no migrate()");
  return core::fail(std::string("no migrate"));
}

void FeatureSchemaRegistry::add(FeatureSchemaPtr schema) {
  TINYCAD_ASSERT(schema != nullptr, "FeatureSchemaRegistry: the schema must not be null");
  TINYCAD_ASSERT(schema->version() >= 1, "Feature schema '" + schema->type() +
                                             "' has invalid version " +
                                             std::to_string(schema->version()));
  TINYCAD_ASSERT(schema->version() == 1 || schema->hasMigrate(),
                 "Feature schema '" + schema->type() + "' version " +
                     std::to_string(schema->version()) + " needs migrate()");
  TINYCAD_ASSERT(find(schema->type()) == nullptr,
                 "Feature schema '" + schema->type() + "' is already registered");
  schemas_.push_back(std::move(schema));
}

const FeatureSchema* FeatureSchemaRegistry::find(std::string_view type) const {
  for (const FeatureSchemaPtr& schema : schemas_) {
    if (schema->type() == type) return schema.get();
  }
  return nullptr;
}

const FeatureSchema& FeatureSchemaRegistry::get(std::string_view type) const {
  const FeatureSchema* schema = find(type);
  TINYCAD_ASSERT(schema != nullptr, "Unknown feature schema '" + std::string(type) + "'");
  return *schema;
}

std::vector<const FeatureSchema*> FeatureSchemaRegistry::all() const {
  std::vector<const FeatureSchema*> out;
  out.reserve(schemas_.size());
  for (const FeatureSchemaPtr& schema : schemas_) out.push_back(schema.get());
  return out;
}

}  // namespace tinycad::document
