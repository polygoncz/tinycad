import { describe, expect, it } from 'vitest';
import { Emitter, ObservableValue } from '@/core';
import type { Observable, Subscribable } from '@/core';
import type { DocumentId, FeatureId, FeatureSchema } from '@/document';
import { aFeature } from '@/document/testing';
import { OP_VERSION } from '@/ops';
import type { DocumentRenameOp, FeatureSetParamsOp } from '@/ops';
import { RemoteError } from '@/remote';
import type {
  ChangeOutcome,
  ChangeRequest,
  ConnectionState,
  HistoryData,
  ReadModelData,
  RemoteErrorReason,
  RemoteSession,
  RemoteSessionEvents,
} from '@/remote';
import { createRemoteDispatcher } from '@/app/remote-dispatcher';
import { refuseChanges } from '@/app/read-only';

const fid = (id: string): FeatureId => id as FeatureId; // test ids are trusted

const setParams = (id: string, params: unknown): FeatureSetParamsOp => ({
  type: 'feature.setParams',
  v: OP_VERSION['feature.setParams'],
  featureId: fid(id),
  typeVersion: 1,
  params,
});

const rename = (name: string): DocumentRenameOp => ({
  type: 'document.rename',
  v: OP_VERSION['document.rename'],
  name,
});

interface ModelInit {
  readonly canUndo?: boolean;
  readonly canRedo?: boolean;
  readonly name?: string;
}

