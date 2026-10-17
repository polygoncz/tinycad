#pragma once

// The data half of the chamfer feature (src/features/chamfer/schema.ts): edges and one
// distance > 0.

#include "schema_base.hpp"

namespace tinycad::features {

class ChamferSchema final : public BuiltInSchema {
 public:
  ChamferSchema();
};

}  // namespace tinycad::features
