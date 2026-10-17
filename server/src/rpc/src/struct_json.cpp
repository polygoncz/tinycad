#include "struct_json.hpp"

#include <cmath>
#include <string>

#include "tinycad/core/result.hpp"

namespace tinycad::session {

using core::Json;
namespace pb = google::protobuf;

Json jsonOfValue(const pb::Value& value) {
  switch (value.kind_case()) {
    case pb::Value::kNullValue:
    case pb::Value::KIND_NOT_SET:
      return nullptr;
    case pb::Value::kNumberValue: {
      const double number = value.number_value();
      // A non-finite number cannot come from a JSON client; keep it, the handlers refuse it.
      return std::isfinite(number) ? core::numberJson(number) : Json(number);
    }
    case pb::Value::kStringValue:
      return value.string_value();
    case pb::Value::kBoolValue:
      return value.bool_value();
    case pb::Value::kStructValue:
      return jsonOfStruct(value.struct_value());
    case pb::Value::kListValue:
      return jsonOfList(value.list_value());
  }
  return nullptr;
}

Json jsonOfStruct(const pb::Struct& value) {
  Json out = Json::object();
  for (const auto& [key, item] : value.fields()) out[key] = jsonOfValue(item);
  return out;
}

Json jsonOfList(const pb::ListValue& value) {
  Json out = Json::array();
  for (const auto& item : value.values()) out.push_back(jsonOfValue(item));
  return out;
}

void valueOfJson(const Json& json, pb::Value* out) {
  if (json.is_null()) {
    out->set_null_value(pb::NULL_VALUE);
  } else if (json.is_boolean()) {
    out->set_bool_value(json.get<bool>());
  } else if (json.is_number()) {
    out->set_number_value(json.get<double>());
  } else if (json.is_string()) {
    out->set_string_value(json.get<std::string>());
  } else if (json.is_array()) {
    listOfJson(json, out->mutable_list_value());
  } else if (json.is_object()) {
    structOfJson(json, out->mutable_struct_value());
  } else {
    TINYCAD_ASSERT(false, "JSON of a kind protobuf Value cannot hold: " + json.dump());
  }
}

void structOfJson(const Json& json, pb::Struct* out) {
  TINYCAD_ASSERT(json.is_object(), "a Struct needs a JSON object: " + json.dump());
  out->Clear();
  for (const auto& item : json.items()) valueOfJson(item.value(), &(*out->mutable_fields())[item.key()]);
}

void listOfJson(const Json& json, pb::ListValue* out) {
  TINYCAD_ASSERT(json.is_array(), "a ListValue needs a JSON array: " + json.dump());
  out->Clear();
  for (const auto& item : json) valueOfJson(item, out->add_values());
}

}  // namespace tinycad::session
