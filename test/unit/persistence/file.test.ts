import { describe, expect, it } from 'vitest';
import { createFeatureSchemaRegistry, toData } from '@/document';
import type {
  DocumentId,
  DocumentLoadError,
  DocumentMeta,
  FeatureId,
  FeatureSchema,
  FeatureSchemaRegistry,
} from '@/document';
import { aDocument, aFeature } from '@/document/testing';
import { createOpHandlerRegistry, OP_VERSION, rebuildUndoStacks } from '@/ops';
import type { BatchOp, FeatureAddOp, FeatureRenameOp } from '@/ops';
import { anOpsSession } from '@/ops/testing';
import type { OpsSession } from '@/ops/testing';
import { exportDocument, exportStoredDocument, importDocument } from '@/persistence/file';
import type { TinycadFile } from '@/persistence/file';
import { loadDocument } from '@/persistence/load';
import { createMemoryDocumentStore } from '@/persistence/memory-store';
import { createSnapshot } from '@/persistence/snapshot';
import type { DocumentSnapshot } from '@/persistence/snapshot';
import type { DocumentStore } from '@/persistence/store';

// Branded ids are created by a cast at one place in tests.
const sourceId = 'src' as DocumentId;
const newId = 'imported' as DocumentId;
const now = 1_700_000_000_000;

const emptySchemas = createFeatureSchemaRegistry();

function aSourceDocument() {
  return aDocument({
    meta: { id: sourceId, name: 'Bracket', createdAt: 5 },
    features: [aFeature({ id: 'a', name: 'A' }), aFeature({ id: 'b', name: 'B' })],
    rollbackIndex: 1,
  });
}

/** What a file looks like after the round trip through text: plain JSON, no types. */
function throughJson(file: TinycadFile): unknown {
  return JSON.parse(JSON.stringify(file));
}

async function imported(
  store: DocumentStore,
  raw: unknown,
  id: DocumentId = newId,
  schemas: FeatureSchemaRegistry = emptySchemas,
): Promise<DocumentMeta> {
  const result = await importDocument(store, raw, {
    schemas,
    handlers: createOpHandlerRegistry({ schemas }),
    newId: id,
    now,
  });
  if (!result.ok) expect.fail(`Expected the import to succeed: ${JSON.stringify(result.error)}`);
  return result.value;
}

/** A failed import must leave the store untouched. */
async function importError(raw: unknown): Promise<DocumentLoadError> {
  const store = createMemoryDocumentStore();
  const result = await importDocument(store, raw, {
    schemas: emptySchemas,
    handlers: createOpHandlerRegistry({ schemas: emptySchemas }),
    newId,
    now,
  });
  if (result.ok) expect.fail('Expected the import to fail');
  expect(await store.listDocuments()).toEqual([]);
  return result.error;
}

async function loadedData(store: DocumentStore, id: DocumentId, schemas = emptySchemas) {
  const result = await loadDocument(store, id, {
    schemas,
    handlers: createOpHandlerRegistry({ schemas }),
    verify: true,
  });
  if (!result.ok) expect.fail(`Expected the document to load: ${JSON.stringify(result.error)}`);
  return toData(result.value.doc);
}

/** A valid exported file as plain data, with `changes` applied on top. */
// The casts below only re-type what exportDocument just produced: an object with a snapshot.
function fileWith(changes: Readonly<Record<string, unknown>>): unknown {
  return { ...(throughJson(exportDocument(aSourceDocument())) as object), ...changes };
}

/** A valid exported snapshot as plain data, with `changes` applied on top. */
function snapshotWith(changes: Readonly<Record<string, unknown>>): unknown {
  return {
    ...(throughJson(exportDocument(aSourceDocument())) as { snapshot: object }).snapshot,
    ...changes,
  };
}

describe('exportDocument', () => {
  it('wraps a snapshot at atSeq 0 of the current state', () => {
    const doc = aSourceDocument();
    expect(exportDocument(doc)).toEqual({
      format: 'tinycad.file',
      formatVersion: 2,
      snapshot: createSnapshot(doc, 0),
    });
  });
});

