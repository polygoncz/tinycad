#pragma once

// The data half of the cylinder feature (src/features/cylinder/schema.ts): base, axis,
// radius and height > 0; no rule of its own.

#include "schema_base.hpp"

namespace tinycad::features {

class CylinderSchema final : public BuiltInSchema {
 public:
  CylinderSchema();
};

}  // namespace tinycad::features
