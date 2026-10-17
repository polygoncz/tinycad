#pragma once

// The table of reference kinds of document (src/document/ref-kinds.ts, M20): which EntityRef
// kinds each reference ParamKind holds, how its value is checked and what makes two references
// the same. Internal to tinycad_document; validateAgainstSchema and checkParamRules read it, so a
// new reference kind is one entry here.

#include <optional>
#include <string>
#include <vector>

#include "tinycad/document/refs.hpp"
#include "tinycad/document/schema.hpp"

namespace tinycad::document {

/** An issue without the param key; the caller adds it. */
struct ParamProblem {
  std::string code;
  /** A JSON object, or null for none. */
  Json params;
};

/** The EntityRef kinds a reference param holds, in the order readRefOf tries them. */
const std::vector<RefKind>& refKindsOf(ParamKind kind);

/**
 * What makes two references the same (spec 03, the key of param.duplicateRef): body for body,
 * body + name for topo, sketch + region for region, plane for plane, axis for axis, sketch +
 * entity for a sketch entity. A list of strings, so no separator inside a name can collide.
 */
std::vector<std::string> refKey(const EntityRef& ref);

/**
 * The key (refKey) of one item of the reference param `spec`, read by the kinds of the param;
 * an empty vector when the item is not a valid reference of those kinds.
 */
std::vector<std::string> refKeyOf(const ParamSpec& spec, const Json& item);

/**
 * The problem of a present, visible value of a reference param, or nullopt when it is valid
 * (codes: spec 03). Precondition: spec.isReference().
 */
std::optional<ParamProblem> checkReferenceParam(const ParamSpec& spec, const Json& value);

}  // namespace tinycad::document