describe('importDocument', () => {
  it('round trip through JSON gives the same data except meta.id and createdAt', async () => {
    const source = aSourceDocument();
    const store = createMemoryDocumentStore();

    const meta = await imported(store, throughJson(exportDocument(source)));

    expect(meta).toEqual({ id: newId, name: 'Bracket', createdAt: now });
    const expected = toData(source);
    expect(await loadedData(store, newId)).toEqual({ ...expected, meta });
  });

  it('stores the document with no log entries', async () => {
    const store = createMemoryDocumentStore();
    await imported(store, throughJson(exportDocument(aSourceDocument())));
    const stored = await store.load(newId);
    expect(stored?.entries).toEqual([]);
    expect(stored?.snapshot).toMatchObject({ atSeq: 0, document: { meta: { id: newId } } });
  });

  it('importing the same file twice gives two documents', async () => {
    const store = createMemoryDocumentStore();
    const raw = throughJson(exportDocument(aSourceDocument()));
    await imported(store, raw, 'first' as DocumentId);
    await imported(store, raw, 'second' as DocumentId);
    const ids = (await store.listDocuments()).map((info) => info.meta.id);
    expect([...ids].sort()).toEqual(['first', 'second']);
  });

  it('migrates features of an older typeVersion', async () => {
    // Box v2 renamed `size` to `width`; the exported file still has v1 features.
    const boxV2: FeatureSchema<{ readonly width: number }> = {
      type: 'box',
      version: 2,
      label: 'Box',
      params: { width: { kind: 'length', label: 'Width', default: 10 } },
      defaults: () => ({ width: 10 }),
      validate: () => [],
      migrate: (_fromVersion, raw) => {
        // Test data: v1 params are always { size: number }.
        const { size } = raw as { size: number };
        return { width: size };
      },
    };
    const schemas = createFeatureSchemaRegistry();
    schemas.register(boxV2);
    const source = aDocument({ features: [aFeature({ id: 'a', params: { size: 7 } })] });
    const store = createMemoryDocumentStore();

    await imported(store, throughJson(exportDocument(source)), newId, schemas);

    const stored = await store.load(newId);
    expect(stored?.snapshot).toMatchObject({
      document: { studio: { features: [{ id: 'a', typeVersion: 2, params: { width: 7 } }] } },
    });
    expect((await loadedData(store, newId, schemas)).studio.features[0]).toMatchObject({
      typeVersion: 2,
      params: { width: 7 },
    });
  });

  describe('rejects a broken file and leaves the store untouched', () => {
    it('not an object', async () => {
      expect(await importError('nope')).toEqual({
        issues: [{ path: '', message: expect.any(String) as unknown }],
      });
    });

    it('wrong format', async () => {
      expect(await importError(fileWith({ format: 'tinycad.snapshot' }))).toMatchObject({
        issues: [{ path: 'format' }],
      });
    });

    it('newer formatVersion says so', async () => {
      const error = await importError(fileWith({ formatVersion: 3 }));
      expect(error).toMatchObject({ issues: [{ path: 'formatVersion' }] });
      expect(JSON.stringify(error)).toMatch(/newer/);
    });

    it('invalid formatVersion', async () => {
      expect(await importError(fileWith({ formatVersion: '1' }))).toMatchObject({
        issues: [{ path: 'formatVersion', message: 'Must be 1 or 2' }],
      });
    });

    it('missing snapshot', async () => {
      expect(await importError(fileWith({ snapshot: undefined }))).toMatchObject({
        issues: [{ path: 'snapshot' }],
      });
    });

    it('wrong snapshot envelope reports paths under snapshot', async () => {
      expect(
        await importError(fileWith({ snapshot: snapshotWith({ format: 'x', formatVersion: 3 }) })),
      ).toMatchObject({
        issues: [{ path: 'snapshot.format' }, { path: 'snapshot.formatVersion' }],
      });
    });

    it('snapshot with atSeq other than 0', async () => {
      expect(await importError(fileWith({ snapshot: snapshotWith({ atSeq: 3 }) }))).toMatchObject({
        issues: [{ path: 'snapshot.atSeq' }],
      });
    });

    it('broken document data reports fromData issues under snapshot.document', async () => {
      const document = { meta: { id: 'x', name: 'X', createdAt: 0 }, studio: 42 };
      expect(await importError(fileWith({ snapshot: snapshotWith({ document }) }))).toMatchObject({
        issues: [{ path: 'snapshot.document.studio' }],
      });
    });
  });
});

