#include "tinycad/ops/log.hpp"

#include <algorithm>
#include <cstddef>
#include <string>
#include <utility>

#include "tinycad/core/result.hpp"

namespace tinycad::ops {

std::string_view entryKindName(EntryKind kind) {
  switch (kind) {
    case EntryKind::Do: return "do";
    case EntryKind::Undo: return "undo";
    case EntryKind::Redo: return "redo";
  }
  return "do";
}

Json logEntryJson(const LogEntry& entry) {
  Json out = {{"seq", entry.seq},
              {"kind", std::string(entryKindName(entry.kind))},
              {"op", entry.op},
              {"inverse", entry.inverse},
              {"label", entry.label},
              {"time", core::numberJson(entry.time)}};
  if (entry.target) out["target"] = *entry.target;
  return out;
}

OperationLog::OperationLog(std::vector<LogEntry> restored) : entries_(std::move(restored)) {
  for (std::size_t i = 0; i < entries_.size(); ++i) {
    const auto expected = static_cast<std::int64_t>(i + 1);
    TINYCAD_ASSERT(entries_[i].seq == expected,
                   "Log entry at position " + std::to_string(i) + " has seq " +
                       std::to_string(entries_[i].seq) + ", expected " + std::to_string(expected));
  }
}

LogEntry OperationLog::append(LogEntry entry) {
  entry.seq = lastSeq() + 1;
  entries_.push_back(entry);
  return entry;
}

std::vector<LogEntry> OperationLog::entries(std::int64_t fromSeq) const {
  const auto skip = static_cast<std::size_t>(std::clamp<std::int64_t>(fromSeq - 1, 0, lastSeq()));
  return {entries_.begin() + static_cast<std::ptrdiff_t>(skip), entries_.end()};
}

const LogEntry* OperationLog::entry(std::int64_t seq) const {
  if (seq < 1 || seq > lastSeq()) return nullptr;
  return &entries_[static_cast<std::size_t>(seq - 1)];
}

std::int64_t OperationLog::lastSeq() const { return static_cast<std::int64_t>(entries_.size()); }

}  // namespace tinycad::ops
