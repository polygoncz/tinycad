import type { Disposable, Subscribable } from '@/core';
import type { Operation } from './operation';

// The ports of dispatching, transactions and undo (spec 04, N163). The client implements them in
// app over the session of the server (app/remote-dispatcher.ts): it only sends, the document
// changes when the session publishes the read model of the answer. Tests use FakeOps
// (ops/testing.ts).

export interface DispatchMeta {
  /** Default: op.type. */
  readonly label?: string;
}

export interface OperationDispatcher {
  /**
   * Sends the operation as one log entry. true = the server took it (the document already shows
   * the read model of the answer), false = it refused (app shows the notice). Throws at once
   * during a transaction (programmer error).
   */
  dispatch(op: Operation, meta?: DispatchMeta): Promise<boolean>;
  /** Starts a transaction at once (BeginTransaction goes through the queue). Only one at a time. */
  begin(label: string): Transaction;
  readonly inTransaction: boolean;
}

export interface Transaction {
  readonly label: string;
  apply(op: Operation): Promise<boolean>;
  /** Reverted on the server on both commit and abort, never logged (spec 04, Q018). */
  applyTransient(op: Operation): Promise<boolean>;
  /** Ends the transaction at once (inTransaction = false); the server writes at most one entry. */
  commit(): Promise<boolean>;
  abort(): Promise<boolean>;
}

export interface UndoManager extends Disposable {
  /** The undo stack of the server is not empty and no transaction is running. */
  canUndo(): boolean;
  canRedo(): boolean;
  undo(): Promise<boolean>;
  redo(): Promise<boolean>;
  /** Emitted only when the pair (canUndo, canRedo) changes. */
  readonly events: Subscribable<{ changed: { canUndo: boolean; canRedo: boolean } }>;
}
