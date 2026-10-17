#pragma once

// The data half of the box feature (src/features/box/schema.ts): origin and three sizes > 0;
// the exclusive lower bound covers the sizes, so the box needs no rule of its own.

#include "schema_base.hpp"

namespace tinycad::features {

class BoxSchema final : public BuiltInSchema {
 public:
  BoxSchema();
};

}  // namespace tinycad::features
