#include "runtime_support.hpp"

#include <cstddef>

namespace tinycad::session {

namespace v1 = tinycad::v1;

namespace {

v1::FeatureError::Code errorCode(regen::FeatureErrorCode code) {
  switch (code) {
    case regen::FeatureErrorCode::InvalidParams:
      return v1::FeatureError::CODE_INVALID_PARAMS;
    case regen::FeatureErrorCode::UnresolvedReference:
      return v1::FeatureError::CODE_UNRESOLVED_REFERENCE;
    case regen::FeatureErrorCode::Kernel:
      return v1::FeatureError::CODE_KERNEL;
    case regen::FeatureErrorCode::UnknownType:
      return v1::FeatureError::CODE_UNKNOWN_TYPE;
    case regen::FeatureErrorCode::StaleVersion:
      return v1::FeatureError::CODE_STALE_VERSION;
  }
  return v1::FeatureError::CODE_UNSPECIFIED;
}

/** As in session_error.cpp: ParamIssue.params → ParamIssue.values. */
void issueToProto(const document::ParamIssue& issue, v1::ParamIssue* out) {
  out->set_param(issue.param);
  out->set_code(issue.code);
  if (!issue.params.is_object()) return;
  auto& values = *out->mutable_values();
  for (const auto& item : issue.params.items()) {
    v1::ParamIssueValue& value = values[item.key()];
    if (item.value().is_number()) {
      value.set_number(item.value().get<double>());
    } else if (item.value().is_string()) {
      value.set_text(item.value().get<std::string>());
    } else {
      value.set_text(item.value().dump());
    }
  }
}

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

void featureStatusToProto(const regen::FeatureStatus& status, v1::FeatureStatus* out) {
  out->Clear();
  switch (status.kind) {
    case regen::FeatureStatusKind::Ok:
      out->mutable_ok();
      return;
    case regen::FeatureStatusKind::Warning:
      out->mutable_warning()->set_message(status.message);
      return;
    case regen::FeatureStatusKind::Error: {
      auto* error = out->mutable_error();
      if (!status.error) return;
      error->set_code(errorCode(status.error->code));
      error->set_message(status.error->message);
      for (const auto& issue : status.error->issues) issueToProto(issue, error->add_issues());
      return;
    }
    case regen::FeatureStatusKind::Suppressed:
      out->mutable_suppressed();
      return;
    case regen::FeatureStatusKind::RolledBack:
      out->mutable_rolled_back();
      return;
  }
}

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
