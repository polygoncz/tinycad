#include "tinycad/ops/parse_entry.hpp"

#include <cstdint>
#include <string>
#include <utility>

#include "tinycad/ops/upcast.hpp"

namespace tinycad::ops {

namespace {

using Result = core::Result<LogEntry, OperationLoadError>;

/** 2^53: the largest seq a JSON number holds exactly. */
constexpr double kMaxSafeInteger = 9007199254740992.0;

Result fail(std::string path, std::string message) {
  return core::fail(OperationLoadError{std::move(path), std::move(message)});
}

const Json* field(const Json& object, const char* key) {
  const auto it = object.find(key);
  return it == object.end() ? nullptr : &*it;
}

bool isWhole(const Json* v, double min) {
  return v != nullptr && core::isWholeNumber(*v) && core::numberOf(*v) >= min &&
         core::numberOf(*v) <= kMaxSafeInteger;
}

std::optional<EntryKind> kindOf(const Json* v) {
  if (v == nullptr || !v->is_string()) return std::nullopt;
  const std::string& name = v->get_ref<const std::string&>();
  if (name == "do") return EntryKind::Do;
  if (name == "undo") return EntryKind::Undo;
  if (name == "redo") return EntryKind::Redo;
  return std::nullopt;
}

/** upcastOperation with the paths under `prefix` ('op', 'inverse'). */
core::Result<Operation, OperationLoadError> operation(const OpHandlerRegistry& handlers,
                                                      const Json* raw, const std::string& prefix) {
  auto result = upcastOperation(handlers, raw == nullptr ? Json() : *raw);
  if (result) return result;
  const std::string& path = result.error().path;
  return core::fail(
      OperationLoadError{path.empty() ? prefix : prefix + "." + path, result.error().message});
}

}  // namespace

Result parseLogEntry(const OpHandlerRegistry& handlers, const Json& raw) {
  if (!raw.is_object()) return fail("", "Must be an object");
  const Json* seq = field(raw, "seq");
  const Json* kind = field(raw, "kind");
  const Json* target = field(raw, "target");
  const Json* label = field(raw, "label");
  const Json* time = field(raw, "time");
  if (!isWhole(seq, 1)) return fail("seq", "Must be a whole number >= 1");
  const auto entryKind = kindOf(kind);
  if (!entryKind) return fail("kind", "Must be 'do', 'undo' or 'redo'");
  if (*entryKind == EntryKind::Do) {
    if (target != nullptr) return fail("target", "Must be absent for kind 'do'");
  } else if (!isWhole(target, 1) || core::numberOf(*target) >= core::numberOf(*seq)) {
    return fail("target", "Must be a whole number >= 1 and < seq for kind '" +
                              std::string(entryKindName(*entryKind)) + "'");
  }
  if (label == nullptr || !label->is_string()) return fail("label", "Must be a string");
  if (time == nullptr || !core::isFiniteNumber(*time)) return fail("time", "Must be a finite number");

  auto op = operation(handlers, field(raw, "op"), "op");
  if (!op) return core::fail(op.error());
  auto inverse = operation(handlers, field(raw, "inverse"), "inverse");
  if (!inverse) return core::fail(inverse.error());

  LogEntry entry;
  entry.seq = static_cast<std::int64_t>(core::numberOf(*seq));
  entry.kind = *entryKind;
  if (*entryKind != EntryKind::Do) entry.target = static_cast<std::int64_t>(core::numberOf(*target));
  entry.op = std::move(*op);
  entry.inverse = std::move(*inverse);
  entry.label = label->get<std::string>();
  entry.time = core::numberOf(*time);
  return entry;
}

}  // namespace tinycad::ops
