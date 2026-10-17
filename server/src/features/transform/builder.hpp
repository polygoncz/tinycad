#pragma once

// The behaviour half of the transform feature (src/features/transform/builder.ts): moves the picked
// bodies by one rigid motion T(translate) · T(p) · Rz · Ry · Rx · T(−p); each body keeps its
// identity. For the pivot 'bodiesCenter' the pivot is the anchor 'pivot' of the manipulator (M18).

#include <string>

#include "tinycad/regen/builder.hpp"

namespace tinycad::features {

class TransformBuilder final : public regen::FeatureBuilder {
 public:
  [[nodiscard]] const std::string& type() const override;
  regen::BuildResult build(const regen::BuildInput& input, regen::BuildContext& ctx) const override;
};

}  // namespace tinycad::features
