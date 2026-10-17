// OperationDispatcher, Transaction and UndoManager over a RemoteSession (N63–N65): every change is
// applied at once to the mirror of the document with the TS handlers of ops and sent to the core;
// every answer rebuilds the mirror as the document of the server plus the changes not confirmed
// yet. Undo and redo wait for the answer (N64).
//
// The mirror is always base + pending (+ the local sketch layer of N65):
// - base: the document of the last read model taken over (an answer, or a read model of the
//   session while nothing is pending),
// - pending: the changes sent and not answered yet, in the order of the queue of the session;
//   each knows how to apply itself again on top of a new base (replay),
// - layer: setParams of a sketch the server refused with SKETCH_NOT_SOLVED (Q103), shown until
//   the server takes another setParams of that feature or the transaction ends.

import { assert, DisposableStore, Emitter } from '@/core';
import type { Disposable, Subscribable } from '@/core';
import { createDocument } from '@/document';
import type { DocumentWriter, FeatureId } from '@/document';
import { createOperationDispatcher, createOperationLog, OP_VERSION } from '@/ops';
import type {
  BatchOp,
  DispatchMeta,
  FeatureSetParamsOp,
  LogEntry,
  OpHandlerRegistry,
  Operation,
  OperationDispatcher,
  Transaction,
  UndoManager,
} from '@/ops';
import { RemoteError } from '@/remote';
import type {
  ChangeOutcome,
  ChangeRequest,
  HistoryData,
  ReadModelData,
  RemoteSession,
} from '@/remote';
import type { MirrorDocument } from './mirror-document';

export interface RemoteDispatcherDeps {
  readonly mirror: MirrorDocument;
  readonly session: RemoteSession;
  readonly handlers: OpHandlerRegistry;
  /** Time source of the provisional LogEntry.time. */
  readonly now: () => number;
  /** A change the server refused (dropped from the mirror), or one that no longer applies. */
  readonly onError: (error: RemoteError) => void;
  /** The open transaction ended on the server (RemoteSession `lost`). */
  readonly onLost: () => void;
}

export function createRemoteDispatcher(
  deps: RemoteDispatcherDeps,
): OperationDispatcher & { readonly undo: UndoManager } {
  return new RemoteDispatcher(deps);
}

type DispatcherEvents = {
  applied: { entry: LogEntry | null; op: Operation };
  transaction: { active: boolean };
};

type Stacks = HistoryData['stacks'];

interface Applied {
  readonly inverse: Operation;
  /** Exceptions of document subscribers thrown after the document changed. */
  readonly deferred: readonly unknown[];
}

/**
 * Applies one operation to `doc` with the handlers, exactly as ops applies it (validation, batch
 * inverses, restoring the rollback bar), and returns its inverse. applyOperation is internal to
 * ops, so a dispatcher over a throwaway log does it: it writes its entry exactly when the document
 * changed, which tells a failing handler (throws, nothing changed) from a throwing subscriber
 * (the operation holds, the exception is deferred).
 */
function applyLocally(doc: DocumentWriter, handlers: OpHandlerRegistry, op: Operation): Applied {
  const log = createOperationLog();
  const once = createOperationDispatcher({ doc, handlers, log, now: () => 0 });
  try {
    return { inverse: once.dispatch(op).inverse, deferred: [] };
  } catch (e) {
    const entry = log.entries()[0];
    if (entry === undefined) throw e;
    return { inverse: entry.inverse, deferred: [e] };
  }
}

/** Throws what was collected: one error as is, more as AggregateError. */
function throwCollected(errors: readonly unknown[], message: string): void {
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, message);
}

function collect(errors: unknown[], fn: () => void): void {
  try {
    fn();
  } catch (e) {
    errors.push(e);
  }
}

function isSetParams(op: Operation): op is FeatureSetParamsOp {
  return op.type === 'feature.setParams';
}

/** The operation of a change request, if it carries one. */
function opOf(request: ChangeRequest): Operation | null {
  switch (request.kind) {
    case 'dispatch':
    case 'apply':
    case 'applyTransient':
      return request.op;
    default:
      return null;
  }
}

/** The feature of a setParams carried by the request, otherwise null. */
function setParamsTarget(request: ChangeRequest): FeatureId | null {
  const op = opOf(request);
  return op !== null && isSetParams(op) ? op.featureId : null;
}

