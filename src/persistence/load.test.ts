import { describe, expect, it } from 'vitest';
import { bodyId, createFeatureSchemaRegistry, toData } from '@/document';
import type { DocumentId, DocumentMeta, FeatureId, FeatureSchema } from '@/document';
import { aFeature } from '@/document/testing';
import {
  createOpHandlerRegistry,
  createOperationDispatcher,
  createUndoManager,
  OP_VERSION,
} from '@/ops';
import type {
  BatchOp,
  BodyRenameOp,
  BodySetVisibleOp,
  FeatureAddOp,
  FeatureMoveOp,
  FeatureRemoveOp,
  FeatureRenameOp,
  FeatureSetParamsOp,
  FeatureSuppressOp,
  LogEntry,
  Operation,
  OpHandlerRegistry,
  StudioSetRollbackOp,
} from '@/ops';
import { anOpsSession } from '@/ops/testing';
import type { OpsSession } from '@/ops/testing';
import { loadDocument } from './load';
import type { LoadDocumentError, LoadedDocument } from './load';
import { createMemoryDocumentStore } from './memory-store';
import { createPersistenceService } from './service';
import { createSnapshot } from './snapshot';
import type { DocumentSnapshot } from './snapshot';
import type { DocumentStore, StoredDocument } from './store';
import { createManualScheduler } from './testing';

// Branded ids are created by a cast at one place in tests.
const id = 'd1' as DocumentId;
const featureA = 'a' as FeatureId;
const meta: DocumentMeta = { id, name: 'Doc', createdAt: 0 };

const schemas = createFeatureSchemaRegistry();

function aSession(): OpsSession {
  return anOpsSession({ meta, features: [aFeature({ id: 'a', name: 'A' })] });
}

function rename(name: string, featureId: FeatureId = featureA): FeatureRenameOp {
  return { type: 'feature.rename', v: OP_VERSION['feature.rename'], featureId, name };
}

/** A stored document: base snapshot, `count` renames of 'a', optional snapshots at `snapshotsAt`. */
async function aStoredSession(count: number, snapshotsAt: readonly number[] = []) {
  const session = aSession();
  const store = createMemoryDocumentStore();
  await store.createDocument(meta, createSnapshot(session.doc, 0));
  const snapshots: DocumentSnapshot[] = [];
  for (let n = 1; n <= count; n++) {
    session.dispatcher.dispatch(rename(`A${String(n)}`));
    if (snapshotsAt.includes(n)) snapshots.push(createSnapshot(session.doc, n));
  }
  if (count > 0) await store.appendEntries(id, session.log.entries());
  for (const s of snapshots) await store.saveSnapshot(id, s);
  return { session, store };
}

/** A store that hands out `change(stored)` instead of what the inner store loaded. */
function tamperedLoad(
  inner: DocumentStore,
  change: (stored: StoredDocument) => StoredDocument,
): DocumentStore {
  return {
    ...inner,
    load: async (docId) => {
      const stored = await inner.load(docId);
      return stored === undefined ? undefined : change(stored);
    },
  };
}

/** Breaks a valid object on purpose: the store must accept it typed, the loader must catch it. */
function broken<T>(value: T, changes: Readonly<Record<string, unknown>>): T {
  // Deliberately wrong data behind a valid type – exactly what a corrupt database returns.
  return { ...value, ...changes };
}

async function loaded(
  store: DocumentStore,
  verify = true,
  handlers: OpHandlerRegistry = createOpHandlerRegistry({ schemas }),
): Promise<LoadedDocument> {
  const result = await loadDocument(store, id, { schemas, handlers, verify });
  if (!result.ok) expect.fail(`Expected the document to load: ${JSON.stringify(result.error)}`);
  return result.value;
}

async function loadError(store: DocumentStore, verify = true): Promise<LoadDocumentError> {
  const result = await loadDocument(store, id, {
    schemas,
    handlers: createOpHandlerRegistry({ schemas }),
    verify,
  });
  if (result.ok) expect.fail('Expected the document not to load');
  return result.error;
}

