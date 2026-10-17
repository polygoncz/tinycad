#pragma once

// The dispatcher (spec 04 "Dispatcher", src/ops/dispatcher.ts): the only writer of a document and
// its log. dispatch applies an operation and writes it as one entry; begin opens a transaction
// whose steps become one entry on commit (transaction.hpp).
//
// Without events (decision N21): after writing an entry the dispatcher calls the hook
// LogListener::onAppended of its one listener, which is how UndoManager keeps its stacks. The
// session (M45) calls regeneration itself after each change, so no other subscriber exists.

#include <cstdint>
#include <functional>
#include <memory>
#include <optional>
#include <string>

#include "tinycad/core/result.hpp"
#include "tinycad/document/document.hpp"
#include "tinycad/ops/handler.hpp"
#include "tinycad/ops/log.hpp"

namespace tinycad::ops {

class Transaction;

struct DispatchMeta {
  /** Default: the type of the operation. */
  std::optional<std::string> label;
  /** Undo and Redo are used by UndoManager. */
  EntryKind kind = EntryKind::Do;
  /** Required exactly for Undo and Redo: seq of an existing Do entry. */
  std::optional<std::int64_t> target;
};

/** Told about every entry the dispatcher writes, right after it is in the log. */
class LogListener {
 public:
  virtual ~LogListener() = default;
  virtual void onAppended(const LogEntry& entry) = 0;
};

class OperationDispatcher {
 public:
  /** ms since the epoch for LogEntry::time; the shared cases count script steps (spec 13). */
  using Clock = std::function<double()>;

  /** `doc`, `handlers` and `log` must outlive the dispatcher. */
  OperationDispatcher(document::DocumentWriter& doc, const OpHandlerRegistry& handlers,
                      OperationLog& log, Clock now);
  OperationDispatcher(const OperationDispatcher&) = delete;
  OperationDispatcher& operator=(const OperationDispatcher&) = delete;

  /**
   * Applies the operation and writes it to the log as one entry (spec 04). A failing operation
   * (applyOperation) writes nothing and leaves the document unchanged. Programmer errors
   * (AssertionError): a transaction is open, a call from inside an apply (reentrance), meta with a
   * target for Do, without one for Undo/Redo, or a target that is not an existing Do entry.
   */
  core::Result<LogEntry, OperationLoadError> dispatch(const Operation& op,
                                                      const DispatchMeta& meta = {});

  /**
   * Opens a transaction; the caller owns it and must not keep it beyond the dispatcher. Only one
   * at a time: a second begin (or a begin from inside an apply) throws AssertionError.
   */
  std::unique_ptr<Transaction> begin(std::string label);

  [[nodiscard]] bool inTransaction() const;

  /** The one listener (UndoManager); nullptr removes it. Replacing a listener throws AssertionError. */
  void setListener(LogListener* listener);

 private:
  friend class Transaction;

  /** applyOperation with the reentrance flag raised for its duration (spec 04). */
  core::Result<Operation, OperationLoadError> applyGuarded(const Operation& op);
  /** AssertionError when an operation is being applied (reentrance). */
  void assertIdle(const std::string& what) const;
  /** Appends the entry, tells the listener and returns the entry with its seq. */
  LogEntry append(LogEntry entry);
  void checkMeta(const DispatchMeta& meta) const;
  /** Called by the transaction when it ends (commit or abort). */
  void endTransaction();
  [[nodiscard]] double now() const { return now_(); }

  document::DocumentWriter& doc_;
  const OpHandlerRegistry& handlers_;
  OperationLog& log_;
  Clock now_;
  LogListener* listener_ = nullptr;
  bool active_ = false;
  bool applying_ = false;
};

}  // namespace tinycad::ops
