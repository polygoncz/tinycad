#include "renamed_to.hpp"

namespace tinycad::storage {

std::optional<std::string> renamedTo(std::span<const StoredEntry> entries) {
  std::optional<std::string> name;
  for (const StoredEntry& stored : entries) {
    if (!stored.entry.is_object()) continue;
    const auto op = stored.entry.find("op");
    if (op == stored.entry.end() || !op->is_object()) continue;
    const auto type = op->find("type");
    const auto newName = op->find("name");
    if (type != op->end() && *type == "document.rename" && newName != op->end() &&
        newName->is_string()) {
      name = newName->get<std::string>();
    }
  }
  return name;
}

}  // namespace tinycad::storage
