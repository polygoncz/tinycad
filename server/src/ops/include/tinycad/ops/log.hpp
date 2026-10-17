#pragma once

// The operation log (spec 04 "Operační log", src/ops/log.ts): append-only, the source of truth
// of a document (ADR 0005). Without events (decision N21): the dispatcher, which is the only
// writer, tells the undo manager about a new entry itself (dispatcher.hpp, onAppended).

#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "tinycad/ops/operation.hpp"

namespace tinycad::ops {

enum class EntryKind { Do, Undo, Redo };

/** "do", "undo", "redo". */
std::string_view entryKindName(EntryKind kind);

struct LogEntry {
  /** 1, 2, 3, … within a document. */
  std::int64_t seq = 0;
  EntryKind kind = EntryKind::Do;
  /** Undo and Redo: seq of the original Do entry; unset for Do. */
  std::optional<std::int64_t> target;
  /** Exactly what was applied. */
  Operation op;
  Operation inverse;
  /** Shown in the history. */
  std::string label;
  /** ms since the epoch, metadata only. */
  double time = 0;
};

/** JSON of the TS LogEntry { seq, kind, target?, op, inverse, label, time }. */
Json logEntryJson(const LogEntry& entry);

class OperationLog {
 public:
  /** An empty log. */
  OperationLog() = default;
  /** A log restored from stored entries; they must have seq 1..n without gaps (AssertionError). */
  explicit OperationLog(std::vector<LogEntry> restored);

  /** Appends with seq = lastSeq() + 1 (the seq of `entry` is ignored) and returns the entry. */
  LogEntry append(LogEntry entry);

  /** Entries with seq >= fromSeq, in order; a copy. */
  [[nodiscard]] std::vector<LogEntry> entries(std::int64_t fromSeq = 1) const;
  /** The entry with this seq, nullptr when there is none. */
  [[nodiscard]] const LogEntry* entry(std::int64_t seq) const;
  /** 0 for an empty log. */
  [[nodiscard]] std::int64_t lastSeq() const;

 private:
  // Nothing is ever removed, so seq doubles as index + 1.
  std::vector<LogEntry> entries_;
};

}  // namespace tinycad::ops
