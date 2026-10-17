#include "trim.hpp"

namespace tinycad::storage {

namespace {

// The same list as kTrimmed in server/src/ops/handlers/document.cpp (internal to ops).
constexpr std::string_view TRIMMED[] = {
    "\t",           "\n",           "\v",           "\f",           "\r",           " ",
    "\xC2\xA0",     "\xE1\x9A\x80", "\xE2\x80\x80", "\xE2\x80\x81", "\xE2\x80\x82", "\xE2\x80\x83",
    "\xE2\x80\x84", "\xE2\x80\x85", "\xE2\x80\x86", "\xE2\x80\x87", "\xE2\x80\x88", "\xE2\x80\x89",
    "\xE2\x80\x8A", "\xE2\x80\xA8", "\xE2\x80\xA9", "\xE2\x80\xAF", "\xE2\x81\x9F", "\xE3\x80\x80",
    "\xEF\xBB\xBF"};

}  // namespace

std::string trimName(std::string_view name) {
  bool changed = true;
  while (changed && !name.empty()) {
    changed = false;
    for (const std::string_view space : TRIMMED) {
      if (name.starts_with(space)) {
        name.remove_prefix(space.size());
        changed = true;
      }
      if (name.ends_with(space)) {
        name.remove_suffix(space.size());
        changed = true;
      }
    }
  }
  return std::string(name);
}

}  // namespace tinycad::storage
