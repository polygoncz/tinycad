#pragma once

// The data half of the transform feature (src/features/transform/schema.ts), version 3: bodies,
// pivot, pivotPoint, translate and the angles rx, ry, rz, with the migrations 1 -> 2 -> 3.

#include "schema_base.hpp"

namespace tinycad::features {

class TransformSchema final : public BuiltInSchema {
 public:
  TransformSchema();
  [[nodiscard]] bool hasMigrate() const override { return true; }
  [[nodiscard]] core::Result<Json, std::string> migrate(int fromVersion,
                                                        const Json& raw) const override;
};

}  // namespace tinycad::features
