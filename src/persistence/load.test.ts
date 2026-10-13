import { describe, expect, it } from 'vitest';
import { createFeatureSchemaRegistry, toData } from '@/document';
import type { DocumentId, DocumentMeta, FeatureId } from '@/document';
import { aFeature } from '@/document/testing';
import {
  createOpHandlerRegistry,
  createOperationDispatcher,
  createUndoManager,
  OP_VERSION,
} from '@/ops';
import type {
  FeatureAddOp,
  FeatureMoveOp,
  FeatureRemoveOp,
  FeatureRenameOp,
  FeatureSetParamsOp,
  FeatureSuppressOp,
  LogEntry,
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
  handlers: OpHandlerRegistry = createOpHandlerRegistry(),
): Promise<LoadedDocument> {
  const result = await loadDocument(store, id, { schemas, handlers, verify });
  if (!result.ok) expect.fail(`Expected the document to load: ${JSON.stringify(result.error)}`);
  return result.value;
}

async function loadError(store: DocumentStore, verify = true): Promise<LoadDocumentError> {
  const result = await loadDocument(store, id, {
    schemas,
    handlers: createOpHandlerRegistry(),
    verify,
  });
  if (result.ok) expect.fail('Expected the document not to load');
  return result.error;
}

/** Handlers whose apply calls are counted: how many entries a load really replayed. */
function countingHandlers(): { handlers: OpHandlerRegistry; applied: () => number } {
  const inner = createOpHandlerRegistry();
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
      loadDocument(store, id, { schemas, handlers: createOpHandlerRegistry(), verify: true }),
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
        loadDocument(failing, id, { schemas, handlers: createOpHandlerRegistry() }),
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
