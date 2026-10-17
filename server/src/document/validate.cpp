#include <algorithm>
#include <cmath>
#include <optional>

#include "ref_kinds.hpp"
#include "tinycad/document/schema.hpp"

// Generic checks driven by ParamSpec (src/document/validate.ts). A FeatureSchema calls this from
// validate() and adds its own rules. Missing and unexpected params are both issues (Q028).
// Issues carry codes, not texts (ADR 0014); the list of codes is in spec 03.

namespace tinycad::document {

namespace {

ParamProblem problem(std::string code, Json params = nullptr) {
  return ParamProblem{std::move(code), std::move(params)};
}

std::optional<ParamProblem> checkNumber(const Json& v, const ParamSpec& spec) {
  if (!core::isFiniteNumber(v)) return problem("param.wrongType");
  if (spec.integer && !core::isWholeNumber(v)) return problem("param.notInteger");
  const double x = core::numberOf(v);
  if (spec.min) {
    const double min = *spec.min;
    if (spec.exclusiveMin) {
      if (x <= min) return problem("param.atOrBelowMin", {{"min", core::numberJson(min)}});
    } else if (x < min) {
      return problem("param.belowMin", {{"min", core::numberJson(min)}});
    }
  }
  if (spec.max) {
    const double max = *spec.max;
    if (spec.exclusiveMax) {
      if (x >= max) return problem("param.atOrAboveMax", {{"max", core::numberJson(max)}});
    } else if (x > max) {
      return problem("param.aboveMax", {{"max", core::numberJson(max)}});
    }
  }
  return std::nullopt;
}

bool isPoint(const Json& v) {
  return v.is_array() && v.size() == 3 &&
         std::all_of(v.begin(), v.end(), [](const Json& x) { return core::isFiniteNumber(x); });
}

/** The problem of a present, visible value, or nullopt when it is valid. */
std::optional<ParamProblem> checkParam(const ParamSpec& spec, const Json& v) {
  // References: the rules of the table of reference kinds (M20).
  if (spec.isReference()) return checkReferenceParam(spec, v);
  switch (spec.kind) {
    case ParamKind::Length:
    case ParamKind::Angle:
    case ParamKind::Number: return checkNumber(v, spec);
    case ParamKind::Boolean:
      if (!v.is_boolean()) return problem("param.wrongType");
      return std::nullopt;
    case ParamKind::Enum: {
      const bool known = v.is_string() && std::any_of(spec.options.begin(), spec.options.end(),
                                                      [&](const EnumOption& option) {
                                                        return option.value ==
                                                               v.get_ref<const std::string&>();
                                                      });
      if (!known) return problem("param.unknownOption");
      return std::nullopt;
    }
    case ParamKind::Point:
      if (!isPoint(v)) return problem("param.wrongType");
      return std::nullopt;
    case ParamKind::Data:
      // Only required (checked by the caller); the content is up to the schema's own validate.
      return std::nullopt;
    default: return std::nullopt;
  }
}

}  // namespace

std::vector<ParamIssue> validateAgainstSchema(const ParamSchema& schema, const Json& params) {
  if (!params.is_object()) return {ParamIssue{"", "param.wrongType", nullptr}};
  std::vector<ParamIssue> issues;
  for (const ParamEntry& entry : schema) {
    // A hidden param is neither required nor checked; present, it is not unexpected (M13).
    if (!isParamVisible(entry.spec, params)) continue;
    const auto it = params.find(entry.key);
    if (it == params.end()) {
      issues.push_back(ParamIssue{entry.key, "param.missing", nullptr});
      continue;
    }
    if (auto found = checkParam(entry.spec, *it)) {
      issues.push_back(ParamIssue{entry.key, std::move(found->code), std::move(found->params)});
    }
  }
  for (const auto& item : params.items()) {
    const bool known = std::any_of(schema.begin(), schema.end(), [&](const ParamEntry& entry) {
      return entry.key == item.key();
    });
    if (!known) issues.push_back(ParamIssue{item.key(), "param.unexpected", nullptr});
  }
  return issues;
}

}  // namespace tinycad::document
