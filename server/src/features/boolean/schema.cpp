#include "boolean/schema.hpp"

#include <algorithm>
#include <cstddef>
#include <set>
#include <string>

namespace tinycad::features {

using document::ParamKind;

// Two lists for every operation (R9): one schema without conditional params, one identity rule
// for all three operations.
BooleanSchema::BooleanSchema()
    : BuiltInSchema("boolean", 1, "boolean.label", "layers-union",
                    {{"op", enumParam("boolean.op", "union",
                                      {{"union", "boolean.op.union"},
                                       {"subtract", "boolean.op.subtract"},
                                       {"intersect", "boolean.op.intersect"}})},
                     {"targets", referenceList(ParamKind::Bodies, "boolean.targets", 1)},
                     {"tools", referenceList(ParamKind::Bodies, "boolean.tools", 1)},
                     {"keepTools", booleanParam("boolean.keepTools", false)}},
                    Json{{"op", "union"},
                         {"targets", Json::array()},
                         {"tools", Json::array()},
                         {"keepTools", false}}) {}

/**
 * The own rule of the boolean (R12): a body that is a target and a tool. Checked only when both
 * lists passed the generic checks; reports the first such tool by its index in tools, like
 * param.duplicateRef reports the first duplicate.
 */
std::vector<document::ParamIssue> BooleanSchema::validate(const Json& params) const {
  auto issues = BuiltInSchema::validate(params);
  const bool listsBroken = std::any_of(issues.begin(), issues.end(), [](const auto& issue) {
    return issue.param.empty() || issue.param == "targets" || issue.param == "tools";
  });
  if (listsBroken) return issues;
  // The generic checks passed for targets and tools: both are arrays of valid BodyRefs.
  std::set<std::string> targets;
  for (const Json& ref : params.at("targets")) targets.insert(ref.at("body").get<std::string>());
  const Json& tools = params.at("tools");
  for (std::size_t index = 0; index < tools.size(); ++index) {
    if (targets.contains(tools[index].at("body").get<std::string>())) {
      issues.push_back({"tools", "boolean.sameBody", Json{{"index", index}}});
      break;
    }
  }
  return issues;
}

}  // namespace tinycad::features
