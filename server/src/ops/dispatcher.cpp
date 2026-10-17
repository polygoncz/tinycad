#include "tinycad/ops/dispatcher.hpp"

#include <utility>

#include "tinycad/ops/apply.hpp"
#include "tinycad/ops/transaction.hpp"

namespace tinycad::ops {

namespace {

/** Raises a flag for its lifetime (RAII): an AssertionError (a bug) does not leave it up either. */
class FlagRaised {
 public:
  explicit FlagRaised(bool& flag) : flag_(flag) { flag_ = true; }
  ~FlagRaised() { flag_ = false; }
  FlagRaised(const FlagRaised&) = delete;
  FlagRaised& operator=(const FlagRaised&) = delete;

 private:
  bool& flag_;
};

}  // namespace

DispatchError DispatchError::invalid(const OperationLoadError& error) {
  return DispatchError{Kind::Invalid, error.path, error.message, true};
}

DispatchError DispatchError::writeFailed(const WriteFailed& error) {
  return DispatchError{Kind::WriteFailed, "", error.message, error.reverted};
}

OperationDispatcher::OperationDispatcher(document::DocumentWriter& doc,
                                         const OpHandlerRegistry& handlers, OperationLog& log,
                                         Clock now)
    : doc_(doc), handlers_(handlers), log_(log), now_(std::move(now)) {
  TINYCAD_ASSERT(static_cast<bool>(now_), "OperationDispatcher: a clock is required");
}

bool OperationDispatcher::inTransaction() const { return active_; }

void OperationDispatcher::setListener(LogListener* listener) {
  TINYCAD_ASSERT(listener == nullptr || listener_ == nullptr,
                 "OperationDispatcher: the listener is already set");
  listener_ = listener;
}

void OperationDispatcher::setWriter(EntryWriter* writer) {
  TINYCAD_ASSERT(writer == nullptr || writer_ == nullptr,
                 "OperationDispatcher: the writer is already set");
  writer_ = writer;
}

void OperationDispatcher::assertIdle(const std::string& what) const {
  TINYCAD_ASSERT(!applying_,
                 what + ": not allowed while an operation is being applied (reentrance)");
}

core::Result<Operation, OperationLoadError> OperationDispatcher::applyGuarded(const Operation& op) {
  assertIdle("apply");
  const FlagRaised applying(applying_);
  return applyOperation(doc_, handlers_, op);
}

core::Result<LogEntry, std::string> OperationDispatcher::writeAndAppend(LogEntry entry) {
  if (writer_ != nullptr) {
    entry.seq = log_.lastSeq() + 1;
    // The writer must not call back into the dispatcher: the flag makes that an AssertionError.
    const FlagRaised writing(applying_);
    auto written = writer_->write(entry);
    if (!written) return core::fail(std::move(written.error()));
  }
  LogEntry appended = log_.append(std::move(entry));
  if (listener_ != nullptr) listener_->onAppended(appended);
  return appended;
}

void OperationDispatcher::checkMeta(const DispatchMeta& meta) const {
  if (meta.kind == EntryKind::Do) {
    TINYCAD_ASSERT(!meta.target, "dispatch: 'target' is only allowed for kind 'undo' and 'redo'");
    return;
  }
  TINYCAD_ASSERT(meta.target.has_value(), "dispatch: kind '" +
                                              std::string(entryKindName(meta.kind)) +
                                              "' requires 'target'");
  const LogEntry* found = log_.entry(*meta.target);
  TINYCAD_ASSERT(found != nullptr, "dispatch: target " + std::to_string(*meta.target) +
                                       " is not an existing log entry");
  TINYCAD_ASSERT(found->kind == EntryKind::Do,
                 "dispatch: target " + std::to_string(*meta.target) + " is not a 'do' entry");
}

core::Result<LogEntry, DispatchError> OperationDispatcher::dispatch(const Operation& op,
                                                                    const DispatchMeta& meta) {
  assertIdle("dispatch");
  TINYCAD_ASSERT(!active_, "dispatch: a transaction is running, use it instead");
  checkMeta(meta);

  // A failing operation changes nothing, so nothing is written.
  auto inverse = applyGuarded(op);
  if (!inverse) return core::fail(DispatchError::invalid(inverse.error()));

  LogEntry entry;
  entry.kind = meta.kind;
  entry.target = meta.target;
  entry.op = op;
  entry.inverse = std::move(*inverse);
  entry.label = meta.label.value_or(typeOf(op));
  entry.time = now();
  const Operation revert = entry.inverse;
  auto appended = writeAndAppend(std::move(entry));
  if (appended) return std::move(*appended);

  // Nothing was appended (write-ahead, N155): the inverse brings the document back. One that
  // fails is a bug of its handler; the caller then reloads the document (reverted = false).
  WriteFailed failed{std::move(appended.error()), true};
  failed.reverted = applyGuarded(revert).has_value();
  return core::fail(DispatchError::writeFailed(failed));
}

std::unique_ptr<Transaction> OperationDispatcher::begin(std::string label) {
  assertIdle("begin");
  TINYCAD_ASSERT(!active_, "begin: a transaction is already running");
  active_ = true;
  // The constructor is private to Transaction and its friend: no make_unique.
  return std::unique_ptr<Transaction>(new Transaction(*this, handlers_, std::move(label)));
}

void OperationDispatcher::endTransaction() { active_ = false; }

}  // namespace tinycad::ops
