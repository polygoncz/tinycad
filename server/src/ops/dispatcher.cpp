#include "tinycad/ops/dispatcher.hpp"

#include <utility>

#include "tinycad/ops/apply.hpp"
#include "tinycad/ops/transaction.hpp"

namespace tinycad::ops {

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

void OperationDispatcher::assertIdle(const std::string& what) const {
  TINYCAD_ASSERT(!applying_,
                 what + ": not allowed while an operation is being applied (reentrance)");
}

core::Result<Operation, OperationLoadError> OperationDispatcher::applyGuarded(const Operation& op) {
  assertIdle("apply");
  applying_ = true;
  // applyOperation reports failures as values; an AssertionError (a bug) must not leave the flag
  // up either.
  try {
    auto result = applyOperation(doc_, handlers_, op);
    applying_ = false;
    return result;
  } catch (...) {
    applying_ = false;
    throw;
  }
}

LogEntry OperationDispatcher::append(LogEntry entry) {
  LogEntry written = log_.append(std::move(entry));
  if (listener_ != nullptr) listener_->onAppended(written);
  return written;
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

core::Result<LogEntry, OperationLoadError> OperationDispatcher::dispatch(const Operation& op,
                                                                         const DispatchMeta& meta) {
  assertIdle("dispatch");
  TINYCAD_ASSERT(!active_, "dispatch: a transaction is running, use it instead");
  checkMeta(meta);

  // A failing operation changes nothing, so nothing is written.
  auto inverse = applyGuarded(op);
  if (!inverse) return core::fail(inverse.error());

  LogEntry entry;
  entry.kind = meta.kind;
  entry.target = meta.target;
  entry.op = op;
  entry.inverse = std::move(*inverse);
  entry.label = meta.label.value_or(typeOf(op));
  entry.time = now();
  return append(std::move(entry));
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
