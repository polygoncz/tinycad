#pragma once

// The data half of the fillet feature (src/features/fillet/schema.ts): edges and one radius > 0;
// duplicate edges are the generic param.duplicateRef.

#include "schema_base.hpp"

namespace tinycad::features {

class FilletSchema final : public BuiltInSchema {
 public:
  FilletSchema();
};

}  // namespace tinycad::features
