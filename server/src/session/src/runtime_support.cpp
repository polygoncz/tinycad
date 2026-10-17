#include "runtime_support.hpp"

#include <cstddef>

namespace tinycad::session {

namespace {

// The same list as kTrimmed in server/src/ops/handlers/document.cpp (internal to ops).
constexpr std::string_view kTrimmed[] = {
    "\t",           "\n",           "\v",           "\f",           "\r",           " ",
    "\xC2\xA0",     "\xE1\x9A\x80", "\xE2\x80\x80", "\xE2\x80\x81", "\xE2\x80\x82", "\xE2\x80\x83",
    "\xE2\x80\x84", "\xE2\x80\x85", "\xE2\x80\x86", "\xE2\x80\x87", "\xE2\x80\x88", "\xE2\x80\x89",
    "\xE2\x80\x8A", "\xE2\x80\xA8", "\xE2\x80\xA9", "\xE2\x80\xAF", "\xE2\x81\x9F", "\xE3\x80\x80",
    "\xEF\xBB\xBF"};

void trimFileNameEdges(std::string& s) {
  const auto edge = [](char c) { return c == '.' || std::string_view(" \t\n\r\v\f").contains(c); };
  while (!s.empty() && edge(s.front())) s.erase(s.begin());
  while (!s.empty() && edge(s.back())) s.pop_back();
}

}  // namespace

std::string trimDocumentName(std::string_view name) {
  bool changed = true;
  while (changed && !name.empty()) {
    changed = false;
    for (const std::string_view space : kTrimmed) {
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

std::string safeFileName(const std::string& name) {
  constexpr std::size_t maxLength = 100;
  std::string safe;
  for (const char c : name) {
    const auto byte = static_cast<unsigned char>(c);
    const bool unsafe = byte < 0x20 || byte == 0x7f || std::string_view("\\/:*?\"<>|").contains(c);
    safe += unsafe ? '_' : c;
  }
  trimFileNameEdges(safe);
  if (safe.size() > maxLength) {
    std::size_t cut = maxLength;
    // Back to the start of a UTF-8 sequence (continuation bytes are 10xxxxxx).
    while (cut > 0 && (static_cast<unsigned char>(safe[cut]) & 0xC0) == 0x80) --cut;
    safe.resize(cut);
  }
  trimFileNameEdges(safe);
  return safe.empty() ? "tinycad" : safe;
}

}  // namespace tinycad::session