describe('importDocument of a version 1 file (M4)', () => {
  it('loads a literal version 1 file', async () => {
    const raw: unknown = {
      format: 'tinycad.file',
      formatVersion: 1,
      snapshot: {
        format: 'tinycad.snapshot',
        formatVersion: 1,
        atSeq: 0,
        document: {
          meta: { id: 'old', name: 'Old part', createdAt: 3 },
          studio: {
            features: [
              {
                id: 'a',
                type: 'box',
                typeVersion: 1,
                name: 'A',
                params: { size: 2 },
                suppressed: false,
              },
            ],
            rollbackIndex: 1,
          },
        },
      },
    };
    const store = createMemoryDocumentStore();

    const meta = await imported(store, raw);

    expect(meta).toEqual({ id: newId, name: 'Old part', createdAt: now });
    expect((await loadedData(store, newId)).studio).toMatchObject({
      features: [{ id: 'a', name: 'A', params: { size: 2 } }],
      rollbackIndex: 1,
    });
  });
});

// --- M15: the file with history ------------------------------------------------------------

const featureA = 'a' as FeatureId;

function rename(name: string, featureId: FeatureId = featureA): FeatureRenameOp {
  return { type: 'feature.rename', v: OP_VERSION['feature.rename'], featureId, name };
}

function add(id: string, index: number): FeatureAddOp {
  return {
    type: 'feature.add',
    v: OP_VERSION['feature.add'],
    feature: aFeature({ id, name: id.toUpperCase() }),
    index,
  };
}

/**
 * A stored document with exactly 30 entries: renames, adds, a batch, undo, redo and an undo
 * followed by a new 'do' (abandoned redo). A snapshot at 20 makes the load use snapshot + rest.
 */
async function aStoredHistory(): Promise<{ store: DocumentStore; session: OpsSession }> {
  const session = anOpsSession({
    meta: { id: sourceId, name: 'Bracket', createdAt: 5 },
    features: [aFeature({ id: 'a', name: 'A' })],
  });
  const { dispatcher, undo, log, doc } = session;
  const store = createMemoryDocumentStore();
  await store.createDocument(doc.meta, createSnapshot(doc, 0));
  let snapshot: DocumentSnapshot | undefined;
  let n = 0;
  while (log.lastSeq < 30) {
    n++;
    switch (n % 6) {
      case 0:
        dispatcher.dispatch(add(`n${String(n)}`, 1));
        break;
      case 1: {
        const batch: BatchOp = {
          type: 'batch',
          v: OP_VERSION.batch,
          ops: [rename(`B${String(n)}`), add(`m${String(n)}`, 0)],
        };
        dispatcher.dispatch(batch);
        break;
      }
      case 2:
        undo.undo();
        break;
      case 3:
        undo.redo();
        break;
      case 4:
        undo.undo();
        break;
      default:
        dispatcher.dispatch(rename(`A${String(n)}`));
    }
    if (log.lastSeq === 20) snapshot = createSnapshot(doc, 20);
  }
  expect(new Set(log.entries().map((e) => e.kind))).toEqual(new Set(['do', 'undo', 'redo']));
  await store.appendEntries(sourceId, log.entries());
  if (snapshot !== undefined) await store.saveSnapshot(sourceId, snapshot);
  return { store, session };
}

const handlers = createOpHandlerRegistry({ schemas: emptySchemas });

async function exportedFile(store: DocumentStore, id: DocumentId = sourceId): Promise<TinycadFile> {
  const result = await exportStoredDocument(store, id, { schemas: emptySchemas, handlers });
  if (!result.ok) expect.fail(`Expected the export to succeed: ${JSON.stringify(result.error)}`);
  return result.value;
}

interface PlainHistoryFile {
  readonly snapshot: Readonly<Record<string, unknown>>;
  readonly history: {
    readonly base: Readonly<Record<string, unknown>>;
    readonly entries: readonly Readonly<Record<string, unknown>>[];
  };
}

/** A valid exported file with history as plain data, ready to be tampered with. */
async function historyFile(): Promise<PlainHistoryFile> {
  const { store } = await aStoredHistory();
  // Plain JSON of a TinycadFile with history has exactly this shape.
  return throughJson(await exportedFile(store)) as PlainHistoryFile;
}

