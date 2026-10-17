// OperationDispatcher, Transaction and UndoManager over a RemoteSession (ADR 0031, N163, N167):
// every change only goes to the session; nothing is applied locally. The document changes when
// the session publishes the read model of the answer, before the promise of the change resolves
// (app/remote-session.ts follows the read model before this dispatcher exists, N165). A refusal
// of the server goes to onError; a transaction that died on the server ends here without an RPC
// and onLost closes the dialog.

import { assert, DisposableStore, Emitter } from '@/core';
import type { Disposable } from '@/core';
import type { DispatchMeta, Operation, OperationDispatcher, Transaction, UndoManager } from '@/ops';
import type { ChangeOutcome, ChangeRequest, RemoteError, RemoteSession } from '@/remote';

export interface RemoteDispatcherDeps {
  readonly session: Pick<RemoteSession, 'readModel' | 'events' | 'change'>;
  /** A refused change (RemoteError): app → connection.changeDropped + noticeOfRefusal. Once per error object. */
  readonly onError: (error: Error) => void;
  /** The transaction ended on the server (event lost, a refused begin, NO_TRANSACTION of a step). */
  readonly onLost: () => void;
}

export type RemoteDispatcherHandle = OperationDispatcher &
  Disposable & {
    /** Its dispose does nothing: the dispatcher owns the subscriptions (dispose above). */
    readonly undo: UndoManager;
  };

export function createRemoteDispatcher(deps: RemoteDispatcherDeps): RemoteDispatcherHandle {
  return new RemoteDispatcher(deps);
}

type Flags = { canUndo: boolean; canRedo: boolean };

/** What RemoteTransaction needs of the dispatcher. */
interface TransactionHost {
  step(tx: RemoteTransaction, request: ChangeRequest): Promise<boolean>;
  commit(tx: RemoteTransaction): Promise<boolean>;
  abort(tx: RemoteTransaction): Promise<boolean>;
}

/**
 * The transaction as interaction sees it. Ended by commit or abort: a further call throws
 * (programmer error). Lost on the server: a further call is a no-op resolving false.
 */
class RemoteTransaction implements Transaction {
  readonly label: string;
  private readonly host: TransactionHost;
  private state: 'open' | 'ended' | 'lost' = 'open';

  constructor(label: string, host: TransactionHost) {
    this.label = label;
    this.host = host;
  }

  get lost(): boolean {
    return this.state === 'lost';
  }

  apply(op: Operation): Promise<boolean> {
    if (!this.checkOpen('apply')) return Promise.resolve(false);
    return this.host.step(this, { kind: 'apply', op });
  }

  applyTransient(op: Operation): Promise<boolean> {
    if (!this.checkOpen('applyTransient')) return Promise.resolve(false);
    return this.host.step(this, { kind: 'applyTransient', op });
  }

  commit(): Promise<boolean> {
    if (!this.checkOpen('commit')) return Promise.resolve(false);
    this.state = 'ended';
    return this.host.commit(this);
  }

  abort(): Promise<boolean> {
    if (!this.checkOpen('abort')) return Promise.resolve(false);
    this.state = 'ended';
    return this.host.abort(this);
  }

  /** The transaction died on the server: it ends without an RPC. */
  markLost(): void {
    this.state = 'lost';
  }

  /** false after a loss (a no-op); throws after commit or abort (programmer error). */
  private checkOpen(what: string): boolean {
    if (this.state === 'lost') return false;
    assert(this.state === 'open', `Transaction '${this.label}' has ended: cannot ${what}`);
    return true;
  }
}

class RemoteDispatcher implements OperationDispatcher, Disposable {
  readonly undo: UndoManager;
  private readonly session: RemoteDispatcherDeps['session'];
  private readonly deps: RemoteDispatcherDeps;
  private readonly subscriptions = new DisposableStore();
  private readonly undoEmitter = new Emitter<{ changed: Flags }>();
  private tx: RemoteTransaction | null = null;
  private flags: Flags;
  /** The error last handed to onError: the callers of a coalesced change share one outcome. */
  private lastReported: Error | null = null;
  private disposed = false;

  constructor(deps: RemoteDispatcherDeps) {
    this.deps = deps;
    this.session = deps.session;
    this.flags = this.currentFlags();
    this.undo = this.createUndo();
    this.subscriptions.add(
      deps.session.readModel.subscribe(() => {
        this.notifyFlags();
      }),
    );
    this.subscriptions.add(
      deps.session.events.on('lost', () => {
        if (this.tx !== null) this.lose(this.tx);
      }),
    );
  }

  get inTransaction(): boolean {
    return this.tx !== null;
  }

