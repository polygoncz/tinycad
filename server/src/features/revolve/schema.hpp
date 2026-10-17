#pragma once

// The data half of the revolve feature (src/features/revolve/schema.ts): regions, axis,
// operation, targets, angle and flip; the TS predicates are VisibleWhen data (N20).

#include "schema_base.hpp"

namespace tinycad::features {

class RevolveSchema final : public BuiltInSchema {
 public:
  RevolveSchema();
};

}  // namespace tinycad::features