/** A step of a local transaction with its inverse (as ops/transaction.ts remembers them). */
interface Step {
  readonly op: Operation;
  readonly inverse: Operation;
  /** Reverted on commit too. */
  readonly transient: boolean;
}

/** A change sent to the session and not answered yet. */
interface Pending {
  /** Position in the queue: later changes have a higher order. */
  readonly order: number;
  readonly request: ChangeRequest;
  /** The transaction the change belongs to (begin, its steps, commit, abort); null otherwise. */
  readonly tx: LocalTransaction | null;
  /** The step of apply/applyTransient, removed from the transaction when the change is dropped. */
  readonly step: Step | null;
  /** Applies the change again on top of a new base; throws when it no longer applies. */
  replay(doc: DocumentWriter): void;
}

/** What LocalTransaction needs of the dispatcher. */
interface TransactionHost {
  step(tx: LocalTransaction, op: Operation, transient: boolean): void;
  commit(tx: LocalTransaction): LogEntry | null;
  abort(tx: LocalTransaction): void;
}

/**
 * The transaction as interaction sees it: synchronous over the mirror. After `lost` (the
 * transaction died on the server) every further call is a no-op.
 */
class LocalTransaction implements Transaction {
  readonly steps: Step[] = [];
  readonly label: string;
  private readonly host: TransactionHost;
  private state: 'open' | 'ended' | 'lost' = 'open';

  constructor(label: string, host: TransactionHost) {
    this.label = label;
    this.host = host;
  }

  apply(op: Operation): void {
    if (this.checkOpen('apply')) this.host.step(this, op, false);
  }

  applyTransient(op: Operation): void {
    if (this.checkOpen('applyTransient')) this.host.step(this, op, true);
  }

  commit(): LogEntry | null {
    if (!this.checkOpen('commit')) return null;
    this.state = 'ended';
    return this.host.commit(this);
  }

  abort(): void {
    if (!this.checkOpen('abort')) return;
    this.state = 'ended';
    this.host.abort(this);
  }

  /** The transaction died on the server: it ends without an RPC. */
  markLost(): void {
    this.state = 'lost';
  }

  /** false after `lost` (a no-op); throws after commit or abort (programmer error, as in ops). */
  private checkOpen(what: string): boolean {
    if (this.state === 'lost') return false;
    assert(this.state === 'open', `Transaction '${this.label}' has ended: cannot ${what}`);
    return true;
  }
}

class RemoteDispatcher implements OperationDispatcher {
  private readonly emitter = new Emitter<DispatcherEvents>();
  readonly events: Subscribable<DispatcherEvents> = this.emitter.asSubscribable();
  readonly undo: UndoManager;

  private readonly mirror: MirrorDocument;
  private readonly session: RemoteSession;
  private readonly handlers: OpHandlerRegistry;
  private readonly deps: RemoteDispatcherDeps;
  private readonly subscriptions = new DisposableStore();
  private readonly undoEmitter = new Emitter<{
    changed: { canUndo: boolean; canRedo: boolean };
  }>();

  private pending: Pending[] = [];
  private order = 0;
  /** Every read model received gets a stamp: a higher stamp is a newer read model. */
  private stamp = 0;
  private base: ReadModelData['document'];
  private baseStamp = 0;
  /** The last read model received by any path: canUndo, canRedo and the last known seq. */
  private latest: ReadModelData;
  /** A read model of the session that arrived while changes were pending (taken when drained). */
  private deferred: { readonly model: ReadModelData; readonly stamp: number } | null = null;
  private tx: LocalTransaction | null = null;
  private readonly layer = new Map<FeatureId, { readonly op: Operation; readonly order: number }>();
  private applying = false;
  private lastIssuedSeq = 0;
  private flags: { canUndo: boolean; canRedo: boolean };
  private undoStacks: Stacks = { undo: [], redo: [] };
  /** lastSeq the stacks were last requested for. */
  private stacksSeq = Number.NaN;
  private disposed = false;

  constructor(deps: RemoteDispatcherDeps) {
    this.deps = deps;
    this.mirror = deps.mirror;
    this.session = deps.session;
    this.handlers = deps.handlers;
    this.latest = deps.session.readModel.get();
    this.base = this.latest.document;
    this.flags = this.currentFlags();
    this.undo = this.createUndo();
    this.subscriptions.add(
      deps.session.readModel.subscribe(() => {
        this.observe(this.session.readModel.get());
      }),
    );
    this.subscriptions.add(
      deps.session.events.on('lost', () => {
        this.lose();
      }),
    );
    this.rebuild();
    this.refreshStacks();
  }

