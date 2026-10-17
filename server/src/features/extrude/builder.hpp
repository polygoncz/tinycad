#pragma once

// The behaviour half of the extrude feature (src/features/extrude/builder.ts): one prism per region along the normal of the sketch, applied
// by the shared body operation (spec 07 "Operace tělesa"); the anchor 'base' for blind and
// symmetric.

#include <string>

#include "tinycad/regen/builder.hpp"

namespace tinycad::features {

class ExtrudeBuilder final : public regen::FeatureBuilder {
 public:
  [[nodiscard]] const std::string& type() const override;
  regen::BuildResult build(const regen::BuildInput& input,
                           regen::BuildContext& ctx) const override;
};

}  // namespace tinycad::features