describe('exportStoredDocument', () => {
  it('exports the stored state, the base snapshot and the whole log', async () => {
    const { store, session } = await aStoredHistory();

    const file = await exportedFile(store);

    expect(file.format).toBe('tinycad.file');
    expect(file.formatVersion).toBe(2);
    expect(file.snapshot).toEqual(createSnapshot(session.doc, 30));
    expect(file.history?.base).toMatchObject({ atSeq: 0 });
    expect(file.history?.base.document.studio.features.map((f) => f.name)).toEqual(['A']);
    expect(file.history?.entries).toEqual(session.log.entries());
    expect(Object.isFrozen(file)).toBe(true);
    expect(Object.isFrozen(file.history)).toBe(true);
    expect(Object.isFrozen(file.history?.entries)).toBe(true);
    expect(throughJson(file)).toEqual(file);
  });

  it('an empty log exports an empty history', async () => {
    const store = createMemoryDocumentStore();
    const doc = aSourceDocument();
    await store.createDocument(doc.meta, createSnapshot(doc, 0));

    const file = await exportedFile(store);

    expect(file.snapshot).toEqual(createSnapshot(doc, 0));
    expect(file.history).toEqual({ base: createSnapshot(doc, 0), entries: [] });
  });

  it('unknown id is not-found', async () => {
    const result = await exportStoredDocument(createMemoryDocumentStore(), 'nope' as DocumentId, {
      schemas: emptySchemas,
      handlers,
    });
    expect(result).toEqual({ ok: false, error: { kind: 'not-found' } });
  });

  it('a broken base snapshot is a snapshot error of the base', async () => {
    const { store: inner } = await aStoredHistory();
    const store: DocumentStore = {
      ...inner,
      load: async (id) => {
        const stored = await inner.load(id);
        return stored === undefined ? undefined : { ...stored, base: { format: 'x' } };
      },
    };
    const result = await exportStoredDocument(store, sourceId, { schemas: emptySchemas, handlers });
    expect(result).toMatchObject({ ok: false, error: { kind: 'snapshot', which: 'base' } });
  });
});

