#include <algorithm>
#include <cstddef>
#include <set>
#include <string>
#include <vector>

#include "ref_kinds.hpp"
#include "tinycad/document/schema.hpp"

// The declarative rules of a feature type (param_rule.hpp, spec 03 "Vlastní pravidla", M49): the
// same evaluation as checkParamRules in src/document/rules.ts of the client, kept equal by the
// shared cases schema.validate (spec 13). One branch per ParamRule::Kind (N9: switch over kind).

namespace tinycad::document {

namespace {

const ParamSpec* findSpec(const ParamSchema& schema, const std::string& key) {
  for (const ParamEntry& entry : schema) {
    if (entry.key == key) return &entry.spec;
  }
  return nullptr;
}

/**
 * Whether one of the first `count` issues (those of the generic checks) is at the params object
 * or at one of the params of the rule.
 */
bool reported(const std::vector<ParamIssue>& issues, std::size_t count, const ParamRule& rule) {
  return std::any_of(issues.begin(), issues.begin() + static_cast<std::ptrdiff_t>(count),
                     [&](const ParamIssue& issue) {
                       return issue.param.empty() || issue.param == rule.param ||
                              issue.param == rule.other;
                     });
}

/**
 * DisjointRefs: one issue at the first item of `param` whose reference key is also in `other`.
 * Precondition (both visible, the generic checks passed): both values are arrays of valid
 * references.
 */
void checkDisjointRefs(const ParamSpec& paramSpec, const ParamSpec& otherSpec,
                       const ParamRule& rule, const Json& params,
                       std::vector<ParamIssue>& issues) {
  std::set<std::vector<std::string>> others;
  for (const Json& item : params.at(rule.other)) others.insert(refKeyOf(otherSpec, item));
  const Json& items = params.at(rule.param);
  for (std::size_t index = 0; index < items.size(); ++index) {
    if (others.contains(refKeyOf(paramSpec, items[index]))) {
      issues.push_back(ParamIssue{rule.param, rule.code, Json{{"index", index}}});
      return;
    }
  }
}

}  // namespace

void checkParamRules(const ParamSchema& schema, const ParamRules& rules, const Json& params,
                     std::vector<ParamIssue>& issues) {
  if (!params.is_object()) return;
  // A rule looks only at the issues of the generic checks, not at those of an earlier rule
  // (the same as the client, which gets the generic issues only).
  const std::size_t generic = issues.size();
  for (const ParamRule& rule : rules) {
    const ParamSpec* paramSpec = findSpec(schema, rule.param);
    const ParamSpec* otherSpec = findSpec(schema, rule.other);
    // The registry admits only rules over params of the schema; stay total anyway.
    if (paramSpec == nullptr || otherSpec == nullptr) continue;
    if (!isParamVisible(*paramSpec, params) || !isParamVisible(*otherSpec, params)) continue;
    if (reported(issues, generic, rule)) continue;
    switch (rule.kind) {
      case ParamRule::Kind::DisjointRefs:
        checkDisjointRefs(*paramSpec, *otherSpec, rule, params, issues);
        break;
    }
  }
}

}  // namespace tinycad::document
