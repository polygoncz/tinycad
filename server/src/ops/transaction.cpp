#include "tinycad/ops/transaction.hpp"

#include <utility>

#include "tinycad/ops/dispatcher.hpp"
#include "tinycad/ops/handler.hpp"

namespace tinycad::ops {

namespace {

/** The merged op of two neighbouring ops of one type, when their handler merges them. */
std::optional<Operation> mergeOf(const OpHandlerRegistry& handlers, const Operation& prev,
                                 const Operation& next) {
  const std::string type = typeOf(next);
  if (type.empty() || typeOf(prev) != type) return std::nullopt;
  const OpHandler* handler = handlers.find(type);
  return handler == nullptr ? std::nullopt : handler->merge(prev, next);
}

}  // namespace

Transaction::Transaction(OperationDispatcher& dispatcher, const OpHandlerRegistry& handlers,
                         std::string label)
    : dispatcher_(dispatcher), handlers_(handlers), label_(std::move(label)) {}

Transaction::~Transaction() {
  if (!ended_) abort();
}

void Transaction::checkOpen(const std::string& what) const {
  TINYCAD_ASSERT(!ended_, "Transaction '" + label_ + "' has ended: cannot " + what);
  dispatcher_.assertIdle(what);
}

core::Result<void, OperationLoadError> Transaction::apply(const Operation& op) {
  checkOpen("apply");
  return applyStep(op, false);
}

core::Result<void, OperationLoadError> Transaction::applyTransient(const Operation& op) {
  checkOpen("applyTransient");
  return applyStep(op, true);
}

core::Result<void, OperationLoadError> Transaction::applyStep(const Operation& op, bool transient) {
  // A failing operation changes nothing: the transaction stays open and unchanged.
  auto inverse = dispatcher_.applyGuarded(op);
  if (!inverse) return core::fail(inverse.error());
  remember(Step{op, std::move(*inverse), transient});
  return {};
}

/**
 * Merges the step into the directly preceding one when both are logged, of one type and the
 * handler can merge them (ADR 0025): abort then reverts a long drag with one inverse. A transient
 * step in between interrupts merging, so the inverses keep their order.
 */
void Transaction::remember(Step step) {
  if (!steps_.empty() && !steps_.back().transient && !step.transient) {
    if (auto merged = mergeOf(handlers_, steps_.back().op, step.op)) {
      // The merged op keeps the inverse of the first one.
      steps_.back().op = std::move(*merged);
      return;
    }
  }
  steps_.push_back(std::move(step));
}

std::vector<Transaction::Step> Transaction::compress() const {
  std::vector<Step> out;
  for (const Step& step : steps_) {
    if (step.transient) continue;
    if (!out.empty()) {
      if (auto merged = mergeOf(handlers_, out.back().op, step.op)) {
        out.back().op = std::move(*merged);
        continue;
      }
    }
    out.push_back(step);
  }
  return out;
}

void Transaction::revert(const std::vector<Step>& steps) {
  for (auto it = steps.rbegin(); it != steps.rend(); ++it) {
    const auto reverted = dispatcher_.applyGuarded(it->inverse);
    // The inverse of an applied operation always applies; one that does not is a bug.
    TINYCAD_ASSERT(reverted.has_value(), "Transaction '" + label_ + "': an inverse failed: " +
                                             (reverted ? "" : reverted.error().message));
  }
}

void Transaction::finish() {
  ended_ = true;
  dispatcher_.endTransaction();
}

std::optional<LogEntry> Transaction::commit() {
  checkOpen("commit");
  // Transient steps go back first; the logged ones commute with them (the caller's contract).
  std::vector<Step> transient;
  for (const Step& step : steps_) {
    if (step.transient) transient.push_back(step);
  }
  revert(transient);

  const std::vector<Step> logged = compress();
  std::optional<LogEntry> written;
  if (!logged.empty()) {
    LogEntry entry;
    entry.kind = EntryKind::Do;
    entry.label = label_;
    entry.time = dispatcher_.now();
    if (logged.size() == 1) {
      entry.op = logged.front().op;
      entry.inverse = logged.front().inverse;
    } else {
      Json ops = Json::array();
      Json inverses = Json::array();
      for (const Step& step : logged) ops.push_back(step.op);
      for (auto it = logged.rbegin(); it != logged.rend(); ++it) inverses.push_back(it->inverse);
      entry.op = Json{{"type", "batch"}, {"v", opVersion("batch")}, {"ops", std::move(ops)}};
      entry.inverse =
          Json{{"type", "batch"}, {"v", opVersion("batch")}, {"ops", std::move(inverses)}};
    }
    written = dispatcher_.append(std::move(entry));
  }
  finish();
  return written;
}

void Transaction::abort() {
  checkOpen("abort");
  revert(steps_);
  finish();
}

}  // namespace tinycad::ops
