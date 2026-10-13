import { assert, Emitter } from '@/core';
import type { Subscribable } from '@/core';
import type { DocumentWriter } from '@/document';
import { applyOperation } from './apply';
import type { ApplyResult } from './apply';
import type { LogEntry, OperationLog } from './log';
import type { OpHandlerRegistry } from './op-handler';
import type { Operation } from './operation';
import { throwCollected } from './errors';
import { createTransaction } from './transaction';
import type { Transaction } from './transaction';

export interface DispatchMeta {
  /** Default: op.type. */
  readonly label?: string;
  /** Default 'do'. 'undo' and 'redo' are used by UndoManager. */
  readonly kind?: 'do' | 'undo' | 'redo';
  /** Required exactly for 'undo' and 'redo': seq of an existing 'do' entry. */
  readonly target?: number;
}

export interface OperationDispatcher {
  /** Applies the operation and writes it to the log as a separate entry. */
  dispatch(op: Operation, meta?: DispatchMeta): LogEntry;
  /** Starts a transaction. Only one at a time; a second begin throws. */
  begin(label: string): Transaction;
  readonly inTransaction: boolean;
  readonly events: Subscribable<{
    /** After every application: dispatch (entry), Transaction.apply and abort (entry null). */
    applied: { entry: LogEntry | null; op: Operation };
    /** A transaction started (true) or ended by commit or abort (false). */
    transaction: { active: boolean };
  }>;
}

export function createOperationDispatcher(deps: {
  doc: DocumentWriter;
  handlers: OpHandlerRegistry;
  log: OperationLog;
  /** Time source for LogEntry.time. Default Date.now. */
  now?: () => number;
}): OperationDispatcher {
  const { doc, handlers, log } = deps;
  const now = deps.now ?? Date.now;
  const emitter = new Emitter<{
    applied: { entry: LogEntry | null; op: Operation };
    transaction: { active: boolean };
  }>();
  let active = false;
  let applying = false;

  function checkMeta(kind: 'do' | 'undo' | 'redo', target: number | undefined): void {
    if (kind === 'do') {
      assert(target === undefined, "dispatch: 'target' is only allowed for kind 'undo' and 'redo'");
      return;
    }
    assert(target !== undefined, `dispatch: kind '${kind}' requires 'target'`);
    const found = log.entries(target)[0];
    assert(
      found !== undefined && found.seq === target,
      `dispatch: target ${String(target)} is not an existing log entry`,
    );
    assert(found.kind === 'do', `dispatch: target ${String(target)} is not a 'do' entry`);
  }

  /**
   * Appends the entry; shared by dispatch and commit so they cannot drift. The document has
   * already changed, so the entry is written whatever the subscribers do: an exception of an
   * `appended` subscriber is pushed to `errors` and the caller throws it at the end.
   */
  function append(base: Omit<LogEntry, 'seq'>, errors: unknown[]): LogEntry {
    const seqBefore = log.lastSeq;
    let entry: LogEntry | undefined;
    try {
      entry = log.append(base);
    } catch (e) {
      // A subscriber of `appended` threw: the entry is already in the log.
      // If it is not, append itself failed and there is nothing to preserve.
      if (log.lastSeq === seqBefore) throw e;
      errors.push(e);
      entry = log.entries(log.lastSeq)[0];
    }
    assert(entry !== undefined, 'dispatch: the entry was not appended');
    return entry;
  }

  function assertNotApplying(what: string): void {
    assert(!applying, `${what}: not allowed while an operation is being applied (reentrance)`);
  }

  /** The only way to applyOperation: raises the reentrance flag for its duration (spec 04). */
  function applyGuarded(op: Operation): ApplyResult {
    assertNotApplying('apply');
    applying = true;
    try {
      return applyOperation(doc, handlers, op);
    } finally {
      applying = false;
    }
  }

  return {
    get inTransaction(): boolean {
      return active;
    },
    begin(label) {
      assertNotApplying('begin');
      assert(!active, 'begin: a transaction is already running');
      active = true;
      const transaction = createTransaction({
        handlers,
        label,
        apply: applyGuarded,
        assertIdle: (what) => {
          assertNotApplying(what);
        },
        append,
        emitApplied: (entry, op) => {
          emitter.emit('applied', { entry, op });
        },
        end: () => {
          active = false;
          emitter.emit('transaction', { active: false });
        },
        now,
      });
      try {
        emitter.emit('transaction', { active: true });
      } catch (e) {
        // begin is atomic: no transaction is created, subscribers get the closing event.
        active = false;
        const errors = [e];
        try {
          emitter.emit('transaction', { active: false });
        } catch (e2) {
          errors.push(e2);
        }
        throwCollected(errors, 'Subscribers failed during begin');
      }
      return transaction;
    },
    // Only on/once, not the Emitter itself: a cast back to Emitter must not give emit.
    events: {
      on: (type, fn) => emitter.on(type, fn),
      once: (type, fn) => emitter.once(type, fn),
    },
    dispatch(op, meta = {}) {
      assertNotApplying('dispatch');
      assert(!active, 'dispatch: a transaction is running, use it instead');
      const kind = meta.kind ?? 'do';
      checkMeta(kind, meta.target);

      // Step 2: throws straight away when the handler fails; nothing is written.
      const { inverse, deferred } = applyGuarded(op);
      const errors: unknown[] = [...deferred];

      // From here the document has changed, so the entry must be written whatever happens.
      const base = { kind, op, inverse, label: meta.label ?? op.type, time: now() };
      const entry = append(
        meta.target === undefined ? base : { ...base, target: meta.target },
        errors,
      );
      try {
        emitter.emit('applied', { entry, op });
      } catch (e) {
        errors.push(e);
      }
      throwCollected(errors, 'Subscribers failed after dispatch');
      return entry;
    },
  };
}
