import { describe, expect, it } from 'vitest';
import { createSequentialIdGenerator } from '@/core';
import { createFeatureSchemaRegistry } from '@/document';
import type { DocumentId } from '@/document';
import { aDocument, aFeature } from '@/document/testing';
import { boxPlugin } from '@/features/box';
import { createOpHandlerRegistry } from '@/ops';
import { createMemoryDocumentStore, exportDocument, loadDocument } from '@/persistence';
import type { DocumentStore } from '@/persistence';
import { acquireDocumentLock } from '@/app/doc-lock';
import {
  createDocumentCatalog,
  createNewDocument,
  deleteDocument,
  importDocumentFile,
  listDocuments,
  renameDocument,
} from '@/app/documents';
import { createPluginRegistries } from '@/app/registries';
import { aFakeLocks, settle } from '@/app/testing';

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

describe('renameDocument (M19.2, D5)', () => {
  async function renameSetup() {
    const env = setup();
    const id = await createNewDocument(env.store, env.deps);
    const { locks, held } = aFakeLocks();
    const deps = { store: env.store, locks, plugins: [boxPlugin], now: () => 5000 };
    return { ...env, id, locks, held, deps };
  }

  async function load(store: DocumentStore, id: DocumentId) {
    const { schemas, handlers } = createPluginRegistries([boxPlugin]);
    const loaded = await loadDocument(store, id, { schemas, handlers, verify: true });
    if (!loaded.ok) throw new Error('not loaded');
    return loaded.value;
  }

  it('renames the stored document: the list and a reload show the trimmed name', async () => {
    const { store, id, deps, advance } = await renameSetup();
    advance(10);
    await renameDocument(deps, id, '  Držák  ');
    expect(await listDocuments(store)).toEqual([
      { meta: { id, name: 'Držák', createdAt: 1000 }, lastSeq: 1, updatedAt: 1010 },
    ]);
    const { doc, log } = await load(store, id);
    expect(doc.meta.name).toBe('Držák');
    expect(log.entries()).toEqual([
      {
        seq: 1,
        kind: 'do',
        op: { type: 'document.rename', v: 1, name: 'Držák' },
        inverse: { type: 'document.rename', v: 1, name: UNTITLED },
        label: 'document.rename',
        time: 5000,
      },
    ]);
  });

  it('appends after the stored log, which stays as it was', async () => {
    const { store, id, deps } = await renameSetup();
    await renameDocument(deps, id, 'First');
    await renameDocument(deps, id, 'Second');
    const { doc, log } = await load(store, id);
    expect(doc.meta.name).toBe('Second');
    expect(log.entries().map((e) => [e.seq, e.op])).toEqual([
      [1, { type: 'document.rename', v: 1, name: 'First' }],
      [2, { type: 'document.rename', v: 1, name: 'Second' }],
    ]);
  });

  it('renames under the lock of the document and releases it after', async () => {
    const { id, deps, held } = await renameSetup();
    await renameDocument(deps, id, 'Part');
    await settle();
    expect(held.size).toBe(0);
  });

  it('refuses a document open in another tab and changes nothing', async () => {
    const { store, id, deps, locks } = await renameSetup();
    const otherTab = await acquireDocumentLock(locks, id);
    await expect(renameDocument(deps, id, 'Part')).rejects.toThrow(/another tab/);
    expect((await listDocuments(store)).map((d) => d.meta.name)).toEqual([UNTITLED]);
    expect((await load(store, id)).log.lastSeq).toBe(0);
    otherTab.dispose();
  });

  it.each([[''], ['   ']])('refuses the empty name %j and changes nothing', async (name) => {
    const { store, id, deps } = await renameSetup();
    await expect(renameDocument(deps, id, name)).rejects.toThrow(/empty/);
    expect((await listDocuments(store)).map((d) => d.meta.name)).toEqual([UNTITLED]);
    expect((await load(store, id)).log.lastSeq).toBe(0);
  });

  it('the same name (also with spaces around it) writes nothing and keeps the time', async () => {
    const { store, id, deps, advance } = await renameSetup();
    advance(10);
    await renameDocument(deps, id, `  ${UNTITLED} `);
    expect(await listDocuments(store)).toEqual([
      { meta: { id, name: UNTITLED, createdAt: 1000 }, lastSeq: 0, updatedAt: 1000 },
    ]);
  });

  it('rejects for a missing document', async () => {
    const { deps } = await renameSetup();
    await expect(renameDocument(deps, 'missing' as DocumentId, 'Part')).rejects.toThrow(/missing/);
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

describe('createDocumentCatalog (M20, A3.5)', () => {
  /** A catalog over the store; `stores` counts the calls of withStore (one store per call). */
  function catalogSetup() {
    const env = setup();
    const { locks } = aFakeLocks();
    let stores = 0;
    const catalog = createDocumentCatalog({
      withStore: (call) => {
        stores += 1;
        return call(env.store);
      },
      locks,
      plugins: [boxPlugin],
      ids: env.deps.ids,
      now: env.deps.now,
      translate,
    });
    return { ...env, locks, catalog, stores: () => stores };
  }

  it('creates, lists, renames and deletes through the store, one store per call', async () => {
    const { catalog, stores } = catalogSetup();
    const id = await catalog.create();
    expect(await catalog.list()).toEqual([
      { meta: { id, name: UNTITLED, createdAt: 1000 }, lastSeq: 0, updatedAt: 1000 },
    ]);
    await catalog.rename(id, 'Držák');
    expect((await catalog.list()).map((d) => d.meta.name)).toEqual(['Držák']);
    await catalog.remove(id);
    expect(await catalog.list()).toEqual([]);
    expect(stores()).toBe(6);
  });

  it('imports a file checked against the plugins', async () => {
    const { catalog } = catalogSetup();
    expect(await catalog.importFile(aBoxFile())).toEqual({ ok: true, value: 'd1' });
    const broken = await catalog.importFile({ format: 'tinycad.file', formatVersion: 3 });
    expect(broken.ok).toBe(false);
  });

  it('refuses to delete or rename a document open in another tab', async () => {
    const { catalog, locks } = catalogSetup();
    const id = await catalog.create();
    const otherTab = await acquireDocumentLock(locks, id);
    await expect(catalog.remove(id)).rejects.toThrow(/another tab/);
    await expect(catalog.rename(id, 'x')).rejects.toThrow(/another tab/);
    otherTab.dispose();
  });
});
