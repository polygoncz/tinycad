#pragma once

// The behaviour half of the boolean feature (src/features/boolean/builder.ts): one kernel boolean, one result body with the identity of the
// first target and the names from the kernel history (R8).

#include <string>

#include "tinycad/regen/builder.hpp"

namespace tinycad::features {

class BooleanBuilder final : public regen::FeatureBuilder {
 public:
  [[nodiscard]] const std::string& type() const override;
  regen::BuildResult build(const regen::BuildInput& input,
                           regen::BuildContext& ctx) const override;
};

}  // namespace tinycad::features