describe('importDocument with history', () => {
  it('round trip keeps the state and the undo stacks', async () => {
    const { store: source, session } = await aStoredHistory();
    const store = createMemoryDocumentStore();

    const meta = await imported(store, throughJson(await exportedFile(source)));

    expect(meta).toEqual({ id: newId, name: 'Bracket', createdAt: now });
    const result = await loadDocument(store, newId, {
      schemas: emptySchemas,
      handlers,
      verify: true,
    });
    if (!result.ok) expect.fail(`Expected the document to load: ${JSON.stringify(result.error)}`);
    expect(toData(result.value.doc)).toEqual({ ...toData(session.doc), meta });
    expect(rebuildUndoStacks(result.value.log.entries())).toEqual(session.undo.stacks());
    expect(result.value.log.entries()).toEqual(session.log.entries());
  });

  it('stores the base, the entries and a snapshot at n', async () => {
    const { store: source } = await aStoredHistory();
    const store = createMemoryDocumentStore();
    await imported(store, throughJson(await exportedFile(source)));
    const stored = await store.load(newId);
    expect(stored?.entries).toHaveLength(30);
    expect(stored?.base).toMatchObject({ atSeq: 0, document: { meta: { id: newId } } });
    expect(stored?.snapshot).toMatchObject({ atSeq: 30, document: { meta: { id: newId } } });
  });

  it('an empty history stores only the base', async () => {
    const source = createMemoryDocumentStore();
    const doc = aSourceDocument();
    await source.createDocument(doc.meta, createSnapshot(doc, 0));
    const store = createMemoryDocumentStore();

    const meta = await imported(store, throughJson(await exportedFile(source)));

    const stored = await store.load(newId);
    expect(stored?.entries).toEqual([]);
    expect(stored?.snapshot).toMatchObject({ atSeq: 0 });
    expect(await loadedData(store, newId)).toEqual({ ...toData(doc), meta });
  });

  describe('rejects broken history and leaves the store untouched', () => {
    it('history not an object', async () => {
      const file = await historyFile();
      expect(await importError({ ...file, history: [] })).toMatchObject({
        issues: [{ path: 'history' }],
      });
    });

    it('base with atSeq 1', async () => {
      const file = await historyFile();
      const history = { ...file.history, base: { ...file.history.base, atSeq: 1 } };
      expect(await importError({ ...file, history })).toMatchObject({
        issues: [{ path: 'history.base.atSeq' }],
      });
    });

    it('entries not an array', async () => {
      const file = await historyFile();
      const history = { ...file.history, entries: {} };
      expect(await importError({ ...file, history })).toMatchObject({
        issues: [{ path: 'history.entries' }],
      });
    });

    it('a gap in seq', async () => {
      const file = await historyFile();
      const entries = file.history.entries.filter((_, i) => i !== 4);
      const error = await importError({
        ...file,
        snapshot: { ...file.snapshot, atSeq: entries.length },
        history: { ...file.history, entries },
      });
      expect(error).toMatchObject({ issues: [{ path: 'history.entries[4].seq' }] });
    });

    it('a broken operation in an entry', async () => {
      const file = await historyFile();
      const entries = file.history.entries.map((e, i) =>
        i === 3 ? { ...e, op: { type: 'nope', v: 1 } } : e,
      );
      const error = await importError({ ...file, history: { ...file.history, entries } });
      expect(error.issues).toHaveLength(1);
      expect(error.issues[0]?.path).toMatch(/^history\.entries\[3\]\.op/);
    });

    it('an entry the handler rejects', async () => {
      const file = await historyFile();
      const entries = file.history.entries.map((e, i) =>
        i === 0 ? { ...e, op: rename('X', 'missing' as FeatureId) } : e,
      );
      const error = await importError({ ...file, history: { ...file.history, entries } });
      expect(error).toMatchObject({
        issues: [{ path: 'history.entries[0]', message: expect.any(String) as unknown }],
      });
    });

    it('snapshot.atSeq other than the number of entries', async () => {
      const file = await historyFile();
      const error = await importError({ ...file, snapshot: { ...file.snapshot, atSeq: 29 } });
      expect(error).toMatchObject({ issues: [{ path: 'snapshot.atSeq' }] });
    });

    it('a forged snapshot that the history does not produce', async () => {
      const file = await historyFile();
      const snapshot = snapshotWithStudio(file.snapshot, {
        features: [aFeature({ id: 'forged', name: 'Forged' })],
        rollbackIndex: 1,
      });
      expect(await importError({ ...file, snapshot })).toEqual({
        issues: [{ path: 'history', message: 'Replayed history does not match the snapshot' }],
      });
    });
  });

  it('a failed appendEntries deletes the new document and rejects', async () => {
    const { store: source } = await aStoredHistory();
    const inner = createMemoryDocumentStore();
    const failure = new Error('disk full');
    const store = wrapped(inner, { appendEntries: () => Promise.reject(failure) });

    await expect(
      importDocument(store, throughJson(await exportedFile(source)), {
        schemas: emptySchemas,
        handlers,
        newId,
        now,
      }),
    ).rejects.toBe(failure);
    expect(await inner.listDocuments()).toEqual([]);
  });

  it('a failed cleanup is swallowed and the original error rejects', async () => {
    const { store: source } = await aStoredHistory();
    const inner = createMemoryDocumentStore();
    const failure = new Error('disk full');
    const store = wrapped(inner, {
      appendEntries: () => Promise.reject(failure),
      deleteDocument: () => Promise.reject(new Error('cleanup failed')),
    });

    await expect(
      importDocument(store, throughJson(await exportedFile(source)), {
        schemas: emptySchemas,
        handlers,
        newId,
        now,
      }),
    ).rejects.toBe(failure);
  });
});

function snapshotWithStudio(snapshot: Readonly<Record<string, unknown>>, studio: unknown): unknown {
  // Test data: the document of an exported snapshot is always an object.
  const document = snapshot.document as Readonly<Record<string, unknown>>;
  return { ...snapshot, document: { ...document, studio } };
}

/** `inner` with some methods replaced; the rest delegate (the memory store has methods on a prototype). */
function wrapped(inner: DocumentStore, overrides: Partial<DocumentStore>): DocumentStore {
  return {
    listDocuments: () => inner.listDocuments(),
    createDocument: (meta, initial) => inner.createDocument(meta, initial),
    deleteDocument: (id) => inner.deleteDocument(id),
    appendEntries: (id, entries) => inner.appendEntries(id, entries),
    saveSnapshot: (id, snapshot) => inner.saveSnapshot(id, snapshot),
    load: (id) => inner.load(id),
    ...overrides,
  };
}
