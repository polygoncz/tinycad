#pragma once

// A transaction (spec 04 "Transakce", src/ops/transaction.ts): steps applied at once and written
// as one log entry on commit. Neighbouring steps of one type merge when their handler can merge
// them (two setParams of one feature, ADR 0025), on apply and again on commit; a transient step
// (applyTransient, Q018) is reverted on commit and abort, never logged, and interrupts merging.
// A commit whose entry cannot be written (EntryWriter, N155) leaves the transaction open.

#include <optional>
#include <string>
#include <vector>

#include "tinycad/core/result.hpp"
#include "tinycad/ops/dispatcher.hpp"
#include "tinycad/ops/log.hpp"
#include "tinycad/ops/operation.hpp"

namespace tinycad::ops {

class OpHandlerRegistry;

class Transaction {
 public:
  /** RAII: a transaction that is still open is aborted (its steps reverted, nothing logged). */
  ~Transaction();
  Transaction(const Transaction&) = delete;
  Transaction& operator=(const Transaction&) = delete;

  [[nodiscard]] const std::string& label() const { return label_; }
  /** After commit or abort. */
  [[nodiscard]] bool ended() const { return ended_; }

  /** Applies at once and remembers the op with its inverse. A failure leaves it open and unchanged. */
  core::Result<void, OperationLoadError> apply(const Operation& op);
  /** Applies at once; reverted on commit and abort, never logged (Q018). */
  core::Result<void, OperationLoadError> applyTransient(const Operation& op);
  /**
   * Reverts the transient steps, writes one entry (the only step, or a batch of the merged steps
   * with a batch of their inverses in reverse order) and ends. An empty transaction writes nothing
   * (the writer is not called) and returns nullopt. A failed write (N155) does NOT end it: the
   * logged steps stay applied, the transient ones are gone (reverted, never logged), and a later
   * commit or abort works as usual. `reverted` of the failure is always true.
   */
  core::Result<std::optional<LogEntry>, WriteFailed> commit();
  /** Applies the inverses in reverse order, writes nothing and ends. */
  void abort();

  // Every call after the end, and every call from inside an apply, throws AssertionError.

 private:
  friend class OperationDispatcher;

  struct Step {
    Operation op;
    Operation inverse;
    /** Reverted on commit too and never logged. */
    bool transient = false;
  };

  Transaction(OperationDispatcher& dispatcher, const OpHandlerRegistry& handlers, std::string label);

  void checkOpen(const std::string& what) const;
  core::Result<void, OperationLoadError> applyStep(const Operation& op, bool transient);
  /** Merges into the preceding step when both are logged, of one type and the handler merges. */
  void remember(Step step);
  /** Logged steps folded left to right where the handler merges them. */
  [[nodiscard]] std::vector<Step> compress() const;
  /** Applies the inverses of the steps in reverse order; a failing inverse is a bug. */
  void revert(const std::vector<Step>& steps);
  void finish();

  OperationDispatcher& dispatcher_;
  const OpHandlerRegistry& handlers_;
  std::string label_;
  std::vector<Step> steps_;
  bool ended_ = false;
};

}  // namespace tinycad::ops
