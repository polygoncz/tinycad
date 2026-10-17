#include "tinycad/document/schema.hpp"

// The one way from the raw params of a feature to the values that are computed with
// (src/document/evaluate.ts, M20). Without variables yet (Q003): valid params pass through
// unchanged; variables and expressions change only this body.

namespace tinycad::document {

Evaluated evaluateParams(const FeatureSchema& schema, const Json& params) {
  Evaluated out;
  out.issues = schema.validate(params);
  if (out.issues.empty()) out.params = params;
  return out;
}

}  // namespace tinycad::document
