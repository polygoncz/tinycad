import { describe, expect, it } from 'vitest';
import { createSequentialIdGenerator, Emitter, ObservableValue } from '@/core';
import type { Observable, Subscribable } from '@/core';
import { createFeatureSchemaRegistry, validateAgainstSchema } from '@/document';
import type {
  DocumentId,
  FeatureId,
  FeatureInstance,
  FeatureSchema,
  ParamSchemaOf,
  PartStudioData,
} from '@/document';
import { aFeature } from '@/document/testing';
import { createFeatureEditor } from '@/interaction';
import { createOpHandlerRegistry, OP_VERSION } from '@/ops';
import type { FeatureSetParamsOp, Operation, StudioSetRollbackOp } from '@/ops';
import { RemoteError } from '@/remote';
import type {
  ChangeOutcome,
  ChangeRequest,
  ConnectionState,
  HistoryData,
  LogEntryData,
  ReadModelData,
  RemoteErrorReason,
  RemoteSession,
  RemoteSessionEvents,
} from '@/remote';
import { MirrorDocument } from '@/app/mirror-document';
import { createRemoteDispatcher } from '@/app/remote-dispatcher';
import { refuseChanges } from '@/app/read-only';

// --- schemas: a box with a width, a "sketch" with one coordinate ---

interface BoxParams {
  readonly width: number;
}

const BOX_PARAMS: ParamSchemaOf<BoxParams> = {
  width: { kind: 'length', label: 'box.width', default: 10, min: 0, exclusiveMin: true },
};

const BOX: FeatureSchema<BoxParams> = {
  type: 'box',
  version: 1,
  label: 'box.label',
  params: BOX_PARAMS,
  defaults: () => ({ width: 10 }),
  validate: (params) => validateAgainstSchema(BOX_PARAMS, params),
};

interface SketchParams {
  readonly x: number;
}

const SKETCH_PARAMS: ParamSchemaOf<SketchParams> = {
  x: { kind: 'number', label: 'sketch.x', default: 0 },
};

const SKETCH: FeatureSchema<SketchParams> = {
  type: 'sketch',
  version: 1,
  label: 'sketch.label',
  params: SKETCH_PARAMS,
  defaults: () => ({ x: 0 }),
  validate: (params) => validateAgainstSchema(SKETCH_PARAMS, params),
};

const fid = (id: string): FeatureId => id as FeatureId; // test ids are trusted

const aBox = (id: string, width: number): FeatureInstance =>
  aFeature<BoxParams>({ id, name: id, type: 'box', params: { width } });

const aSketch = (id: string, x: number): FeatureInstance =>
  aFeature<SketchParams>({ id, name: id, type: 'sketch', params: { x } });

const setParams = (id: string, params: unknown, typeVersion = 1): FeatureSetParamsOp => ({
  type: 'feature.setParams',
  v: OP_VERSION['feature.setParams'],
  featureId: fid(id),
  typeVersion,
  params,
});

const setRollback = (index: number): StudioSetRollbackOp => ({
  type: 'studio.setRollback',
  v: OP_VERSION['studio.setRollback'],
  index,
});

// --- read models ---

interface ModelInit {
  readonly features?: readonly FeatureInstance[];
  readonly rollbackIndex?: number;
  readonly lastSeq?: number;
  readonly canUndo?: boolean;
  readonly canRedo?: boolean;
  readonly name?: string;
}

