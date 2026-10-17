import type { Disposable, Subscribable } from '@/core';
import type { Operation } from './operation';

// The synchronous ports of the in-memory double before M52 (spec 04, N121), kept only until the
// double goes (M52 task 3): the transitional anOpsSession adapts them to the ports of ports.ts.

export interface LogEntry {
  /** 1, 2, 3, … within a document. */
  readonly seq: number;
  readonly kind: 'do' | 'undo' | 'redo';
  /** For undo/redo: seq of the original 'do' entry. */
  readonly target?: number;
  /** Exactly what was applied. */
  readonly op: Operation;
  readonly inverse: Operation;
  /** Shown in the history. */
  readonly label: string;
  /** ms since epoch, metadata only. */
  readonly time: number;
}

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
    /**
     * After every application: dispatch and commit (entry); Transaction.apply, applyTransient,
     * reverting transient steps on commit and abort (entry null).
     */
    applied: { entry: LogEntry | null; op: Operation };
    /** A transaction started (true) or ended by commit or abort (false). */
    transaction: { active: boolean };
  }>;
}

export interface Transaction {
  readonly label: string;
  /** Applies at once and remembers the op with its inverse. */
  apply(op: Operation): void;
  /** Applies at once; reverted on both commit and abort, never logged (spec 04, Q018). */
  applyTransient(op: Operation): void;
  /** Writes one entry; an empty transaction writes nothing and returns null. */
  commit(): LogEntry | null;
  /** Applies the inverses in reverse order, writes nothing. */
  abort(): void;
}

export interface UndoManager extends Disposable {
  /** The undo stack is not empty and no transaction is running. */
  canUndo(): boolean;
  canRedo(): boolean;
  /** Current stacks (seq of the original 'do' entries, top at the end). Copies. */
  stacks(): { readonly undo: readonly number[]; readonly redo: readonly number[] };
  /** Takes the top of the undo stack and dispatches its inverse as an 'undo' entry. */
  undo(): void;
  /** Takes the top of the redo stack and dispatches its op again as a 'redo' entry. */
  redo(): void;
  /** Emitted only when the pair (canUndo, canRedo) changes. */
  readonly events: Subscribable<{ changed: { canUndo: boolean; canRedo: boolean } }>;
}
