#include "fillet/builder.hpp"

#include "common/dressup.hpp"

namespace tinycad::features {

const std::string& FilletBuilder::type() const {
  static const std::string kType = "fillet";
  return kType;
}

regen::BuildResult FilletBuilder::build(const regen::BuildInput& input,
                                        regen::BuildContext& ctx) const {
  return buildDressup(DressupKind::Fillet, input, ctx);
}

}  // namespace tinycad::features
