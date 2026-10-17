#pragma once

// Undo and redo (spec 04 "Undo/redo", src/ops/undo.ts): the stacks are derived from the log
// (seq of the original Do entries, top at the end); undo dispatches the inverse of the top entry
// as an Undo entry, redo its op again as a Redo entry. document.rename stays out of undo (M19.2).

#include <cstdint>
#include <string>
#include <vector>

#include "tinycad/core/result.hpp"
#include "tinycad/ops/dispatcher.hpp"
#include "tinycad/ops/log.hpp"

namespace tinycad::ops {

struct UndoStacks {
  std::vector<std::int64_t> undo;
  std::vector<std::int64_t> redo;

  friend bool operator==(const UndoStacks&, const UndoStacks&) = default;
};

/** An undo or redo entry of a stored log that does not target the top of its stack. */
struct CorruptUndoLog {
  /** The seq of the broken entry. */
  std::int64_t seq = 0;
  /** Technical text; never compared. */
  std::string message;
};

/**
 * The stacks from entry metadata (pure). The log comes from outside (a file, an import), so an
 * undo or redo entry that does not target the top of its stack is a failure, not a bug (N108).
 */
core::Result<UndoStacks, CorruptUndoLog> rebuildUndoStacks(const std::vector<LogEntry>& entries);

class UndoManager final : private LogListener {
 public:
  /**
   * Rebuilds the stacks from the log and becomes the listener of the dispatcher, which keeps them
   * up to date (decision N21). Both must outlive the manager. Precondition: rebuildUndoStacks of
   * the log succeeds (the loader checks it first); a corrupt log throws AssertionError.
   */
  UndoManager(OperationDispatcher& dispatcher, const OperationLog& log);
  ~UndoManager() override;
  UndoManager(const UndoManager&) = delete;
  UndoManager& operator=(const UndoManager&) = delete;

  /** The undo stack is not empty and no transaction is open. */
  [[nodiscard]] bool canUndo() const;
  [[nodiscard]] bool canRedo() const;
  /** A copy of the current stacks. */
  [[nodiscard]] UndoStacks stacks() const;

  /**
   * Precondition canUndo() (AssertionError). A failing dispatch (a refused operation or a failed
   * write, N155) changes neither log nor stacks.
   */
  core::Result<LogEntry, DispatchError> undo();
  /** Precondition canRedo() (AssertionError). */
  core::Result<LogEntry, DispatchError> redo();

 private:
  void onAppended(const LogEntry& entry) override;

  OperationDispatcher& dispatcher_;
  const OperationLog& log_;
  UndoStacks stacks_;
};

}  // namespace tinycad::ops
