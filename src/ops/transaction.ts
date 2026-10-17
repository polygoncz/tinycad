import { assert } from '@/core';
import type { ApplyResult } from './apply';
import { throwCollected } from './errors';
import type { LogEntry, Transaction } from './legacy-ports';
import type { OpHandlerRegistry } from './op-handler';
import { OP_VERSION } from './operation';
import type { BatchOp, Operation } from './operation';

interface Step {
  readonly op: Operation;
  readonly inverse: Operation;
  /** Reverted on commit too and never logged. */
  readonly transient: boolean;
}

export interface TransactionDeps {
  readonly handlers: OpHandlerRegistry;
  readonly label: string;
  /** applyOperation with the dispatcher's reentrance guard; throws when the handler fails. */
  apply(op: Operation): ApplyResult;
  /** Throws when an operation is being applied (reentrance, spec 04). */
  assertIdle(what: string): void;
  /** Appends the entry; an exception of an `appended` subscriber is pushed to `errors`. */
  append(base: Omit<LogEntry, 'seq'>, errors: unknown[]): LogEntry;
  /** Emits `applied`; throws what subscribers threw. */
  emitApplied(entry: LogEntry | null, op: Operation): void;
  /** Ends the transaction (emits `transaction { active: false }`); throws what subscribers threw. */
  end(): void;
  now(): number;
}

/** Runs fn and pushes its exception, if any, to `errors`. */
function collect(errors: unknown[], fn: () => void): void {
  try {
    fn();
  } catch (e) {
    errors.push(e);
  }
}

export function createTransaction(deps: TransactionDeps): Transaction {
  const { handlers, label } = deps;
  const steps: Step[] = [];
  let ended = false;

  function checkOpen(what: string): void {
    assert(!ended, `Transaction '${label}' has ended: cannot ${what}`);
    deps.assertIdle(what);
  }

  /** `ended` is set first, so a throwing subscriber cannot leave the transaction open. */
  function finish(): void {
    ended = true;
    deps.end();
  }

  /** The entry to write, or null for an empty transaction. */
  function plan(): { base: Omit<LogEntry, 'seq'>; op: Operation } | null {
    const compressed = compress();
    const [only] = compressed;
    if (only === undefined) return null;
    const time = deps.now();
    if (compressed.length === 1) {
      return { base: { kind: 'do', op: only.op, inverse: only.inverse, label, time }, op: only.op };
    }
    const op: BatchOp = { type: 'batch', v: OP_VERSION.batch, ops: compressed.map((s) => s.op) };
    const inverse: BatchOp = {
      type: 'batch',
      v: OP_VERSION.batch,
      ops: compressed.map((s) => s.inverse).reverse(),
    };
    return { base: { kind: 'do', op, inverse, label, time }, op };
  }

  /** Sibling ops of one type whose handler can merge are folded left to right. */
  function compress(): Step[] {
    const out: Step[] = [];
    for (const step of steps) {
      if (step.transient) continue;
      const last = out[out.length - 1];
      const handler =
        last !== undefined && last.op.type === step.op.type
          ? handlers.find(step.op.type)
          : undefined;
      const merged = last !== undefined && handler?.merge ? handler.merge(last.op, step.op) : null;
      if (last !== undefined && merged !== null) {
        // The merged op keeps the inverse of the first one.
        out[out.length - 1] = { op: merged, inverse: last.inverse, transient: false };
      } else {
        out.push(step);
      }
    }
    return out;
  }

  /**
   * Merges the step into the directly preceding one when both are logged, of one type and the
   * handler can merge them (ADR 0025): abort then reverts a long drag with one inverse.
   * A transient step in between interrupts merging, so the inverses keep their order.
   */
  function remember(step: Step): void {
    const last = steps[steps.length - 1];
    const merged =
      last !== undefined && !last.transient && !step.transient && last.op.type === step.op.type
        ? (handlers.find(step.op.type)?.merge?.(last.op, step.op) ?? null)
        : null;
    if (last !== undefined && merged !== null) {
      // The merged op keeps the inverse of the first one.
      steps[steps.length - 1] = { op: merged, inverse: last.inverse, transient: false };
    } else {
      steps.push(step);
    }
  }

  function applyStep(op: Operation, transient: boolean): void {
    // A failing handler throws here: the transaction stays open and unchanged.
    const { inverse, deferred } = deps.apply(op);
    remember({ op, inverse, transient });
    const errors = [...deferred];
    collect(errors, () => {
      deps.emitApplied(null, op);
    });
    throwCollected(errors, 'Subscribers failed after apply');
  }

  /**
   * Applies the inverses of `toRevert` in reverse order (each emits `applied` with entry null).
   * A failing inverse handler is a programmer error: the rest is skipped and the error collected.
   */
  function revert(toRevert: readonly Step[], errors: unknown[]): void {
    for (const step of [...toRevert].reverse()) {
      try {
        errors.push(...deps.apply(step.inverse).deferred);
      } catch (e) {
        // Should not happen (an inverse of an applied op is valid): give up and report.
        errors.push(e);
        break;
      }
      collect(errors, () => {
        deps.emitApplied(null, step.inverse);
      });
    }
  }

  return {
    label,
    apply(op) {
      checkOpen('apply');
      applyStep(op, false);
    },
    applyTransient(op) {
      checkOpen('applyTransient');
      applyStep(op, true);
    },
    commit() {
      checkOpen('commit');
      // Order (spec 04): append -> end of transaction -> `applied`. Every exception is collected
      // and thrown at the end, so none overwrites another and the entry is never lost.
      const errors: unknown[] = [];
      // Transient steps go back first; the logged ones commute with them (caller's contract).
      revert(
        steps.filter((s) => s.transient),
        errors,
      );
      let written: { entry: LogEntry; op: Operation } | null = null;
      try {
        const planned = plan();
        if (planned !== null) {
          written = { entry: deps.append(planned.base, errors), op: planned.op };
        }
      } catch (e) {
        errors.push(e);
      }
      collect(errors, finish);
      if (written !== null) {
        const { entry, op } = written;
        collect(errors, () => {
          deps.emitApplied(entry, op);
        });
      }
      throwCollected(errors, 'Subscribers failed during commit');
      return written?.entry ?? null;
    },
    abort() {
      checkOpen('abort');
      const errors: unknown[] = [];
      revert(steps, errors);
      collect(errors, finish);
      throwCollected(errors, 'Subscribers failed during abort');
    },
  };
}