function aReadModel(init: ModelInit = {}): ReadModelData {
  const features = [aFeature({ id: 'f1' })];
  return {
    document: {
      id: 'doc-1' as DocumentId, // test ids are trusted
      name: init.name ?? 'Part',
      createdAt: 0,
      lastSeq: 0,
      studio: { features, rollbackIndex: features.length },
    },
    regen: {
      generation: 1,
      statuses: new Map(),
      final: { bodies: [], sketches: [], planes: [], axes: [] },
      input: null,
      anchors: new Map(),
      durationMs: 0,
    },
    session: {
      writable: true,
      canUndo: init.canUndo ?? false,
      canRedo: init.canRedo ?? false,
      transactionLabel: null,
    },
  };
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const refusal = (reason: RemoteErrorReason): RemoteError =>
  new RemoteError({ code: 'FAILED_PRECONDITION', reason, message: reason });

/**
 * A RemoteSession for tests: records every change and settles them oldest first when the test
 * says so. A successful answer sets the read model before the change resolves, as the session.
 */
class FakeRemoteSession implements RemoteSession {
  readonly featureTypes: readonly FeatureSchema[] = [];
  readonly model: ObservableValue<ReadModelData>;
  readonly readModel: Observable<ReadModelData>;
  readonly connection: Observable<ConnectionState> = new ObservableValue<ConnectionState>(
    'online',
  ).asObservable();
  readonly pending: Observable<number> = new ObservableValue(0).asObservable();
  private readonly emitter = new Emitter<RemoteSessionEvents>();
  readonly events: Subscribable<RemoteSessionEvents> = this.emitter.asSubscribable();
  /** Every change ever requested, oldest first. */
  readonly sent: ChangeRequest[] = [];
  private readonly open: {
    resolve: (outcome: ChangeOutcome) => void;
    reject: (e: unknown) => void;
  }[] = [];

  constructor(initial: ReadModelData) {
    this.model = new ObservableValue(initial);
    this.readModel = this.model.asObservable();
  }

  change(request: ChangeRequest): Promise<ChangeOutcome> {
    this.sent.push(request);
    return new Promise((resolve, reject) => {
      this.open.push({ resolve, reject });
    });
  }

  get unanswered(): number {
    return this.open.length;
  }

  kinds(): readonly string[] {
    return this.sent.map((r) => r.kind);
  }

  /** Answers the oldest change with the read model; resolves after the answer is handled. */
  answer(model: ReadModelData = this.model.get()): Promise<void> {
    const next = this.take();
    this.model.set(model);
    next.resolve({ ok: true, entry: null, readModel: model });
    return flush();
  }

  /** Refuses the oldest change. */
  refuse(reason: RemoteErrorReason): Promise<void> {
    this.take().resolve({ ok: false, error: refusal(reason) });
    return flush();
  }

  /** Refuses the `count` oldest changes with one outcome, as the queue answers a coalesced pair. */
  refuseAll(count: number, reason: RemoteErrorReason): Promise<void> {
    const outcome: ChangeOutcome = { ok: false, error: refusal(reason) };
    for (const next of this.open.splice(0, count)) next.resolve(outcome);
    return flush();
  }

  /** Rejects the oldest change, as the session does after its dispose. */
  reject(): Promise<void> {
    this.take().reject(new RemoteError({ code: 'CANCELLED', message: 'disposed' }));
    return flush();
  }

  /** The transaction died with a new session: its read model, then `lost`. */
  lose(): void {
    this.emitter.emit('lost', { what: 'transaction' });
  }

  refresh(): Promise<void> {
    return Promise.resolve();
  }

  history(): Promise<HistoryData> {
    return Promise.reject(new Error('not used by the dispatcher'));
  }

  exportStep(): Promise<{ readonly content: Uint8Array; readonly fileName: string }> {
    return Promise.resolve({ content: new Uint8Array(), fileName: 'part.step' });
  }

  close(): Promise<void> {
    return Promise.resolve();
  }

  dispose(): void {
    // nothing to release
  }

  private take(): { resolve: (outcome: ChangeOutcome) => void; reject: (e: unknown) => void } {
    const next = this.open.shift();
    if (next === undefined) throw new Error('nothing to answer');
    return next;
  }
}

function setup(init: ModelInit = {}) {
  const session = new FakeRemoteSession(aReadModel(init));
  const errors: Error[] = [];
  let lost = 0;
  const dispatcher = createRemoteDispatcher({
    session,
    onError: (e) => errors.push(e),
    onLost: () => lost++,
  });
  /** The settled value of a promise of the dispatcher, or 'pending'. */
  const track = (promise: Promise<boolean>) => {
    let result: boolean | 'pending' = 'pending';
    void promise.then((ok) => {
      result = ok;
    });
    return () => result;
  };
  return { session, dispatcher, errors, lost: () => lost, track };
}

const reasons = (errors: readonly Error[]): readonly string[] =>
  errors.map((e) => (e instanceof RemoteError ? e.reason : e.message));

describe('createRemoteDispatcher: dispatch', () => {
  it('sends the operation with its label and resolves true when the server takes it', async () => {
    const { session, dispatcher, track } = setup();
    const result = track(dispatcher.dispatch(rename('Bracket'), { label: 'doc.rename' }));
    expect(session.sent).toEqual([
      { kind: 'dispatch', op: rename('Bracket'), label: 'doc.rename' },
    ]);
    await flush();
    expect(result()).toBe('pending');
    await session.answer(aReadModel({ name: 'Bracket' }));
    expect(result()).toBe(true);
  });

  it('without a label sends none', () => {
    const { session, dispatcher } = setup();
    void dispatcher.dispatch(rename('Bracket'));
    expect(session.sent).toEqual([{ kind: 'dispatch', op: rename('Bracket') }]);
  });

  it('a refusal: onError with the error of the server, false', async () => {
    const { session, dispatcher, errors, track } = setup();
    const result = track(dispatcher.dispatch(rename('Bracket')));
    await session.refuse('INVALID_OPERATION');
    expect(result()).toBe(false);
    expect(reasons(errors)).toEqual(['INVALID_OPERATION']);
  });

  it('throws during a transaction and sends nothing', () => {
    const { session, dispatcher } = setup();
    dispatcher.begin('x');
    expect(() => dispatcher.dispatch(rename('Bracket'))).toThrow(/transaction is running/);
    expect(session.kinds()).toEqual(['begin']);
  });

  it('two applies of a transaction are both sent in order and each promise resolves', async () => {
    const { session, dispatcher, track } = setup();
    const tx = dispatcher.begin('feature.edit');
    const first = track(tx.apply(setParams('f1', { size: 2 })));
    const second = track(tx.apply(setParams('f1', { size: 3 })));
    expect(session.sent.slice(1)).toEqual([
      { kind: 'apply', op: setParams('f1', { size: 2 }) },
      { kind: 'apply', op: setParams('f1', { size: 3 }) },
    ]);
    await session.answer();
    await session.answer();
    await session.answer();
    expect([first(), second()]).toEqual([true, true]);
  });

  it('both changes of a coalesced pair refused: onError once', async () => {
    const { session, dispatcher, errors, track } = setup();
    const tx = dispatcher.begin('feature.edit');
    await session.answer();
    const first = track(tx.apply(setParams('f1', { size: 2 })));
    const second = track(tx.apply(setParams('f1', { size: 3 })));
    await session.refuseAll(2, 'INVALID_OPERATION');
    expect([first(), second()]).toEqual([false, false]);
    expect(errors).toHaveLength(1);
  });
});

describe('createRemoteDispatcher: transactions', () => {
  it('begin starts at once and sends BeginTransaction; a second begin throws', () => {
    const { session, dispatcher } = setup();
    const tx = dispatcher.begin('feature.edit');
    expect(tx.label).toBe('feature.edit');
    expect(dispatcher.inTransaction).toBe(true);
    expect(session.sent).toEqual([{ kind: 'begin', label: 'feature.edit' }]);
    expect(() => dispatcher.begin('y')).toThrow(/already running/);
  });

  it('a refused begin: onError and the transaction is lost (onLost, steps no-op)', async () => {
    const { session, dispatcher, errors, lost, track } = setup();
    const tx = dispatcher.begin('feature.edit');
    await session.refuse('TRANSACTION_OPEN');
    expect(reasons(errors)).toEqual(['TRANSACTION_OPEN']);
    expect(lost()).toBe(1);
    expect(dispatcher.inTransaction).toBe(false);
    const result = track(tx.apply(setParams('f1', { size: 2 })));
    await flush();
    expect(result()).toBe(false);
    expect(session.kinds()).toEqual(['begin']);
  });

  it('applyTransient sends ApplyTransient and resolves true when taken', async () => {
    const { session, dispatcher, track } = setup();
    const tx = dispatcher.begin('feature.edit');
    const op = setParams('f1', { size: 2 });
    const result = track(tx.applyTransient(op));
    expect(session.sent[1]).toEqual({ kind: 'applyTransient', op });
    await session.answer();
    await session.answer();
    expect(result()).toBe(true);
  });

  it('NO_TRANSACTION of a step: the transaction is lost, onLost once, no onError', async () => {
    const { session, dispatcher, errors, lost, track } = setup();
    const tx = dispatcher.begin('feature.edit');
    await session.answer();
    const first = track(tx.apply(setParams('f1', { size: 2 })));
    const second = track(tx.applyTransient(setParams('f1', { size: 3 })));
    await session.refuse('NO_TRANSACTION');
    await session.refuse('NO_TRANSACTION');
    expect([first(), second()]).toEqual([false, false]);
    expect(lost()).toBe(1);
    expect(errors).toEqual([]);
    expect(dispatcher.inTransaction).toBe(false);
    const commit = track(tx.commit());
    await flush();
    expect(commit()).toBe(false);
    expect(session.kinds()).toEqual(['begin', 'apply', 'applyTransient']);
  });

  it('another refusal of a step: onError, false, the transaction stays open', async () => {
    const { session, dispatcher, errors, lost, track } = setup();
    const tx = dispatcher.begin('feature.edit');
    await session.answer();
    const result = track(tx.apply(setParams('f1', { size: -1 })));
    await session.refuse('INVALID_OPERATION');
    expect(result()).toBe(false);
    expect(reasons(errors)).toEqual(['INVALID_OPERATION']);
    expect(lost()).toBe(0);
    expect(dispatcher.inTransaction).toBe(true);
  });

  it('commit ends at once and resolves true when taken; a further call throws', async () => {
    const { session, dispatcher, track } = setup();
    const tx = dispatcher.begin('feature.edit');
    const result = track(tx.commit());
    expect(dispatcher.inTransaction).toBe(false);
    expect(session.kinds()).toEqual(['begin', 'commit']);
    expect(() => tx.apply(setParams('f1', {}))).toThrow(/has ended/);
    expect(() => tx.commit()).toThrow(/has ended/);
    await session.answer();
    await session.answer();
    expect(result()).toBe(true);
  });

  it('commit refused with NO_TRANSACTION: onError, false, no abort', async () => {
    const { session, dispatcher, errors, track } = setup();
    const tx = dispatcher.begin('feature.edit');
    await session.answer();
    const result = track(tx.commit());
    await session.refuse('NO_TRANSACTION');
    expect(result()).toBe(false);
    expect(reasons(errors)).toEqual(['NO_TRANSACTION']);
    expect(session.kinds()).toEqual(['begin', 'commit']);
  });

  it('commit refused otherwise (STORAGE): onError and an abort best effort (N167)', async () => {
    const { session, dispatcher, errors, track } = setup();
    const tx = dispatcher.begin('feature.edit');
    await session.answer();
    const result = track(tx.commit());
    await session.refuse('STORAGE');
    expect(result()).toBe(false);
    expect(session.kinds()).toEqual(['begin', 'commit', 'abort']);
    // NO_TRANSACTION of that abort (the server dropped the transaction itself) is fine.
    await session.refuse('NO_TRANSACTION');
    expect(reasons(errors)).toEqual(['STORAGE']);
    // The next change goes through.
    const next = track(dispatcher.dispatch(rename('Bracket')));
    await session.answer();
    expect(next()).toBe(true);
  });

  it('abort ends at once; NO_TRANSACTION is ignored, another refusal reported', async () => {
    const { session, dispatcher, errors, track } = setup();
    const first = track(dispatcher.begin('a').abort());
    expect(dispatcher.inTransaction).toBe(false);
    await session.answer();
    await session.refuse('NO_TRANSACTION');
    expect(first()).toBe(false);
    expect(errors).toEqual([]);
    const second = track(dispatcher.begin('b').abort());
    await session.answer();
    await session.refuse('STORAGE');
    expect(second()).toBe(false);
    expect(reasons(errors)).toEqual(['STORAGE']);
  });

  it('lost in the middle of a transaction: onLost, its steps are no-ops resolving false', async () => {
    const { session, dispatcher, lost, track } = setup();
    const tx = dispatcher.begin('feature.edit');
    session.lose();
    expect(lost()).toBe(1);
    expect(dispatcher.inTransaction).toBe(false);
    const step = track(tx.apply(setParams('f1', { size: 2 })));
    const abort = track(tx.abort());
    await flush();
    expect([step(), abort()]).toEqual([false, false]);
    expect(session.kinds()).toEqual(['begin']);
  });

  it('lost without a transaction: nothing', () => {
    const { session, lost } = setup();
    session.lose();
    expect(lost()).toBe(0);
  });

  it('NO_TRANSACTION of a step of an ended transaction does not lose the newer one', async () => {
    const { session, dispatcher, errors, lost } = setup();
    const tx = dispatcher.begin('a');
    void tx.apply(setParams('f1', { size: 2 }));
    void tx.commit();
    dispatcher.begin('b');
    await session.answer();
    await session.refuse('NO_TRANSACTION');
    expect(lost()).toBe(0);
    expect(errors).toEqual([]);
    expect(dispatcher.inTransaction).toBe(true);
  });
});

describe('createRemoteDispatcher: undo and read-only', () => {
  it('undo sends Undo and waits for the answer; canUndo comes from the read model', async () => {
    const { session, dispatcher, track } = setup({ canUndo: true });
    const flags: { canUndo: boolean; canRedo: boolean }[] = [];
    dispatcher.undo.events.on('changed', (e) => flags.push(e));
    expect(dispatcher.undo.canUndo()).toBe(true);
    expect(dispatcher.undo.canRedo()).toBe(false);
    const result = track(dispatcher.undo.undo());
    expect(session.sent).toEqual([{ kind: 'undo' }]);
    await session.answer(aReadModel({ canRedo: true }));
    expect(result()).toBe(true);
    expect(dispatcher.undo.canUndo()).toBe(false);
    expect(dispatcher.undo.canRedo()).toBe(true);
    expect(flags).toEqual([{ canUndo: false, canRedo: true }]);
    expect(() => dispatcher.undo.undo()).toThrow(/nothing to undo/);
  });

  it('redo; a refusal: onError, false', async () => {
    const { session, dispatcher, errors, track } = setup({ canRedo: true });
    const result = track(dispatcher.undo.redo());
    expect(session.sent).toEqual([{ kind: 'redo' }]);
    await session.refuse('NOTHING_TO_REDO');
    expect(result()).toBe(false);
    expect(reasons(errors)).toEqual(['NOTHING_TO_REDO']);
  });

  it('canUndo is false during a transaction, changed at its begin and end', () => {
    const { dispatcher } = setup({ canUndo: true });
    const flags: boolean[] = [];
    dispatcher.undo.events.on('changed', (e) => flags.push(e.canUndo));
    const tx = dispatcher.begin('x');
    expect(dispatcher.undo.canUndo()).toBe(false);
    void tx.abort();
    expect(dispatcher.undo.canUndo()).toBe(true);
    expect(flags).toEqual([false, true]);
  });

  it('READ_ONLY: refuseChanges throws and nothing is sent', () => {
    const { session, dispatcher } = setup();
    const guarded = refuseChanges(dispatcher);
    expect(() => guarded.dispatch(rename('x'))).toThrow(/read-only/);
    expect(() => guarded.begin('x')).toThrow(/read-only/);
    expect(session.sent).toEqual([]);
  });
});

describe('createRemoteDispatcher: dispose', () => {
  it('late answers resolve false without onError; read models change no flags', async () => {
    const { session, dispatcher, errors, track } = setup({ canUndo: true });
    const flags: unknown[] = [];
    dispatcher.undo.events.on('changed', (e) => flags.push(e));
    const ok = track(dispatcher.dispatch(rename('a')));
    const refused = track(dispatcher.undo.undo());
    dispatcher.dispose();
    await session.answer(aReadModel());
    await session.refuse('INVALID_OPERATION');
    expect([ok(), refused()]).toEqual([false, false]);
    expect(errors).toEqual([]);
    expect(flags).toEqual([]);
  });

  it('a rejected change (the session was disposed) resolves false', async () => {
    const { session, dispatcher, errors, track } = setup();
    const result = track(dispatcher.dispatch(rename('a')));
    await session.reject();
    expect(result()).toBe(false);
    expect(errors).toEqual([]);
  });

  it('a rejection that is not a RemoteError (a bug of the program) is not swallowed (N176)', async () => {
    const { session, dispatcher } = setup();
    const result = dispatcher.dispatch(rename('a'));
    session.take().reject(new TypeError('cannot encode'));
    await expect(result).rejects.toBeInstanceOf(TypeError);
  });

  it('dispose of its undo does nothing: the dispatcher owns the subscriptions', async () => {
    const { session, dispatcher } = setup({ canUndo: true });
    const flags: unknown[] = [];
    dispatcher.undo.events.on('changed', (e) => flags.push(e));
    dispatcher.undo.dispose();
    void dispatcher.undo.undo();
    await session.answer(aReadModel());
    expect(flags).toEqual([{ canUndo: false, canRedo: false }]);
  });
});