  get inTransaction(): boolean {
    return this.tx !== null;
  }

  dispatch(op: Operation, meta: DispatchMeta = {}): LogEntry {
    this.assertIdle('dispatch');
    assert(this.tx === null, 'dispatch: a transaction is running, use it instead');
    assert(
      (meta.kind ?? 'do') === 'do' && meta.target === undefined,
      'dispatch: undo and redo of the remote session go through undo',
    );
    // Throws straight away when the handler fails: nothing is sent.
    const { inverse, deferred } = this.applyOnMirror(op);
    const request: ChangeRequest =
      meta.label === undefined
        ? { kind: 'dispatch', op }
        : { kind: 'dispatch', op, label: meta.label };
    this.enqueue(request, null, null, (doc) => {
      applyLocally(doc, this.handlers, op);
    });
    const entry = this.provisional(op, inverse, meta.label ?? op.type);
    const errors = [...deferred];
    collect(errors, () => {
      this.emitter.emit('applied', { entry, op });
    });
    throwCollected(errors, 'Subscribers failed after dispatch');
    return entry;
  }

  begin(label: string): Transaction {
    this.assertIdle('begin');
    assert(this.tx === null, 'begin: a transaction is already running');
    const tx = new LocalTransaction(label, {
      step: (t, op, transient) => {
        this.step(t, op, transient);
      },
      commit: (t) => this.commit(t),
      abort: (t) => {
        this.abort(t);
      },
    });
    this.tx = tx;
    this.enqueue({ kind: 'begin', label }, tx, null, () => undefined);
    const errors: unknown[] = [];
    collect(errors, () => {
      this.emitter.emit('transaction', { active: true });
    });
    collect(errors, () => {
      this.notifyFlags();
    });
    throwCollected(errors, 'Subscribers failed during begin');
    return tx;
  }

  // --- transactions ---

  private step(tx: LocalTransaction, op: Operation, transient: boolean): void {
    this.assertIdle(transient ? 'applyTransient' : 'apply');
    // A failing handler throws here: the transaction stays open and unchanged, nothing is sent.
    const { inverse, deferred } = this.applyOnMirror(op);
    const step: Step = { op, inverse, transient };
    tx.steps.push(step);
    this.enqueue({ kind: transient ? 'applyTransient' : 'apply', op }, tx, step, (doc) => {
      applyLocally(doc, this.handlers, op);
    });
    const errors = [...deferred];
    collect(errors, () => {
      this.emitter.emit('applied', { entry: null, op });
    });
    throwCollected(errors, 'Subscribers failed after apply');
  }

  private commit(tx: LocalTransaction): LogEntry | null {
    this.assertIdle('commit');
    // The transient steps go back at once (the replay reverts them on every new base too).
    this.enqueue({ kind: 'commit' }, tx, null, (doc) => {
      this.revert(
        doc,
        tx.steps.filter((s) => s.transient),
      );
    });
    const logged = tx.steps.filter((s) => !s.transient);
    const written = this.entryOf(tx.label, logged);
    const reverted = tx.steps.filter((s) => s.transient);
    const errors: unknown[] = [];
    this.end(errors);
    for (const s of [...reverted].reverse()) {
      collect(errors, () => {
        this.emitter.emit('applied', { entry: null, op: s.inverse });
      });
    }
    if (written !== null) {
      collect(errors, () => {
        this.emitter.emit('applied', { entry: written, op: written.op });
      });
    }
    throwCollected(errors, 'Subscribers failed during commit');
    return written;
  }

  private abort(tx: LocalTransaction): void {
    this.assertIdle('abort');
    this.enqueue({ kind: 'abort' }, tx, null, (doc) => {
      this.revert(doc, tx.steps);
    });
    const reverted = [...tx.steps].reverse();
    const errors: unknown[] = [];
    this.end(errors);
    for (const s of reverted) {
      collect(errors, () => {
        this.emitter.emit('applied', { entry: null, op: s.inverse });
      });
    }
    throwCollected(errors, 'Subscribers failed during abort');
  }

  /** Ends the local transaction: the sketch layer goes (N65), the mirror is rebuilt. */
  private end(errors: unknown[]): void {
    this.tx = null;
    this.layer.clear();
    collect(errors, () => {
      this.rebuild();
    });
    collect(errors, () => {
      this.emitter.emit('transaction', { active: false });
    });
    collect(errors, () => {
      this.notifyFlags();
    });
  }

