#include "tinycad/document/model.hpp"

#include <cstddef>
#include <iterator>

namespace tinycad::document {

std::string_view bodyMaterialName(BodyMaterial material) {
  return BODY_MATERIAL_NAMES[static_cast<std::size_t>(material)];
}

std::optional<BodyMaterial> parseBodyMaterial(std::string_view name) {
  for (std::size_t i = 0; i < std::size(BODY_MATERIAL_NAMES); ++i) {
    if (BODY_MATERIAL_NAMES[i] == name) return static_cast<BodyMaterial>(i);
  }
  return std::nullopt;
}

bool isBodyColor(std::string_view color) {
  if (color.size() != 7 || color[0] != '#') return false;
  for (std::size_t i = 1; i < color.size(); ++i) {
    const char c = color[i];
    if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return false;
  }
  return true;
}

bool sameFeature(const FeatureInstance& a, const FeatureInstance& b) {
  // A missing params pointer never happens in a valid document; compare it safely anyway.
  const bool sameParams = (a.params && b.params) ? *a.params == *b.params : a.params == b.params;
  return a.id == b.id && a.type == b.type && a.typeVersion == b.typeVersion && a.name == b.name &&
         a.suppressed == b.suppressed && sameParams;
}

bool sameStudio(const PartStudioData& a, const PartStudioData& b) {
  if (a.rollbackIndex != b.rollbackIndex || a.bodies != b.bodies) return false;
  if (a.features.size() != b.features.size()) return false;
  for (std::size_t i = 0; i < a.features.size(); ++i) {
    if (a.features[i] == b.features[i]) continue;
    if (!a.features[i] || !b.features[i] || !sameFeature(*a.features[i], *b.features[i])) {
      return false;
    }
  }
  return true;
}

}  // namespace tinycad::document
