#pragma once

// The data half of the extrude feature (src/features/extrude/schema.ts): regions, operation,
// targets, end type, distance, face and flip; the TS predicates are VisibleWhen data (N20).

#include "schema_base.hpp"

namespace tinycad::features {

class ExtrudeSchema final : public BuiltInSchema {
 public:
  ExtrudeSchema();
};

}  // namespace tinycad::features
