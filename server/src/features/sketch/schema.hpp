#pragma once

// The data half of the sketch feature (src/features/sketch/schema.ts, spec 12 "Featura skici"):
// exactly one plane, the entities and the constraints. Entities and constraints are Data params
// (no form field); their content is checked by sketch::Sketch::parse in validate. The coordinates
// in the params are solved already: regeneration never calls the solver.

#include "schema_base.hpp"

namespace tinycad::features {

class SketchSchema final : public BuiltInSchema {
 public:
  SketchSchema();
  [[nodiscard]] std::vector<document::ParamIssue> validate(const Json& params) const override;
};

}  // namespace tinycad::features
