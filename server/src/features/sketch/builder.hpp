#pragma once

// The behaviour half of the sketch feature (src/features/sketch/builder.ts, spec 12 "Featura
// skici"): the regions of the sketch from the kernel (M30, ADR 0028), one planar face per region,
// and the sketch artifact that carries the plane, the solved entities, the lines for the Revolve
// axis, the faces and the outlines. The data are solved already; the builder never calls the
// solver.

#include <string>

#include "tinycad/regen/builder.hpp"

namespace tinycad::features {

class SketchBuilder final : public regen::FeatureBuilder {
 public:
  [[nodiscard]] const std::string& type() const override;
  regen::BuildResult build(const regen::BuildInput& input, regen::BuildContext& ctx) const override;
};

}  // namespace tinycad::features
