#include "tinycad/ops/undo.hpp"

#include <string>

namespace tinycad::ops {

namespace {

/** One step shared by rebuildUndoStacks and the live manager; asserts on a corrupt log. */
void step(UndoStacks& stacks, const LogEntry& entry) {
  switch (entry.kind) {
    case EntryKind::Do:
      // The name of the document is metadata outside undo (M19.2): Ctrl+Z does not bring back the
      // old name and a rename keeps redo. It commutes with every other operation, so undo of the
      // steps around it stays correct.
      if (isDocumentRename(entry.op)) return;
      stacks.undo.push_back(entry.seq);
      stacks.redo.clear();
      return;
    case EntryKind::Undo:
      TINYCAD_ASSERT(!stacks.undo.empty() && stacks.undo.back() == entry.target,
                     "Corrupt log: undo entry " + std::to_string(entry.seq) +
                         " does not target the top of the undo stack");
      stacks.redo.push_back(stacks.undo.back());
      stacks.undo.pop_back();
      return;
    case EntryKind::Redo:
      TINYCAD_ASSERT(!stacks.redo.empty() && stacks.redo.back() == entry.target,
                     "Corrupt log: redo entry " + std::to_string(entry.seq) +
                         " does not target the top of the redo stack");
      stacks.undo.push_back(stacks.redo.back());
      stacks.redo.pop_back();
      return;
  }
}

}  // namespace

UndoStacks rebuildUndoStacks(const std::vector<LogEntry>& entries) {
  UndoStacks stacks;
  for (const LogEntry& entry : entries) step(stacks, entry);
  return stacks;
}

UndoManager::UndoManager(OperationDispatcher& dispatcher, const OperationLog& log)
    : dispatcher_(dispatcher), log_(log), stacks_(rebuildUndoStacks(log.entries())) {
  dispatcher_.setListener(this);
}

UndoManager::~UndoManager() { dispatcher_.setListener(nullptr); }

bool UndoManager::canUndo() const { return !stacks_.undo.empty() && !dispatcher_.inTransaction(); }

bool UndoManager::canRedo() const { return !stacks_.redo.empty() && !dispatcher_.inTransaction(); }

UndoStacks UndoManager::stacks() const { return stacks_; }

// Stacks change only in onAppended, so a failed dispatch (nothing appended) changes nothing.
void UndoManager::onAppended(const LogEntry& entry) { step(stacks_, entry); }

core::Result<LogEntry, OperationLoadError> UndoManager::undo() {
  TINYCAD_ASSERT(canUndo(), "undo: nothing to undo");
  const std::int64_t target = stacks_.undo.back();
  const LogEntry* entry = log_.entry(target);
  TINYCAD_ASSERT(entry != nullptr, "Undo: log entry " + std::to_string(target) + " is missing");
  // Copies: dispatch appends to the log, which may move its entries.
  const Operation inverse = entry->inverse;
  return dispatcher_.dispatch(inverse, {.label = entry->label, .kind = EntryKind::Undo, .target = target});
}

core::Result<LogEntry, OperationLoadError> UndoManager::redo() {
  TINYCAD_ASSERT(canRedo(), "redo: nothing to redo");
  const std::int64_t target = stacks_.redo.back();
  const LogEntry* entry = log_.entry(target);
  TINYCAD_ASSERT(entry != nullptr, "Redo: log entry " + std::to_string(target) + " is missing");
  const Operation op = entry->op;
  return dispatcher_.dispatch(op, {.label = entry->label, .kind = EntryKind::Redo, .target = target});
}

}  // namespace tinycad::ops
