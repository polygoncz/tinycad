#pragma once

// The common base of the schemas of the built-in features (internal to tinycad_features): holds
// the data every FeatureSchema exposes and validates with the generic checks of
// validateAgainstSchema. A feature with own rules (boolean) or a migration (transform) overrides
// validate or migrate; the others are just a constructor with their data.

#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "tinycad/document/schema.hpp"

namespace tinycad::features {

using core::Json;

class BuiltInSchema : public document::FeatureSchema {
 public:
  [[nodiscard]] const std::string& type() const override { return type_; }
  [[nodiscard]] int version() const override { return version_; }
  [[nodiscard]] const std::string& label() const override { return label_; }
  [[nodiscard]] const std::string& icon() const override { return icon_; }
  [[nodiscard]] const document::ParamSchema& params() const override { return params_; }
  [[nodiscard]] Json defaults() const override { return defaults_; }
  [[nodiscard]] std::vector<document::ParamIssue> validate(const Json& params) const override {
    return document::validateAgainstSchema(params_, params);
  }

 protected:
  BuiltInSchema(std::string type, int version, std::string label, std::string icon,
                document::ParamSchema params, Json defaults)
      : type_(std::move(type)),
        version_(version),
        label_(std::move(label)),
        icon_(std::move(icon)),
        params_(std::move(params)),
        defaults_(std::move(defaults)) {}

 private:
  std::string type_;
  int version_;
  std::string label_;
  std::string icon_;
  document::ParamSchema params_;
  Json defaults_;
};

/** A length > 0 (the exclusive lower bound 0 of Q050), the common size param of the features. */
inline document::ParamSpec positiveLength(std::string label, double defaultValue) {
  document::ParamSpec spec;
  spec.kind = document::ParamKind::Length;
  spec.label = std::move(label);
  spec.defaultValue = core::numberJson(defaultValue);
  spec.min = 0.0;
  spec.exclusiveMin = true;
  return spec;
}

/** An enum param; options as { value, label } pairs. */
inline document::ParamSpec enumParam(std::string label, std::string defaultValue,
                                     std::vector<document::EnumOption> options) {
  document::ParamSpec spec;
  spec.kind = document::ParamKind::Enum;
  spec.label = std::move(label);
  spec.defaultValue = std::move(defaultValue);
  spec.options = std::move(options);
  return spec;
}

/** A point param [x, y, z] with the default [0, 0, 0]. */
inline document::ParamSpec pointParam(std::string label) {
  document::ParamSpec spec;
  spec.kind = document::ParamKind::Point;
  spec.label = std::move(label);
  spec.defaultValue = Json::array({0, 0, 0});
  return spec;
}

/** A boolean param. */
inline document::ParamSpec booleanParam(std::string label, bool defaultValue) {
  document::ParamSpec spec;
  spec.kind = document::ParamKind::Boolean;
  spec.label = std::move(label);
  spec.defaultValue = defaultValue;
  return spec;
}

/** A reference param of a list kind (bodies, topo, region, planes) with a count range. */
inline document::ParamSpec referenceList(document::ParamKind kind, std::string label,
                                         std::optional<double> min,
                                         std::optional<double> max = std::nullopt) {
  document::ParamSpec spec;
  spec.kind = kind;
  spec.label = std::move(label);
  spec.min = min;
  spec.max = max;
  return spec;
}

/** visibleWhen: the param `param` equals one of the strings. */
inline document::VisibleWhen whenAny(std::string param, std::vector<std::string> values) {
  document::VisibleWhen when;
  when.param = std::move(param);
  when.test = document::VisibleWhen::Test::EqualsAny;
  for (auto& v : values) when.values.emplace_back(std::move(v));
  return when;
}

/** visibleWhen: the param `param` equals none of the strings (missing shows). */
inline document::VisibleWhen whenNone(std::string param, std::vector<std::string> values) {
  document::VisibleWhen when = whenAny(std::move(param), std::move(values));
  when.test = document::VisibleWhen::Test::EqualsNone;
  return when;
}

}  // namespace tinycad::features
