#pragma once

// The data half of the boolean feature (src/features/boolean/schema.ts): op, targets, tools,
// keepTools and the rule boolean.sameBody (R12) as data (DisjointRefs, M49).

#include "schema_base.hpp"

namespace tinycad::features {

class BooleanSchema final : public BuiltInSchema {
 public:
  BooleanSchema();
};

}  // namespace tinycad::features
