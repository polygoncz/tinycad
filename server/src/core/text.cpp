#include "tinycad/core/text.hpp"

namespace tinycad::core {

namespace {

/** What String.prototype.trim removes (ECMAScript WhiteSpace and LineTerminator), UTF-8. */
constexpr std::string_view TRIMMED[] = {
    "\t",           "\n",           "\v",           "\f",           "\r",           " ",
    "\xC2\xA0",     "\xE1\x9A\x80", "\xE2\x80\x80", "\xE2\x80\x81", "\xE2\x80\x82", "\xE2\x80\x83",
    "\xE2\x80\x84", "\xE2\x80\x85", "\xE2\x80\x86", "\xE2\x80\x87", "\xE2\x80\x88", "\xE2\x80\x89",
    "\xE2\x80\x8A", "\xE2\x80\xA8", "\xE2\x80\xA9", "\xE2\x80\xAF", "\xE2\x81\x9F", "\xE3\x80\x80",
    "\xEF\xBB\xBF"};

}  // namespace

std::string trimJs(std::string_view text) {
  bool changed = true;
  while (changed && !text.empty()) {
    changed = false;
    for (const std::string_view space : TRIMMED) {
      if (text.starts_with(space)) {
        text.remove_prefix(space.size());
        changed = true;
      }
      if (text.ends_with(space)) {
        text.remove_suffix(space.size());
        changed = true;
      }
    }
  }
  return std::string(text);
}

bool isTrimmed(std::string_view text) {
  for (const std::string_view space : TRIMMED) {
    if (text.starts_with(space) || text.ends_with(space)) return false;
  }
  return true;
}

}  // namespace tinycad::core
