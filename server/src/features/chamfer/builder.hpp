#pragma once

// The behaviour half of the chamfer feature (src/features/chamfer/builder.ts): one kernel chamfer
// per body with all its edges; the body keeps its identity (R105). A chamfer the kernel cannot make
// is INVALID_PARAMS chamfer.failed at distance.

#include <string>

#include "tinycad/regen/builder.hpp"

namespace tinycad::features {

class ChamferBuilder final : public regen::FeatureBuilder {
 public:
  [[nodiscard]] const std::string& type() const override;
  regen::BuildResult build(const regen::BuildInput& input, regen::BuildContext& ctx) const override;
};

}  // namespace tinycad::features
