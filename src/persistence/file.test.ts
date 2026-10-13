import { describe, expect, it } from 'vitest';
import { createFeatureSchemaRegistry, toData } from '@/document';
import type {
  DocumentId,
  DocumentLoadError,
  DocumentMeta,
  FeatureSchema,
  FeatureSchemaRegistry,
} from '@/document';
import { aDocument, aFeature } from '@/document/testing';
import { createOpHandlerRegistry } from '@/ops';
import { exportDocument, importDocument } from './file';
import type { TinycadFile } from './file';
import { loadDocument } from './load';
import { createMemoryDocumentStore } from './memory-store';
import { createSnapshot } from './snapshot';
import type { DocumentStore } from './store';

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
  const result = await importDocument(store, raw, { schemas, newId: id, now });
  if (!result.ok) expect.fail(`Expected the import to succeed: ${JSON.stringify(result.error)}`);
  return result.value;
}

/** A failed import must leave the store untouched. */
async function importError(raw: unknown): Promise<DocumentLoadError> {
  const store = createMemoryDocumentStore();
  const result = await importDocument(store, raw, { schemas: emptySchemas, newId, now });
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
      formatVersion: 1,
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
      const error = await importError(fileWith({ formatVersion: 2 }));
      expect(error).toMatchObject({ issues: [{ path: 'formatVersion' }] });
      expect(JSON.stringify(error)).toMatch(/newer/);
    });

    it('invalid formatVersion', async () => {
      expect(await importError(fileWith({ formatVersion: '1' }))).toMatchObject({
        issues: [{ path: 'formatVersion', message: 'Must be 1' }],
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