  /** Stops following the session; answers that arrive later resolve false without onError. */
  dispose(): void {
    this.disposed = true;
    this.subscriptions.dispose();
  }

  dispatch(op: Operation, meta: DispatchMeta = {}): Promise<boolean> {
    assert(this.tx === null, 'dispatch: a transaction is running, use it instead');
    const request: ChangeRequest =
      meta.label === undefined
        ? { kind: 'dispatch', op }
        : { kind: 'dispatch', op, label: meta.label };
    return this.send(request, (error) => {
      this.report(error);
    });
  }

  begin(label: string): Transaction {
    assert(this.tx === null, 'begin: a transaction is already running');
    const tx = new RemoteTransaction(label, {
      step: (t, request) => this.step(t, request),
      commit: (t) => this.commit(t),
      abort: (t) => this.abort(t),
    });
    this.tx = tx;
    void this.send({ kind: 'begin', label }, (error) => {
      this.report(error);
      this.lose(tx);
    });
    this.notifyFlags();
    return tx;
  }

  // --- transactions ---

  private step(tx: RemoteTransaction, request: ChangeRequest): Promise<boolean> {
    return this.send(request, (error) => {
      if (tx.lost) return;
      if (error.reason === 'NO_TRANSACTION') this.lose(tx);
      else this.report(error);
    });
  }

  private commit(tx: RemoteTransaction): Promise<boolean> {
    this.end(tx);
    return this.send({ kind: 'commit' }, (error) => {
      this.report(error);
      // N167: after a refused commit the server may keep the transaction open (STORAGE after
      // M51); without an abort the next begin would fail with TRANSACTION_OPEN.
      if (error.reason !== 'NO_TRANSACTION') void this.abortBestEffort();
    });
  }

  private abort(tx: RemoteTransaction): Promise<boolean> {
    this.end(tx);
    return this.send({ kind: 'abort' }, (error) => {
      if (error.reason !== 'NO_TRANSACTION') this.report(error);
    });
  }

  /** An abort after a refused commit; NO_TRANSACTION (the transaction is gone) is fine. */
  private abortBestEffort(): Promise<boolean> {
    return this.send({ kind: 'abort' }, (error) => {
      if (error.reason !== 'NO_TRANSACTION') this.report(error);
    });
  }

  /** Ends the local transaction at once (commit and abort go through the queue). */
  private end(tx: RemoteTransaction): void {
    if (this.tx !== tx) return;
    this.tx = null;
    this.notifyFlags();
  }

  /** The transaction died on the server: it ends locally without an RPC and onLost runs once. */
  private lose(tx: RemoteTransaction): void {
    if (this.disposed || tx.lost || this.tx !== tx) return;
    tx.markLost();
    this.end(tx);
    this.deps.onLost();
  }

  // --- sending ---

  /**
   * Sends the request; true when the server took it. `refused` handles a refusal of the server;
   * nothing is handled after dispose, and a rejection (only after dispose of the session) is false.
   */
  private async send(
    request: ChangeRequest,
    refused: (error: RemoteError) => void,
  ): Promise<boolean> {
    let outcome: ChangeOutcome;
    try {
      outcome = await this.session.change(request);
    } catch {
      return false;
    }
    if (this.disposed) return false;
    if (outcome.ok) return true;
    refused(outcome.error);
    return false;
  }

  /** onError once per error: both changes of a coalesced pair get the same outcome. */
  private report(error: Error): void {
    if (this.disposed || error === this.lastReported) return;
    this.lastReported = error;
    this.deps.onError(error);
  }

  // --- undo ---

  private currentFlags(): Flags {
    const { canUndo, canRedo } = this.session.readModel.get().session;
    return { canUndo: canUndo && this.tx === null, canRedo: canRedo && this.tx === null };
  }

  private notifyFlags(): void {
    if (this.disposed) return;
    const next = this.currentFlags();
    if (next.canUndo === this.flags.canUndo && next.canRedo === this.flags.canRedo) return;
    this.flags = next;
    this.undoEmitter.emit('changed', next);
  }

  private createUndo(): UndoManager {
    const request = (kind: 'undo' | 'redo'): Promise<boolean> =>
      this.send({ kind }, (error) => {
        this.report(error);
      });
    return {
      canUndo: () => this.currentFlags().canUndo,
      canRedo: () => this.currentFlags().canRedo,
      undo: () => {
        assert(this.currentFlags().canUndo, 'undo: nothing to undo');
        return request('undo');
      },
      redo: () => {
        assert(this.currentFlags().canRedo, 'redo: nothing to redo');
        return request('redo');
      },
      events: this.undoEmitter.asSubscribable(),
      // The dispatcher owns what the undo follows: RemoteDispatcher.dispose releases it.
      dispose: () => undefined,
    };
  }
}