/** Handlers whose apply calls are counted: how many entries a load really replayed. */
function countingHandlers(): { handlers: OpHandlerRegistry; applied: () => number } {
  const inner = createOpHandlerRegistry({ schemas });
  let count = 0;
  const handlers: OpHandlerRegistry = {
    ...inner,
    get: (type) => {
      const handler = inner.get(type);
      return {
        ...handler,
        apply: (doc, op) => {
          count++;
          handler.apply(doc, op);
        },
      };
    },
  };
  return { handlers, applied: () => count };
}

/**
 * Drives a live session to exactly `total` log entries with a mix of every operation type and
 * some undo/redo. The last entry is a 'do' renaming the returned feature to 'last', so undo
 * afterwards reverts a real operation.
 */
function runMixedHistory(session: OpsSession, total: number): FeatureId {
  const { doc, dispatcher, undo, log } = session;
  let added = 0;
  const dispatch = (
    op:
      | FeatureAddOp
      | FeatureMoveOp
      | FeatureRemoveOp
      | FeatureRenameOp
      | FeatureSetParamsOp
      | FeatureSuppressOp
      | StudioSetRollbackOp,
  ) => dispatcher.dispatch(op);
  while (log.lastSeq < total - 1) {
    const step = log.lastSeq + 1;
    const features = doc.studio.features;
    const first = features[0];
    const last = features.at(-1);
    if (first === undefined || last === undefined) expect.fail('The session lost every feature');
    switch (step % 10) {
      case 1:
      case 9:
        added++;
        dispatch({
          type: 'feature.add',
          v: OP_VERSION['feature.add'],
          feature: aFeature({ id: `n${String(added)}`, name: `N${String(added)}` }),
          index: Math.min(1, features.length),
        });
        break;
      case 2:
        dispatch(rename(`A${String(step)}`, first.id));
        break;
      case 3:
        if (undo.canUndo()) undo.undo();
        else dispatch(rename(`U${String(step)}`, first.id));
        break;
      case 4:
        if (undo.canRedo()) undo.redo();
        else dispatch(rename(`R${String(step)}`, first.id));
        break;
      case 5:
        dispatch({
          type: 'feature.setParams',
          v: OP_VERSION['feature.setParams'],
          featureId: last.id,
          typeVersion: 1,
          params: { size: step },
        });
        break;
      case 6:
        dispatch({
          type: 'feature.suppress',
          v: OP_VERSION['feature.suppress'],
          featureId: last.id,
          suppressed: !last.suppressed,
        });
        break;
      case 7:
        dispatch({
          type: 'feature.move',
          v: OP_VERSION['feature.move'],
          featureId: first.id,
          toIndex: features.length - 1,
        });
        break;
      case 8:
        dispatch({
          type: 'studio.setRollback',
          v: OP_VERSION['studio.setRollback'],
          index: step % 20 === 8 ? features.length - 1 : features.length,
        });
        break;
      default:
        if (features.length > 2)
          dispatch({ type: 'feature.remove', v: OP_VERSION['feature.remove'], featureId: last.id });
        else dispatch(rename(`X${String(step)}`, first.id));
    }
  }
  const target = doc.studio.features[0]?.id;
  if (target === undefined) expect.fail('The session lost every feature');
  dispatch(rename('last', target));
  return target;
}

