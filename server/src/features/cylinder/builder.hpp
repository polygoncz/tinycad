#pragma once

// The behaviour half of the cylinder feature (src/features/cylinder/builder.ts): one cylinder per feature along a world axis, a new body with the
// names of the kernel roles.

#include <string>

#include "tinycad/regen/builder.hpp"

namespace tinycad::features {

class CylinderBuilder final : public regen::FeatureBuilder {
 public:
  [[nodiscard]] const std::string& type() const override;
  regen::BuildResult build(const regen::BuildInput& input,
                           regen::BuildContext& ctx) const override;
};

}  // namespace tinycad::features
