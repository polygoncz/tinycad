#include "boolean/schema.hpp"

namespace tinycad::features {

using document::ParamKind;

// Two lists for every operation (R9): one schema without conditional params, one identity rule
// for all three operations. The rule (R12): a body that is a target and a tool, reported at the
// first such tool by its index in tools, like param.duplicateRef reports the first duplicate.
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
                         {"keepTools", false}},
                    {{.kind = document::ParamRule::Kind::DisjointRefs,
                      .code = "boolean.sameBody",
                      .param = "tools",
                      .other = "targets"}}) {}

}  // namespace tinycad::features
