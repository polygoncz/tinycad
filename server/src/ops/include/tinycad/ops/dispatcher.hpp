#pragma once

// The dispatcher (spec 04 "Dispatcher", src/ops/dispatcher.ts): the only writer of a document and
// its log. dispatch applies an operation and writes it as one entry; begin opens a transaction
// whose steps become one entry on commit (transaction.hpp).
//
// Write-ahead (decision N155): with an EntryWriter set, an entry is written durably BEFORE it is
// appended to the log. A failed write appends nothing: dispatch reverts the document with the
// entry's inverse, commit leaves the transaction open. The append-only log and the undo stacks
// therefore never hold an entry that is not on disk.
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

/** Durable writing of an entry BEFORE the dispatcher appends it to the log (write-ahead, N155). */
class EntryWriter {
 public:
  virtual ~EntryWriter() = default;
  /** entry.seq = log.lastSeq() + 1. An error is a technical text; the dispatcher then appends nothing. */
  virtual core::Result<void, std::string> write(const LogEntry& entry) = 0;
};

/** A failed write through EntryWriter. */
struct WriteFailed {
  std::string message;
  /** false = the inverse failed and the document is in an unknown state (the caller must reload it). */
  bool reverted = true;
};

/**
 * Why dispatch (and undo, redo) failed: a flat struct with a kind (decision N9, like Curve2) whose
 * fields read like those of OperationLoadError and WriteFailed.
 */
struct DispatchError {
  enum class Kind {
    /** The operation was refused (applyOperation); the document is unchanged, nothing written. */
    Invalid,
    /** The entry could not be written (EntryWriter); see `reverted`. */
    WriteFailed,
  };
  Kind kind = Kind::Invalid;
  /** Invalid: where (OperationLoadError::path, 'ops[1].featureId'). */
  std::string path;
  /** Technical text of either kind; never compared. */
  std::string message;
  /** WriteFailed: false = the inverse failed too (WriteFailed::reverted). */
  bool reverted = true;

  static DispatchError invalid(const OperationLoadError& error);
  static DispatchError writeFailed(const WriteFailed& error);
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
   * (applyOperation) writes nothing and leaves the document unchanged (Kind::Invalid). With a
   * writer, the entry is written by it first and only then appended and told to the listener; a
   * failed write applies entry.inverse and leaves log and listener untouched (Kind::WriteFailed,
   * `reverted` = false when the inverse failed too). Programmer errors (AssertionError): a
   * transaction is open, a call from inside an apply or a write (reentrance), meta with a target
   * for Do, without one for Undo/Redo, or a target that is not an existing Do entry.
   */
  core::Result<LogEntry, DispatchError> dispatch(const Operation& op, const DispatchMeta& meta = {});

  /**
   * Opens a transaction; the caller owns it and must not keep it beyond the dispatcher. Only one
   * at a time: a second begin (or a begin from inside an apply) throws AssertionError.
   */
  std::unique_ptr<Transaction> begin(std::string label);

  [[nodiscard]] bool inTransaction() const;

  /** The one listener (UndoManager); nullptr removes it. Replacing a listener throws AssertionError. */
  void setListener(LogListener* listener);

  /**
   * The one writer; nullptr = no durable writing (tests, shared cases). Replacing a writer throws
   * AssertionError. It must outlive the dispatcher or be removed first.
   */
  void setWriter(EntryWriter* writer);

 private:
  friend class Transaction;

  /** applyOperation with the reentrance flag raised for its duration (spec 04). */
  core::Result<Operation, OperationLoadError> applyGuarded(const Operation& op);
  /** AssertionError when an operation is being applied (reentrance). */
  void assertIdle(const std::string& what) const;
  /**
   * Writes the entry with the writer (when set), then appends it, tells the listener and returns
   * the entry with its seq. A failed write appends nothing and returns its message.
   */
  core::Result<LogEntry, std::string> writeAndAppend(LogEntry entry);
  void checkMeta(const DispatchMeta& meta) const;
  /** Called by the transaction when it ends (commit or abort). */
  void endTransaction();
  [[nodiscard]] double now() const { return now_(); }

  document::DocumentWriter& doc_;
  const OpHandlerRegistry& handlers_;
  OperationLog& log_;
  Clock now_;
  LogListener* listener_ = nullptr;
  EntryWriter* writer_ = nullptr;
  bool active_ = false;
  /** An operation is being applied or an entry written: any call back in is reentrance. */
  bool applying_ = false;
};

}  // namespace tinycad::ops
