#include "chamfer/builder.hpp"

#include "common/dressup.hpp"

namespace tinycad::features {

const std::string& ChamferBuilder::type() const {
  static const std::string kType = "chamfer";
  return kType;
}

regen::BuildResult ChamferBuilder::build(const regen::BuildInput& input,
                                         regen::BuildContext& ctx) const {
  return buildDressup(DressupKind::Chamfer, input, ctx);
}

}  // namespace tinycad::features