  private revert(doc: DocumentWriter, steps: readonly Step[]): void {
    for (const s of [...steps].reverse()) applyLocally(doc, this.handlers, s.inverse);
  }

  /** The provisional entry of a commit, or null for an empty transaction (as ops/transaction). */
  private entryOf(label: string, logged: readonly Step[]): LogEntry | null {
    const [only] = logged;
    if (only === undefined) return null;
    if (logged.length === 1) return this.provisional(only.op, only.inverse, label);
    const op: BatchOp = { type: 'batch', v: OP_VERSION.batch, ops: logged.map((s) => s.op) };
    const inverse: BatchOp = {
      type: 'batch',
      v: OP_VERSION.batch,
      ops: logged.map((s) => s.inverse).reverse(),
    };
    return this.provisional(op, inverse, label);
  }

  /** seq = the last known + 1; nobody uses it today, the server writes the real entry. */
  private provisional(op: Operation, inverse: Operation, label: string): LogEntry {
    this.lastIssuedSeq = Math.max(this.lastIssuedSeq, this.latest.document.lastSeq) + 1;
    return Object.freeze({
      seq: this.lastIssuedSeq,
      kind: 'do',
      op,
      inverse,
      label,
      time: this.deps.now(),
    });
  }

  // --- the queue and the answers ---

  private enqueue(
    request: ChangeRequest,
    tx: LocalTransaction | null,
    step: Step | null,
    replay: (doc: DocumentWriter) => void,
  ): void {
    const item: Pending = { order: ++this.order, request, tx, step, replay };
    this.pending.push(item);
    this.session.change(request).then(
      (outcome) => {
        this.settle(item, outcome);
      },
      () => undefined, // rejects only after dispose of the session
    );
  }

  private settle(item: Pending, outcome: ChangeOutcome): void {
    if (this.disposed) return;
    // A confirmed step stays in its transaction (commit and abort still revert it); a refused one
    // goes, as it never reached the document of the server.
    const known = this.remove(item, !outcome.ok);
    if (outcome.ok) {
      const target = setParamsTarget(item.request);
      const layered = target === null ? undefined : this.layer.get(target);
      if (target !== null && layered !== undefined && layered.order < item.order) {
        this.layer.delete(target);
      }
      this.receive(outcome.readModel);
      this.base = outcome.readModel.document;
      this.baseStamp = this.stamp;
    } else if (known) {
      const op = opOf(item.request);
      if (outcome.error.reason === 'SKETCH_NOT_SOLVED' && op !== null && isSetParams(op)) {
        const layered = this.layer.get(op.featureId);
        if (layered === undefined || layered.order < item.order) {
          this.layer.set(op.featureId, { op, order: item.order });
        }
      }
    }
    this.rebuild();
    this.adoptDeferredIfDrained();
    this.notifyFlags();
    this.refreshStacks();
    if (!outcome.ok && known) this.deps.onError(outcome.error);
  }

  /** A read model of the session (an answer, a refresh, an event of another tab, a new session). */
  private observe(model: ReadModelData): void {
    if (this.disposed || model === this.latest) return;
    this.receive(model);
    if (this.pending.length === 0) {
      this.base = model.document;
      this.baseStamp = this.stamp;
      this.rebuild();
    } else {
      this.deferred = { model, stamp: this.stamp };
    }
    this.notifyFlags();
    this.refreshStacks();
  }

  private receive(model: ReadModelData): void {
    this.stamp += 1;
    this.latest = model;
  }

  /** A read model deferred while changes were pending, when it is newer than the base. */
  private adoptDeferredIfDrained(): void {
    if (this.pending.length > 0 || this.deferred === null) return;
    const { model, stamp } = this.deferred;
    this.deferred = null;
    if (stamp <= this.baseStamp) return;
    this.base = model.document;
    this.baseStamp = stamp;
    this.rebuild();
  }

  /** The open transaction died on the server: it ends locally without an RPC (spec 14). */
  private lose(): void {
    if (this.disposed) return;
    this.pending = this.pending.filter((item) => item.tx === null);
    const tx = this.tx;
    const errors: unknown[] = [];
    if (tx !== null) {
      tx.markLost();
      this.end(errors);
    } else {
      this.layer.clear();
      collect(errors, () => {
        this.rebuild();
      });
    }
    collect(errors, () => {
      this.adoptDeferredIfDrained();
    });
    collect(errors, () => {
      this.deps.onLost();
    });
    throwCollected(errors, 'Subscribers failed after a lost transaction');
  }

