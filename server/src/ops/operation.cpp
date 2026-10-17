#include "tinycad/ops/operation.hpp"

#include <string>

#include "tinycad/core/result.hpp"

namespace tinycad::ops {

int opVersion(std::string_view type) {
  for (const auto& [name, version] : OP_VERSION) {
    if (name == type) return version;
  }
  TINYCAD_ASSERT(false, "OP_VERSION has no type '" + std::string(type) + "'");
  return 0;
}

bool isDocumentRename(const Operation& op) {
  if (!op.is_object()) return false;
  const auto type = op.find("type");
  const auto name = op.find("name");
  return type != op.end() && *type == "document.rename" && name != op.end() && name->is_string();
}

std::string typeOf(const Operation& op) {
  if (!op.is_object()) return {};
  const auto type = op.find("type");
  return type != op.end() && type->is_string() ? type->get<std::string>() : std::string();
}

}  // namespace tinycad::ops