function aReadModel(init: ModelInit = {}): ReadModelData {
  const features = init.features ?? [];
  const studio: PartStudioData = {
    features,
    rollbackIndex: init.rollbackIndex ?? features.length,
  };
  return {
    document: {
      id: 'doc-1' as DocumentId, // test ids are trusted
      name: init.name ?? 'Part',
      createdAt: 0,
      lastSeq: init.lastSeq ?? 0,
      studio,
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

/**
 * A RemoteSession for tests: records every change and settles them oldest first when the test
 * says so. A successful answer sets the read model before the change resolves, as a session that
 * emits synchronously and resolves its promise later.
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
  private readonly open: { resolve: (outcome: ChangeOutcome) => void }[] = [];
  stacks: HistoryData['stacks'] = { undo: [], redo: [] };
  readonly historyCalls: number[] = [];

  constructor(initial: ReadModelData) {
    this.model = new ObservableValue(initial);
    this.readModel = this.model.asObservable();
  }

  change(request: ChangeRequest): Promise<ChangeOutcome> {
    this.sent.push(request);
    return new Promise((resolve) => {
      this.open.push({ resolve });
    });
  }

  get unanswered(): number {
    return this.open.length;
  }

  /** Answers the oldest change with the read model; resolves after the answer is handled. */
  answer(model: ReadModelData, entry: LogEntryData | null = null): Promise<void> {
    const next = this.open.shift();
    if (next === undefined) throw new Error('nothing to answer');
    this.model.set(model);
    next.resolve({ ok: true, entry, readModel: model });
    return flush();
  }

  /** Refuses the oldest change. */
  refuse(reason: RemoteErrorReason): Promise<void> {
    const next = this.open.shift();
    if (next === undefined) throw new Error('nothing to refuse');
    next.resolve({
      ok: false,
      error: new RemoteError({ code: 'FAILED_PRECONDITION', reason, message: reason }),
    });
    return flush();
  }

  /** The transaction died with a new session: its read model, then `lost`. */
  lose(model: ReadModelData): void {
    this.model.set(model);
    this.emitter.emit('lost', { what: 'transaction' });
  }

  refresh(): Promise<void> {
    return Promise.resolve();
  }

  history(fromSeq: number): Promise<HistoryData> {
    this.historyCalls.push(fromSeq);
    return Promise.resolve({ entries: [], stacks: this.stacks });
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
}

function setup(init: ModelInit = {}) {
  const initial = aReadModel(init);
  const session = new FakeRemoteSession(initial);
  const mirror = new MirrorDocument(initial.document);
  const schemas = createFeatureSchemaRegistry();
  schemas.register(BOX);
  schemas.register(SKETCH);
  const handlers = createOpHandlerRegistry({ schemas });
  const errors: RemoteError[] = [];
  let lost = 0;
  let clock = 100;
  const dispatcher = createRemoteDispatcher({
    mirror,
    session,
    handlers,
    now: () => ++clock,
    onError: (e) => errors.push(e),
    onLost: () => lost++,
  });
  const paramsOf = (id: string): unknown => mirror.feature(fid(id))?.params;
  return { session, mirror, schemas, dispatcher, errors, lost: () => lost, paramsOf };
}

const ops = (session: FakeRemoteSession): (Operation | string)[] =>
  session.sent.map((r) => ('op' in r ? r.op : r.kind));

describe('createRemoteDispatcher: dispatch', () => {
  it('applies to the mirror at once, sends the change and returns a provisional entry', () => {
    const { session, dispatcher, paramsOf } = setup({ features: [aBox('b', 1)], lastSeq: 4 });
    const op = setParams('b', { width: 5 });
    const entry = dispatcher.dispatch(op, { label: 'box.edit' });
    expect(paramsOf('b')).toEqual({ width: 5 });
    expect(session.sent).toEqual([{ kind: 'dispatch', op, label: 'box.edit' }]);
    expect(entry).toMatchObject({ seq: 5, kind: 'do', op, label: 'box.edit', time: 101 });
    expect(entry.inverse).toEqual(setParams('b', { width: 1 }));
  });

  it('throws synchronously for an invalid operation and sends nothing', () => {
    const { session, dispatcher, paramsOf } = setup({ features: [aBox('b', 1)] });
    expect(() => dispatcher.dispatch(setParams('missing', { width: 5 }))).toThrow();
    expect(() => dispatcher.dispatch(setParams('b', { width: 5 }, 7))).toThrow();
    expect(session.sent).toEqual([]);
    expect(paramsOf('b')).toEqual({ width: 1 });
  });

  it('emits applied with the entry', () => {
    const { dispatcher } = setup({ features: [aBox('b', 1)] });
    const seen: unknown[] = [];
    dispatcher.events.on('applied', (e) => seen.push(e.entry?.kind));
    dispatcher.dispatch(setParams('b', { width: 5 }));
    expect(seen).toEqual(['do']);
  });

  it('the answer of the server replaces the local data (server coordinates of a sketch)', async () => {
    const { session, dispatcher, paramsOf } = setup({ features: [aSketch('s', 0)] });
    dispatcher.dispatch(setParams('s', { x: 1 }));
    expect(paramsOf('s')).toEqual({ x: 1 });
    await session.answer(aReadModel({ features: [aSketch('s', 1.0001)], lastSeq: 1 }));
    expect(paramsOf('s')).toEqual({ x: 1.0001 });
  });

  it('two quick changes, the answer to the first: mirror = answer + the second', async () => {
    const { session, dispatcher, paramsOf } = setup({ features: [aBox('a', 1), aBox('b', 1)] });
    dispatcher.dispatch(setParams('a', { width: 2 }));
    dispatcher.dispatch(setParams('b', { width: 3 }));
    // The server corrected the first change.
    await session.answer(aReadModel({ features: [aBox('a', 2.5), aBox('b', 1)], lastSeq: 1 }));
    expect(paramsOf('a')).toEqual({ width: 2.5 });
    expect(paramsOf('b')).toEqual({ width: 3 });
    await session.answer(aReadModel({ features: [aBox('a', 2.5), aBox('b', 3)], lastSeq: 2 }));
    expect(paramsOf('b')).toEqual({ width: 3 });
  });

  it('a refused second change is dropped from the mirror and reported', async () => {
    const { session, dispatcher, paramsOf, errors } = setup({
      features: [aBox('a', 1), aBox('b', 1)],
    });
    dispatcher.dispatch(setParams('a', { width: 2 }));
    dispatcher.dispatch(setParams('b', { width: 3 }));
    await session.answer(aReadModel({ features: [aBox('a', 2), aBox('b', 1)], lastSeq: 1 }));
    await session.refuse('INVALID_OPERATION');
    expect(paramsOf('a')).toEqual({ width: 2 });
    expect(paramsOf('b')).toEqual({ width: 1 });
    expect(errors.map((e) => e.reason)).toEqual(['INVALID_OPERATION']);
  });

  it('a pending change that no longer applies on the new base is dropped and reported', async () => {
    const { session, dispatcher, mirror, errors } = setup({ features: [aBox('a', 1)] });
    dispatcher.dispatch(setParams('a', { width: 2 }));
    dispatcher.dispatch(setParams('a', { width: 3 }));
    // The server removed the feature with the first answer (e.g. another rule).
    await session.answer(aReadModel({ features: [], lastSeq: 1 }));
    expect(mirror.studio.features).toEqual([]);
    expect(errors.map((e) => e.reason)).toEqual(['INVALID_OPERATION']);
    // Its own later answer does not report it again.
    await session.refuse('UNKNOWN_TARGET');
    expect(errors).toHaveLength(1);
  });

  it('a read model of the session while idle replaces the mirror (another tab)', () => {
    const { session, paramsOf } = setup({ features: [aBox('a', 1)] });
    session.model.set(aReadModel({ features: [aBox('a', 7)], lastSeq: 3 }));
    expect(paramsOf('a')).toEqual({ width: 7 });
  });

  it('a read model of the session while changes are pending waits for the queue to drain', async () => {
    const { session, dispatcher, paramsOf } = setup({ features: [aBox('a', 1), aBox('b', 1)] });
    dispatcher.dispatch(setParams('a', { width: 2 }));
    // A refresh that does not know whether it contains the pending change.
    session.model.set(aReadModel({ features: [aBox('a', 1), aBox('b', 9)], lastSeq: 0 }));
    expect(paramsOf('a')).toEqual({ width: 2 });
    expect(paramsOf('b')).toEqual({ width: 1 });
    await session.refuse('STORAGE');
    // Drained: the newer read model is taken.
    expect(paramsOf('a')).toEqual({ width: 1 });
    expect(paramsOf('b')).toEqual({ width: 9 });
  });
});

describe('createRemoteDispatcher: transactions', () => {
  it('apply is in the mirror at once and the feature dialog reads it synchronously', () => {
    const { session, dispatcher, mirror, schemas } = setup({ features: [aBox('b', 1)] });
    const editor = createFeatureEditor({
      doc: mirror,
      ops: dispatcher,
      schemas,
      ids: createSequentialIdGenerator('new'),
    });
    const edit = editor.edit(fid('b'));
    expect(dispatcher.inTransaction).toBe(true);
    edit.setParam('width', 4);
    expect(edit.state.get().params).toEqual({ width: 4 });
    expect(mirror.feature(fid('b'))?.params).toEqual({ width: 4 });
    expect(ops(session)).toEqual(['begin', setParams('b', { width: 4 })]);
  });

  it('commit ends at once: the bar is back, the transient step reverted, one entry', () => {
    const { session, dispatcher, mirror, paramsOf } = setup({
      features: [aBox('a', 1), aBox('b', 1)],
    });
    const tx = dispatcher.begin('feature.edit');
    tx.applyTransient(setRollback(1));
    tx.apply(setParams('a', { width: 3 }));
    expect(mirror.studio.rollbackIndex).toBe(1);
    const entry = tx.commit();
    expect(dispatcher.inTransaction).toBe(false);
    expect(mirror.studio.rollbackIndex).toBe(2);
    expect(paramsOf('a')).toEqual({ width: 3 });
    expect(entry).toMatchObject({
      kind: 'do',
      label: 'feature.edit',
      op: setParams('a', { width: 3 }),
    });
    expect(ops(session)).toEqual(['begin', setRollback(1), setParams('a', { width: 3 }), 'commit']);
    expect(session.sent[1]?.kind).toBe('applyTransient');
  });

  it('commit of an empty transaction returns null', () => {
    const { dispatcher } = setup();
    expect(dispatcher.begin('x').commit()).toBeNull();
  });

  it('abort ends at once and reverts every step', () => {
    const { session, dispatcher, mirror, paramsOf } = setup({
      features: [aBox('a', 1), aBox('b', 1)],
    });
    const seen: boolean[] = [];
    dispatcher.events.on('transaction', (e) => seen.push(e.active));
    const tx = dispatcher.begin('feature.edit');
    tx.applyTransient(setRollback(1));
    tx.apply(setParams('a', { width: 3 }));
    tx.apply(setParams('a', { width: 4 }));
    tx.abort();
    expect(dispatcher.inTransaction).toBe(false);
    expect(mirror.studio.rollbackIndex).toBe(2);
    expect(paramsOf('a')).toEqual({ width: 1 });
    expect(seen).toEqual([true, false]);
    expect(session.sent.at(-1)).toEqual({ kind: 'abort' });
    expect(() => {
      tx.apply(setParams('a', { width: 5 }));
    }).toThrow(/has ended/);
  });

  it('a commit pending when the answer to apply arrives is replayed by its inverses', async () => {
    const { session, dispatcher, mirror, paramsOf } = setup({
      features: [aBox('a', 1), aBox('b', 1)],
    });
    const tx = dispatcher.begin('feature.edit');
    tx.applyTransient(setRollback(1));
    tx.apply(setParams('a', { width: 3 }));
    tx.commit();
    // begin, then applyTransient: the server document is mid-transaction with the bar at 1.
    await session.answer(aReadModel({ features: [aBox('a', 1), aBox('b', 1)] }));
    await session.answer(aReadModel({ features: [aBox('a', 1), aBox('b', 1)], rollbackIndex: 1 }));
    expect(mirror.studio.rollbackIndex).toBe(2);
    expect(paramsOf('a')).toEqual({ width: 3 });
    await session.answer(aReadModel({ features: [aBox('a', 3), aBox('b', 1)], rollbackIndex: 1 }));
    expect(mirror.studio.rollbackIndex).toBe(2);
    expect(paramsOf('a')).toEqual({ width: 3 });
    await session.answer(aReadModel({ features: [aBox('a', 3), aBox('b', 1)], lastSeq: 1 }));
    expect(mirror.studio.rollbackIndex).toBe(2);
    expect(session.unanswered).toBe(0);
  });

  it('abort after confirmed steps reverts them by their remembered inverses', async () => {
    const { session, dispatcher, paramsOf } = setup({ features: [aBox('a', 1)] });
    const tx = dispatcher.begin('feature.edit');
    tx.apply(setParams('a', { width: 3 }));
    await session.answer(aReadModel({ features: [aBox('a', 1)] }));
    await session.answer(aReadModel({ features: [aBox('a', 3)] }));
    expect(session.unanswered).toBe(0);
    tx.abort();
    expect(paramsOf('a')).toEqual({ width: 1 });
    // The server state is still mid-transaction until the answer to abort.
    session.model.set(aReadModel({ features: [aBox('a', 3)], name: 'Again' }));
    expect(paramsOf('a')).toEqual({ width: 1 });
    await session.answer(aReadModel({ features: [aBox('a', 1)] }));
    expect(paramsOf('a')).toEqual({ width: 1 });
  });

  it('SKETCH_NOT_SOLVED keeps the local sketch until the next accepted setParams', async () => {
    const { session, dispatcher, paramsOf, errors } = setup({ features: [aSketch('s', 0)] });
    const tx = dispatcher.begin('sketch.edit');
    tx.apply(setParams('s', { x: 1 }));
    await session.answer(aReadModel({ features: [aSketch('s', 0)] }));
    await session.refuse('SKETCH_NOT_SOLVED');
    expect(errors.map((e) => e.reason)).toEqual(['SKETCH_NOT_SOLVED']);
    expect(paramsOf('s')).toEqual({ x: 1 });
    // Another answer (a refresh) keeps the layer.
    session.model.set(aReadModel({ features: [aSketch('s', 0)], name: 'Renamed' }));
    expect(paramsOf('s')).toEqual({ x: 1 });
    // A newer local setParams shows at once.
    tx.apply(setParams('s', { x: 2 }));
    expect(paramsOf('s')).toEqual({ x: 2 });
    await session.answer(aReadModel({ features: [aSketch('s', 2.0001)] }));
    expect(paramsOf('s')).toEqual({ x: 2.0001 });
    // The layer is gone: a later answer is the server state.
    session.model.set(aReadModel({ features: [aSketch('s', 2.5)] }));
    expect(paramsOf('s')).toEqual({ x: 2.5 });
  });

  it('commit drops the local sketch of SKETCH_NOT_SOLVED', async () => {
    const { session, dispatcher, paramsOf } = setup({ features: [aSketch('s', 0)] });
    const tx = dispatcher.begin('sketch.edit');
    tx.apply(setParams('s', { x: 1 }));
    await session.answer(aReadModel({ features: [aSketch('s', 0)] }));
    await session.refuse('SKETCH_NOT_SOLVED');
    expect(paramsOf('s')).toEqual({ x: 1 });
    tx.commit();
    expect(paramsOf('s')).toEqual({ x: 0 });
  });

  it('lost ends the transaction without an RPC; its object is a no-op; mirror = the new model', () => {
    const { session, dispatcher, mirror, lost, paramsOf } = setup({ features: [aBox('a', 1)] });
    const seen: boolean[] = [];
    dispatcher.events.on('transaction', (e) => seen.push(e.active));
    const tx = dispatcher.begin('feature.edit');
    tx.apply(setParams('a', { width: 3 }));
    session.lose(aReadModel({ features: [aBox('a', 1), aBox('c', 2)] }));
    expect(dispatcher.inTransaction).toBe(false);
    expect(lost()).toBe(1);
    expect(seen).toEqual([true, false]);
    expect(mirror.studio.features.map((f) => f.id)).toEqual(['a', 'c']);
    expect(paramsOf('a')).toEqual({ width: 1 });
    const sent = session.sent.length;
    tx.apply(setParams('a', { width: 4 }));
    expect(tx.commit()).toBeNull();
    tx.abort();
    expect(session.sent).toHaveLength(sent);
    expect(paramsOf('a')).toEqual({ width: 1 });
    // A new transaction can start.
    expect(() => dispatcher.begin('next')).not.toThrow();
  });

  it('lost keeps a pending durable change on top of the new model', async () => {
    const { session, dispatcher, paramsOf, errors } = setup({ features: [aBox('a', 1)] });
    dispatcher.dispatch(setParams('a', { width: 2 }));
    const tx = dispatcher.begin('x');
    tx.apply(setParams('a', { width: 3 }));
    session.lose(aReadModel({ features: [aBox('a', 1)] }));
    expect(paramsOf('a')).toEqual({ width: 2 });
    // The session sends the dispatch again; the transaction steps end with NO_TRANSACTION.
    await session.answer(aReadModel({ features: [aBox('a', 2)], lastSeq: 1 }));
    await session.refuse('NO_TRANSACTION');
    await session.refuse('NO_TRANSACTION');
    expect(paramsOf('a')).toEqual({ width: 2 });
    expect(errors).toEqual([]);
  });
});

describe('createRemoteDispatcher: read-only and undo', () => {
  it('READ_ONLY: refuseChanges refuses and nothing is sent', () => {
    const { session, dispatcher } = setup({ features: [aBox('a', 1)] });
    const readOnly = refuseChanges(dispatcher);
    expect(() => readOnly.dispatch(setParams('a', { width: 2 }))).toThrow(/read-only/);
    expect(() => readOnly.begin('x')).toThrow(/read-only/);
    expect(session.sent).toEqual([]);
  });

  it('undo waits for the answer; canUndo comes from the read model', async () => {
    const { session, dispatcher, paramsOf } = setup({
      features: [aBox('a', 2)],
      lastSeq: 1,
      canUndo: true,
    });
    const { undo } = dispatcher;
    const changes: unknown[] = [];
    undo.events.on('changed', (e) => changes.push(e));
    expect(undo.canUndo()).toBe(true);
    expect(undo.canRedo()).toBe(false);
    undo.undo();
    expect(session.sent).toEqual([{ kind: 'undo' }]);
    expect(paramsOf('a')).toEqual({ width: 2 });
    await session.answer(
      aReadModel({ features: [aBox('a', 1)], lastSeq: 2, canUndo: false, canRedo: true }),
    );
    expect(paramsOf('a')).toEqual({ width: 1 });
    expect(undo.canUndo()).toBe(false);
    expect(undo.canRedo()).toBe(true);
    expect(changes).toEqual([{ canUndo: false, canRedo: true }]);
    undo.redo();
    expect(session.sent.at(-1)).toEqual({ kind: 'redo' });
  });

  it('canUndo is false during a transaction', () => {
    const { dispatcher } = setup({ canUndo: true });
    const changes: unknown[] = [];
    dispatcher.undo.events.on('changed', (e) => changes.push(e));
    const tx = dispatcher.begin('x');
    expect(dispatcher.undo.canUndo()).toBe(false);
    expect(() => {
      dispatcher.undo.undo();
    }).toThrow(/nothing to undo/);
    tx.abort();
    expect(dispatcher.undo.canUndo()).toBe(true);
    expect(changes).toEqual([
      { canUndo: false, canRedo: false },
      { canUndo: true, canRedo: false },
    ]);
  });

  it('stacks come from the history of the server', async () => {
    const { session, dispatcher } = setup({ lastSeq: 2 });
    session.stacks = { undo: [1], redo: [2] };
    session.model.set(aReadModel({ lastSeq: 3 }));
    await flush();
    expect(dispatcher.undo.stacks()).toEqual({ undo: [1], redo: [2] });
    expect(session.historyCalls).toEqual([3, 4]);
  });

  it('stops following the session after dispose', () => {
    const { session, dispatcher, paramsOf } = setup({ features: [aBox('a', 1)] });
    dispatcher.undo.dispose();
    session.model.set(aReadModel({ features: [aBox('a', 7)] }));
    expect(paramsOf('a')).toEqual({ width: 1 });
  });
});
