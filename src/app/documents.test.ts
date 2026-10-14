import { describe, expect, it } from 'vitest';
import { createSequentialIdGenerator } from '@/core';
import { createFeatureSchemaRegistry } from '@/document';
import type { DocumentId } from '@/document';
import { aDocument, aFeature } from '@/document/testing';
import { boxPlugin } from '@/features/box';
import { createOpHandlerRegistry } from '@/ops';
import { createMemoryDocumentStore, exportDocument, loadDocument } from '@/persistence';
import { acquireDocumentLock } from './doc-lock';
import { createNewDocument, deleteDocument, importDocumentFile, listDocuments } from './documents';
import { createPluginRegistries } from './registries';
import { aFakeLocks, settle } from './testing';

const UNTITLED = 'Bez názvu';

function translate(key: string): string {
  return key === 'document.untitled' ? UNTITLED : key;
}

function setup() {
  let time = 1000;
  const store = createMemoryDocumentStore({ now: () => time });
  const deps = { ids: createSequentialIdGenerator('d'), now: () => time, translate };
  return {
    store,
    deps,
    advance: (ms: number) => {
      time += ms;
    },
  };
}

describe('documents', () => {
  it('lists nothing in an empty store', async () => {
    const { store } = setup();
    expect(await listDocuments(store)).toEqual([]);
  });

  it('creates a new document with the translated untitled name, listed and loadable', async () => {
    const { store, deps } = setup();
    const id = await createNewDocument(store, deps);
    expect(id).toBe('d1');
    expect(await listDocuments(store)).toEqual([
      { meta: { id, name: UNTITLED, createdAt: 1000 }, lastSeq: 0, updatedAt: 1000 },
    ]);
    const schemas = createFeatureSchemaRegistry();
    const loaded = await loadDocument(store, id, {
      schemas,
      handlers: createOpHandlerRegistry({ schemas }),
    });
    expect(loaded.ok).toBe(true);
  });

  it('gives every new document its own id, newest first in the list', async () => {
    const { store, deps, advance } = setup();
    const first = await createNewDocument(store, deps);
    advance(10);
    const second = await createNewDocument(store, deps);
    expect(first).not.toBe(second);
    expect((await listDocuments(store)).map((d) => d.meta.id)).toEqual([second, first]);
  });

  it('deletes a document; deleting a missing one does nothing', async () => {
    const { store, deps } = setup();
    const kept = await createNewDocument(store, deps);
    const removed = await createNewDocument(store, deps);
    const { locks } = aFakeLocks();
    await deleteDocument({ store, locks }, removed);
    await deleteDocument({ store, locks }, removed);
    expect((await listDocuments(store)).map((d) => d.meta.id)).toEqual([kept]);
  });

  it('deletes under the lock of the document and releases it after', async () => {
    const { store, deps } = setup();
    const id = await createNewDocument(store, deps);
    const { locks, held, requests } = aFakeLocks();
    await deleteDocument({ store, locks }, id);
    await settle();
    expect(requests).toEqual([{ name: `tinycad-doc-${id}`, ifAvailable: true }]);
    expect(held.size).toBe(0);
  });

  it('refuses to delete a document open in another tab', async () => {
    const { store, deps } = setup();
    const id = await createNewDocument(store, deps);
    const { locks } = aFakeLocks();
    const otherTab = await acquireDocumentLock(locks, id);

    await expect(deleteDocument({ store, locks }, id)).rejects.toThrow(/another tab/);
    expect((await listDocuments(store)).map((d) => d.meta.id)).toEqual([id]);

    otherTab.dispose();
    await settle();
    await deleteDocument({ store, locks }, id);
    expect(await listDocuments(store)).toEqual([]);
  });
});

/** A document file with one box, as JSON.parse gives it back (ui parses the text). */
function aBoxFile(): unknown {
  const doc = aDocument({
    // Branded id: a test value.
    meta: { id: 'src' as DocumentId, name: 'Držák', createdAt: 5 },
    features: [aFeature({ id: 'b1', type: 'box', params: boxPlugin.schema.defaults() })],
  });
  return JSON.parse(JSON.stringify(exportDocument(doc)));
}

describe('importDocumentFile', () => {
  it('stores the file as a new document with a new id and returns the id', async () => {
    const { store, deps } = setup();
    const result = await importDocumentFile(store, aBoxFile(), {
      plugins: [boxPlugin],
      ids: deps.ids,
      now: deps.now,
    });
    expect(result).toEqual({ ok: true, value: 'd1' });
    expect(await listDocuments(store)).toEqual([
      { meta: { id: 'd1', name: 'Držák', createdAt: 1000 }, lastSeq: 0, updatedAt: 1000 },
    ]);
    const { schemas, handlers } = createPluginRegistries([boxPlugin]);
    const loaded = await loadDocument(store, 'd1' as DocumentId, { schemas, handlers });
    if (!loaded.ok) throw new Error('not loaded');
    expect(loaded.value.doc.studio.features.map((f) => f.id)).toEqual(['b1']);
  });

  it('a broken file is an error with issues and stores nothing', async () => {
    const { store, deps } = setup();
    const result = await importDocumentFile(
      store,
      { format: 'tinycad.file', formatVersion: 3 },
      { plugins: [boxPlugin], ids: deps.ids, now: deps.now },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.issues.map((i) => i.path)).toContain('formatVersion');
    expect(await listDocuments(store)).toEqual([]);
  });
});
