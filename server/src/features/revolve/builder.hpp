#pragma once

// The behaviour half of the revolve feature (src/features/revolve/builder.ts): every region turned
// about the axis, the solids applied by the shared body operation (spec 07 "Operace tělesa").

#include <string>

#include "tinycad/regen/builder.hpp"

namespace tinycad::features {

class RevolveBuilder final : public regen::FeatureBuilder {
 public:
  [[nodiscard]] const std::string& type() const override;
  regen::BuildResult build(const regen::BuildInput& input, regen::BuildContext& ctx) const override;
};

}  // namespace tinycad::features
