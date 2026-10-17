#pragma once

// Undo and redo (spec 04 "Undo/redo", src/ops/undo.ts): the stacks are derived from the log
// (seq of the original Do entries, top at the end); undo dispatches the inverse of the top entry
// as an Undo entry, redo its op again as a Redo entry. document.rename stays out of undo (M19.2).

#include <cstdint>
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

/**
 * The stacks from entry metadata (pure). An undo or redo entry that does not target the top of
 * its stack is a corrupt log: AssertionError with its seq.
 */
UndoStacks rebuildUndoStacks(const std::vector<LogEntry>& entries);

class UndoManager final : private LogListener {
 public:
  /**
   * Rebuilds the stacks from the log and becomes the listener of the dispatcher, which keeps them
   * up to date (decision N21). Both must outlive the manager.
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

  /** Precondition canUndo() (AssertionError). A failing dispatch changes neither log nor stacks. */
  core::Result<LogEntry, OperationLoadError> undo();
  /** Precondition canRedo() (AssertionError). */
  core::Result<LogEntry, OperationLoadError> redo();

 private:
  void onAppended(const LogEntry& entry) override;

  OperationDispatcher& dispatcher_;
  const OperationLog& log_;
  UndoStacks stacks_;
};

}  // namespace tinycad::ops
