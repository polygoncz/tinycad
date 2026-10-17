#pragma once

// The behaviour half of the box feature (src/features/box/builder.ts): one axis-aligned box per
// feature, a new body with the names of the kernel roles.

#include <string>

#include "tinycad/regen/builder.hpp"

namespace tinycad::features {

class BoxBuilder final : public regen::FeatureBuilder {
 public:
  [[nodiscard]] const std::string& type() const override;
  regen::BuildResult build(const regen::BuildInput& input, regen::BuildContext& ctx) const override;
};

}  // namespace tinycad::features