describe('loadDocument', () => {
  it('250 operations saved by PersistenceService load to the same document, and undo reverts the last operation', async () => {
    const live = aSession();
    const inner = createMemoryDocumentStore();
    await inner.createDocument(meta, createSnapshot(live.doc, 0));
    const scheduler = createManualScheduler();
    const service = createPersistenceService({
      store: inner,
      log: live.log,
      doc: live.doc,
      scheduler,
      snapshotEvery: 100,
    });

    const renamed = runMixedHistory(live, 250);
    await service.flush();
    service.dispose();
    expect(live.log.lastSeq).toBe(250);
    const kinds = new Set(live.log.entries().map((e) => e.kind));
    expect(kinds).toEqual(new Set(['do', 'undo', 'redo']));

    const loads: StoredDocument[] = [];
    const store = tamperedLoad(inner, (stored) => {
      loads.push(stored);
      return stored;
    });
    const { handlers, applied } = countingHandlers();
    const opened = await loaded(store, false, handlers);

    // The snapshot at 200 was used: only the remaining 50 entries were replayed.
    expect(loads[0]?.snapshot).toMatchObject({ atSeq: 200 });
    expect(applied()).toBe(50);
    expect(toData(opened.doc)).toEqual(toData(live.doc));
    expect(opened.log.entries()).toEqual(live.log.entries());

    // Verify replays the whole log from the base and agrees.
    expect(toData((await loaded(store, true)).doc)).toEqual(toData(live.doc));

    const dispatcher = createOperationDispatcher({ doc: opened.doc, handlers, log: opened.log });
    const undo = createUndoManager({ dispatcher, log: opened.log });
    expect(undo.stacks()).toEqual(live.undo.stacks());
    undo.undo();
    live.undo.undo();
    expect(opened.log.entries().at(-1)).toMatchObject({ kind: 'undo', target: 250 });
    expect(toData(opened.doc)).toEqual(toData(live.doc));
    expect(opened.doc.feature(renamed)?.name).not.toBe('last');
  });

  it('snapshot + rest of the log equals replay from the base', async () => {
    const { session, store } = await aStoredSession(7, [3, 5]);
    const opened = await loaded(store, true);
    expect(toData(opened.doc)).toEqual(toData(session.doc));
    expect(opened.doc.feature(featureA)?.name).toBe('A7');
  });

  it('throws when replay from the base differs from snapshot + log', async () => {
    const { session, store } = await aStoredSession(3);
    // A snapshot at 3 that does not match the log: the state after a different history.
    session.dispatcher.dispatch(rename('elsewhere'));
    const snapshot = createSnapshot(session.doc, 3);
    await store.saveSnapshot(id, snapshot);
    await expect(
      loadDocument(store, id, {
        schemas,
        handlers: createOpHandlerRegistry({ schemas }),
        verify: true,
      }),
    ).rejects.toThrow(/not deterministic/);
    // Without verify the mismatch goes unnoticed.
    expect((await loaded(store, false)).doc.feature(featureA)?.name).toBe('elsewhere');
  });

  it('loads a document without entries from its base snapshot', async () => {
    const { session, store } = await aStoredSession(0);
    const opened = await loaded(store);
    expect(toData(opened.doc)).toEqual(toData(session.doc));
    expect(opened.log.lastSeq).toBe(0);
  });

  it('restores the whole log, not only the entries after the snapshot', async () => {
    const { session, store } = await aStoredSession(4, [4]);
    const opened = await loaded(store);
    expect(opened.log.entries()).toEqual(session.log.entries());
  });

  it('keeps body names and hiding: from the snapshot and from replaying the log (M11)', async () => {
    const session = aSession();
    const store = createMemoryDocumentStore();
    await store.createDocument(meta, createSnapshot(session.doc, 0));
    const body = bodyId(featureA);
    const other = bodyId(featureA, 1);
    const ops: readonly (BodyRenameOp | BodySetVisibleOp)[] = [
      { type: 'body.rename', v: OP_VERSION['body.rename'], body, name: 'Base' },
      { type: 'body.setVisible', v: OP_VERSION['body.setVisible'], body, visible: false },
      { type: 'body.setVisible', v: OP_VERSION['body.setVisible'], body: other, visible: false },
      { type: 'body.rename', v: OP_VERSION['body.rename'], body: other, name: 'Other' },
    ];
    for (const op of ops) session.dispatcher.dispatch(op);
    // `store` has all metadata in its snapshot at 4; `fromSnapshot` has a snapshot at 2 with
    // half of it and replays entries 3 and 4 on top. With verify both also replay from the base.
    await store.appendEntries(id, session.log.entries());
    await store.saveSnapshot(id, createSnapshot(session.doc, 4));
    const fromSnapshot = createMemoryDocumentStore();
    await fromSnapshot.createDocument(meta, createSnapshot(aSession().doc, 0));
    await fromSnapshot.appendEntries(id, session.log.entries());
    const partial = aSession();
    for (const op of ops.slice(0, 2)) partial.dispatcher.dispatch(op);
    await fromSnapshot.saveSnapshot(id, createSnapshot(partial.doc, 2));

    for (const s of [store, fromSnapshot]) {
      for (const verify of [true, false]) {
        const opened = await loaded(s, verify);
        expect(opened.doc.bodyMeta(body)).toEqual({ name: 'Base', hidden: true });
        expect(opened.doc.bodyMeta(other)).toEqual({ name: 'Other', hidden: true });
        expect(toData(opened.doc)).toEqual(toData(session.doc));
      }
    }
  });

  describe('migration of feature data (Q035)', () => {
    // The box schema before and after a change: version 2 renamed `w` to `width`.
    const boxV1: FeatureSchema = {
      type: 'box',
      version: 1,
      label: 'box.label',
      params: { w: { kind: 'length', label: 'box.w', default: 1 } },
      defaults: () => ({ w: 1 }),
      validate: () => [],
    };
    const boxV2: FeatureSchema = {
      ...boxV1,
      version: 2,
      params: { width: { kind: 'length', label: 'box.width', default: 1 } },
      defaults: () => ({ width: 1 }),
      migrate(fromVersion, raw) {
        if (fromVersion !== 1) throw new Error(`Unsupported version ${String(fromVersion)}`);
        const { w } = raw as { w: unknown }; // version 1 params, checked right below
        if (typeof w !== 'number') throw new Error('w must be a number');
        return { width: w };
      },
    };
    const registryOf = (schema: FeatureSchema) => {
      const registry = createFeatureSchemaRegistry();
      registry.register(schema);
      return registry;
    };
    const setW = (w: number, featureId: FeatureId = featureA): FeatureSetParamsOp => ({
      type: 'feature.setParams',
      v: OP_VERSION['feature.setParams'],
      featureId,
      typeVersion: 1,
      params: { w },
    });

    /** An operation as written before M10.1: feature.setParams version 1, without typeVersion. */
    function writtenBeforeM101(op: Operation): unknown {
      if (op.type === 'batch') {
        return { ...op, ops: (op as BatchOp).ops.map(writtenBeforeM101) }; // checked by type
      }
      if (op.type !== 'feature.setParams') return op;
      const old = Object.fromEntries(Object.entries(op).filter(([key]) => key !== 'typeVersion'));
      return { ...old, v: 1 };
    }

    /**
     * Saved before M10.1 while box had version 1: base with 'a', then add 'b', two setParams of
     * 'a' and an undo of the second, setParams in operation version 1. A snapshot at 3 makes
     * the latest path start from version 1 data too.
     */
    async function aVersion1Store(): Promise<DocumentStore> {
      const v1 = registryOf(boxV1);
      const session = anOpsSession({
        meta,
        features: [aFeature({ id: 'a', name: 'A', params: { w: 1 } })],
        schemas: v1,
      });
      const store = createMemoryDocumentStore();
      await store.createDocument(meta, createSnapshot(session.doc, 0));
      const addB: FeatureAddOp = {
        type: 'feature.add',
        v: OP_VERSION['feature.add'],
        feature: aFeature({ id: 'b', name: 'B', params: { w: 2 } }),
        index: 1,
      };
      session.dispatcher.dispatch(addB);
      session.dispatcher.dispatch(setW(5));
      session.dispatcher.dispatch(setW(7));
      const snapshot = createSnapshot(session.doc, 3);
      session.undo.undo();
      const entries = session.log.entries().map((entry) =>
        broken(entry, {
          op: writtenBeforeM101(entry.op),
          inverse: writtenBeforeM101(entry.inverse),
        }),
      );
      await store.appendEntries(id, entries);
      await store.saveSnapshot(id, snapshot);
      return store;
    }

    async function openedWithV2(store: DocumentStore): Promise<LoadedDocument> {
      const v2 = registryOf(boxV2);
      const handlers = createOpHandlerRegistry({ schemas: v2 });
      const result = await loadDocument(store, id, { schemas: v2, handlers, verify: true });
      if (!result.ok) expect.fail(`Expected the document to load: ${JSON.stringify(result.error)}`);
      return result.value;
    }

    it('a document saved with schema version 1 loads with version 2: every feature migrated', async () => {
      const store = await aVersion1Store();
      const stored = await store.load(id);
      // The op exactly, without typeVersion.
      expect(stored?.entries[1]).toEqual(
        expect.objectContaining({
          op: { type: 'feature.setParams', v: 1, featureId: 'a', params: { w: 5 } },
        }),
      );
      const opened = await openedWithV2(store);
      expect(opened.doc.studio.features.map((f) => [f.id, f.typeVersion, f.params])).toEqual([
        ['a', 2, { width: 5 }],
        ['b', 2, { width: 2 }],
      ]);
    });

    it('undo and redo after loading apply the old entries in the new shape', async () => {
      const opened = await openedWithV2(await aVersion1Store());
      const handlers = createOpHandlerRegistry({ schemas: registryOf(boxV2) });
      const dispatcher = createOperationDispatcher({ doc: opened.doc, handlers, log: opened.log });
      const undo = createUndoManager({ dispatcher, log: opened.log });

      // Undo of setW(5): its inverse was recorded with version 1 params { w: 1 }.
      undo.undo();
      expect(opened.doc.feature(featureA)).toMatchObject({ typeVersion: 2, params: { width: 1 } });
      // The new entry is computed from the migrated document: current version already.
      expect(opened.log.entries().at(-1)?.inverse).toMatchObject({
        typeVersion: 2,
        params: { width: 5 },
      });

      undo.redo();
      expect(opened.doc.feature(featureA)).toMatchObject({ typeVersion: 2, params: { width: 5 } });
    });

    it('an entry whose migration fails is an entry error with the message', async () => {
      const store = await aVersion1Store();
      // Old data the version 2 migration cannot handle; the entry itself is well formed.
      const op: FeatureSetParamsOp = { ...setW(1), params: { w: 'x' } };
      const bad: LogEntry = {
        seq: 5,
        kind: 'do',
        op,
        inverse: setW(5),
        label: 'Box',
        time: 0,
      };
      await store.appendEntries(id, [bad]);
      const v2 = registryOf(boxV2);
      const result = await loadDocument(store, id, {
        schemas: v2,
        handlers: createOpHandlerRegistry({ schemas: v2 }),
      });
      expect(result).toEqual({
        ok: false,
        error: {
          kind: 'entry',
          seq: 5,
          error: { path: 'op', message: expect.stringContaining('w must be a number') as unknown },
        },
      });
    });
  });

  describe('errors', () => {
    it('a missing document is not-found', async () => {
      expect(await loadError(createMemoryDocumentStore())).toEqual({ kind: 'not-found' });
    });

    it('a store I/O failure rejects instead of returning an error', async () => {
      const { store } = await aStoredSession(1);
      const failing: DocumentStore = {
        ...store,
        load: () => Promise.reject(new Error('disk on fire')),
      };
      await expect(
        loadDocument(failing, id, { schemas, handlers: createOpHandlerRegistry({ schemas }) }),
      ).rejects.toThrow('disk on fire');
    });

    it('an entry that does not parse is an entry error with its seq and path', async () => {
      const { session, store } = await aStoredSession(2);
      const bad = broken(session.dispatcher.dispatch(rename('A3')), {
        op: { type: 'feature.rename', v: 1, featureId: 'a', name: 42 },
      });
      await store.appendEntries(id, [bad]);
      expect(await loadError(store)).toEqual({
        kind: 'entry',
        seq: 3,
        error: { path: 'op.name', message: expect.any(String) as unknown },
      });
    });

    it('a gap in seq is an entry error at the position of the gap', async () => {
      const { store: inner } = await aStoredSession(3);
      const store = tamperedLoad(inner, (stored) => ({
        ...stored,
        entries: stored.entries.filter((_, i) => i !== 1),
      }));
      expect(await loadError(store)).toMatchObject({
        kind: 'entry',
        seq: 2,
        error: { path: 'seq' },
      });
    });

    it('an entry the handler rejects during replay is an entry error with the exception message', async () => {
      const { session, store } = await aStoredSession(2);
      await store.appendEntries(id, [
        session.dispatcher.dispatch(rename('A3')),
        broken(session.dispatcher.dispatch(rename('A4')), {
          op: rename('ghost', 'missing' as FeatureId),
        }),
      ]);
      expect(await loadError(store, false)).toEqual({
        kind: 'entry',
        seq: 4,
        error: { path: 'op', message: "Feature 'missing' does not exist" },
      });
    });

    it('with verify, an entry before the snapshot that the handler rejects is an entry error', async () => {
      const { store: inner } = await aStoredSession(4, [4]);
      // Entry 3 is covered by the snapshot: only the replay from the base applies it.
      const store = tamperedLoad(inner, (stored) => ({
        ...stored,
        entries: stored.entries.map((entry, i) =>
          i === 2 ? broken(entry, { op: rename('ghost', 'missing' as FeatureId) }) : entry,
        ),
      }));
      expect((await loaded(store, false)).doc.feature(featureA)?.name).toBe('A4');
      expect(await loadError(store, true)).toEqual({
        kind: 'entry',
        seq: 3,
        error: { path: 'op', message: "Feature 'missing' does not exist" },
      });
    });

    it('a snapshot with a wrong format is a snapshot error of the latest', async () => {
      const { session, store } = await aStoredSession(2);
      await store.saveSnapshot(id, broken(createSnapshot(session.doc, 2), { format: 'nope' }));
      expect(await loadError(store)).toEqual({
        kind: 'snapshot',
        which: 'latest',
        error: { issues: [{ path: 'format', message: expect.any(String) as unknown }] },
      });
    });

    it('a snapshot of a newer format version says so', async () => {
      const { session, store } = await aStoredSession(2);
      await store.saveSnapshot(id, broken(createSnapshot(session.doc, 2), { formatVersion: 2 }));
      const error = await loadError(store);
      expect(error).toMatchObject({ kind: 'snapshot', which: 'latest' });
      expect(JSON.stringify(error)).toMatch(/newer/);
    });

    it('a snapshot beyond the stored entries is a snapshot error at atSeq', async () => {
      const { store: inner } = await aStoredSession(2, [2]);
      const store = tamperedLoad(inner, (stored) => ({
        ...stored,
        entries: stored.entries.slice(0, 1),
      }));
      expect(await loadError(store)).toMatchObject({
        kind: 'snapshot',
        which: 'latest',
        error: { issues: [{ path: 'atSeq' }] },
      });
    });

    it('a snapshot of another document is a snapshot error at document.meta.id', async () => {
      const { session, store: inner } = await aStoredSession(1);
      const foreign = createSnapshot(
        anOpsSession({ meta: { ...meta, id: 'other' as DocumentId } }).doc,
        1,
      );
      const store = tamperedLoad(inner, (stored) => ({ ...stored, snapshot: foreign }));
      expect(session.log.lastSeq).toBe(1);
      expect(await loadError(store)).toMatchObject({
        kind: 'snapshot',
        which: 'latest',
        error: { issues: [{ path: 'document.meta.id' }] },
      });
    });

    it('broken document data in the snapshot reports fromData issues under document', async () => {
      const { session, store } = await aStoredSession(2);
      const snapshot = createSnapshot(session.doc, 2);
      await store.saveSnapshot(
        id,
        broken(snapshot, { document: { ...snapshot.document, studio: { features: 'no' } } }),
      );
      expect(await loadError(store)).toMatchObject({
        kind: 'snapshot',
        which: 'latest',
        error: { issues: [{ path: 'document.studio.features' }] },
      });
    });

    it('a broken base is reported as which base only with verify', async () => {
      const session = aSession();
      const store = createMemoryDocumentStore();
      const base = createSnapshot(session.doc, 0);
      await store.createDocument(
        meta,
        broken(base, { document: { ...base.document, studio: { features: 'no' } } }),
      );
      session.dispatcher.dispatch(rename('A1'));
      await store.appendEntries(id, session.log.entries());
      await store.saveSnapshot(id, createSnapshot(session.doc, 1));

      expect((await loaded(store, false)).doc.feature(featureA)?.name).toBe('A1');
      expect(await loadError(store, true)).toMatchObject({
        kind: 'snapshot',
        which: 'base',
        error: { issues: [{ path: 'document.studio.features' }] },
      });
    });

    it('reports entries before the snapshot: every entry is parsed', async () => {
      const { session, store } = await aStoredSession(1);
      const bad: LogEntry = broken(session.dispatcher.dispatch(rename('A2')), { label: 7 });
      await store.appendEntries(id, [bad]);
      session.dispatcher.dispatch(rename('A3'));
      await store.appendEntries(id, session.log.entries(3));
      await store.saveSnapshot(id, createSnapshot(session.doc, 3));
      expect(await loadError(store, false)).toMatchObject({
        kind: 'entry',
        seq: 2,
        error: { path: 'label' },
      });
    });
  });
});
