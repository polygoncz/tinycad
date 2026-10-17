#pragma once

// Declarative rules of a feature type beyond the generic checks (spec 03 "Vlastní pravidla",
// spec 14 "Schéma featur", decisions N67, N148). A rule is DATA, like VisibleWhen (N20): the
// server sends it to the client in FeatureTypeDescriptor.rules (schema.proto, M49), so the feature
// dialog reports the same ParamIssue code at the field before the change is sent. The server still
// decides; a rule that cannot be written as data stays in FeatureSchema::validate (the sketch data,
// list in spec 03).
//
// SHARED CONTRACT of the parallel tracks after M47 (fixed by the planner 2026-10-17, N148):
// - track C (M49) implements checkParamRules (src/document/rules.cpp), gives the built-in schemas
//   their rules (the boolean rule moves here from BooleanSchema::validate), adds the proto message
//   ParamRule and its conversion describeRule() next to describeFeatureType();
// - track A (M50) moves describeFeatureType() from tinycad_session to tinycad_rpc; it reads
//   FeatureSchema (schema.hpp) and carries describeRule() along when M49 is already merged.
// A new kind of rule = a new Kind value + its branch in checkParamRules, in schema.proto and in
// src/document/rules.ts of the client, with shared cases schema.validate (spec 13).
//
// This header holds the data only; FeatureSchema::rules() and checkParamRules are in schema.hpp.

#include <string>
#include <vector>

namespace tinycad::document {

struct ParamRule {
  enum class Kind {
    /**
     * No reference of the list `param` may also be in the list `other` (the same reference by
     * the key of param.duplicateRef: body, body + name, sketch + region, plane, …). Reports ONE
     * issue { param, code, { index } } with the index of the first such item of `param`.
     * Checked only when both params are visible and the generic checks reported no issue at "",
     * at `param` or at `other` (both are then arrays of valid references).
     * boolean: { DisjointRefs, "boolean.sameBody", "tools", "targets" }.
     */
    DisjointRefs,
  };

  Kind kind = Kind::DisjointRefs;
  /** ParamIssue.code and the translation key of the text, "boolean.sameBody". */
  std::string code;
  /** The param the issue is reported at. */
  std::string param;
  /** DisjointRefs: the other reference list. */
  std::string other;

  friend bool operator==(const ParamRule&, const ParamRule&) = default;
};

using ParamRules = std::vector<ParamRule>;

}  // namespace tinycad::document
