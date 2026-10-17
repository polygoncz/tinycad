#pragma once

// The data half of the boolean feature (src/features/boolean/schema.ts): op, targets, tools,
// keepTools and the own rule boolean.sameBody (R12).

#include "schema_base.hpp"

namespace tinycad::features {

class BooleanSchema final : public BuiltInSchema {
 public:
  BooleanSchema();
  [[nodiscard]] std::vector<document::ParamIssue> validate(const Json& params) const override;
};

}  // namespace tinycad::features