  /**
   * Removes the item from pending, with its step from the transaction when `dropStep`; false when
   * it is no longer there (dropped earlier).
   */
  private remove(item: Pending, dropStep: boolean): boolean {
    const index = this.pending.indexOf(item);
    if (index === -1) return false;
    this.pending.splice(index, 1);
    if (dropStep && item.tx !== null && item.step !== null) {
      const at = item.tx.steps.indexOf(item.step);
      if (at !== -1) item.tx.steps.splice(at, 1);
    }
    return true;
  }

  /**
   * mirror = base + pending + layer, built on a document of its own, so the mirror changes once.
   * A pending change that no longer applies is dropped and reported; a layered sketch whose
   * feature has a newer setParams pending is not shown (the newer one is).
   */
  private rebuild(): void {
    const base = this.base;
    const doc = createDocument({
      meta: { id: base.id, name: base.name, createdAt: this.mirror.meta.createdAt },
      studio: base.studio,
    });
    for (const item of [...this.pending]) {
      try {
        item.replay(doc);
      } catch (e) {
        this.remove(item, true);
        this.deps.onError(
          new RemoteError({
            code: 'FAILED_PRECONDITION',
            reason: 'INVALID_OPERATION',
            message: `A change not confirmed yet no longer applies: ${String(e)}`,
            cause: e,
          }),
        );
      }
    }
    for (const [featureId, layered] of [...this.layer]) {
      if (this.pending.some((item) => setParamsTarget(item.request) === featureId)) continue;
      try {
        applyLocally(doc, this.handlers, layered.op);
      } catch {
        this.layer.delete(featureId);
      }
    }
    this.mirror.reset({ ...base, name: doc.meta.name, studio: doc.studio });
  }

  private applyOnMirror(op: Operation): Applied {
    this.applying = true;
    try {
      return applyLocally(this.mirror.writer(), this.handlers, op);
    } finally {
      this.applying = false;
    }
  }

  private assertIdle(what: string): void {
    assert(!this.applying, `${what}: not allowed while an operation is being applied (reentrance)`);
  }

  // --- undo ---

  private currentFlags(): { canUndo: boolean; canRedo: boolean } {
    const { canUndo, canRedo } = this.latest.session;
    return { canUndo: canUndo && this.tx === null, canRedo: canRedo && this.tx === null };
  }

  private notifyFlags(): void {
    const next = this.currentFlags();
    if (next.canUndo === this.flags.canUndo && next.canRedo === this.flags.canRedo) return;
    this.flags = next;
    this.undoEmitter.emit('changed', next);
  }

  /** The stacks come from GetHistory, asked again when the log has a new last entry. */
  private refreshStacks(): void {
    const seq = this.latest.document.lastSeq;
    if (seq === this.stacksSeq) return;
    this.stacksSeq = seq;
    // From after the last entry: only the stacks, no entries.
    this.session.history(seq + 1).then(
      (data) => {
        if (!this.disposed && this.stacksSeq === seq) this.undoStacks = data.stacks;
      },
      () => {
        if (this.stacksSeq === seq) this.stacksSeq = Number.NaN;
      },
    );
  }

  private createUndo(): UndoManager {
    const request = (kind: 'undo' | 'redo'): void => {
      this.assertIdle(kind);
      // Not optimistic (N64): the mirror changes with the answer.
      this.enqueue({ kind }, null, null, () => undefined);
    };
    const dispose: Disposable['dispose'] = () => {
      this.disposed = true;
      this.subscriptions.dispose();
    };
    return {
      canUndo: () => this.currentFlags().canUndo,
      canRedo: () => this.currentFlags().canRedo,
      stacks: () => ({ undo: [...this.undoStacks.undo], redo: [...this.undoStacks.redo] }),
      undo: () => {
        assert(this.currentFlags().canUndo, 'undo: nothing to undo');
        request('undo');
      },
      redo: () => {
        assert(this.currentFlags().canRedo, 'redo: nothing to redo');
        request('redo');
      },
      events: this.undoEmitter.asSubscribable(),
      dispose,
    };
  }
}
