#pragma once

// The behaviour half of the fillet feature (src/features/fillet/builder.ts): one kernel fillet per body with all its edges; the body keeps
// its identity (R105). A fillet the kernel cannot make is INVALID_PARAMS fillet.failed at radius.

#include <string>

#include "tinycad/regen/builder.hpp"

namespace tinycad::features {

class FilletBuilder final : public regen::FeatureBuilder {
 public:
  [[nodiscard]] const std::string& type() const override;
  regen::BuildResult build(const regen::BuildInput& input,
                           regen::BuildContext& ctx) const override;
};

}  // namespace tinycad::features
