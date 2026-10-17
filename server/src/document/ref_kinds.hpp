#pragma once

// The table of reference kinds of document (src/document/ref-kinds.ts, M20): which EntityRef
// kinds each reference ParamKind holds and how its value is checked. Internal to tinycad_document;
// validateAgainstSchema reads it, so a new reference kind is one entry here.

#include <optional>
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
 * The problem of a present, visible value of a reference param, or nullopt when it is valid
 * (codes: spec 03). Precondition: spec.isReference().
 */
std::optional<ParamProblem> checkReferenceParam(const ParamSpec& spec, const Json& value);

}  // namespace tinycad::document
