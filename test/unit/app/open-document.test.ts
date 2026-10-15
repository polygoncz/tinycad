import { describe, expect, it } from 'vitest';
import { createDocument, createFeatureSchemaRegistry } from '@/document';
import type { DocumentId } from '@/document';
import { createOperationDispatcher, createOperationLog, createOpHandlerRegistry } from '@/ops';
import type { DocumentRenameOp } from '@/ops';
import { createMemoryDocumentStore, createSnapshot } from '@/persistence';
import type { DocumentStore } from '@/persistence';
import { openDocument, storeNewDocument } from '@/app/open-document';
import type { OpenDocumentDeps } from '@/app/open-document';

// Branded ids are created by a cast at one place in tests.
const DOC = 'doc1' as DocumentId;
const UNTITLED = 'Bez názvu';

function translate(key: string): string {
  return key === 'document.untitled' ? UNTITLED : key;
}

function deps(overrides: Partial<OpenDocumentDeps> = {}): OpenDocumentDeps {
  const schemas = createFeatureSchemaRegistry();
  return {
    store: createMemoryDocumentStore({ now: () => 0 }),
    docId: DOC,
    schemas,
    handlers: createOpHandlerRegistry({ schemas }),
    readOnly: false,
    verify: false,
    translate,
    now: () => 1234,
    ...overrides,
  };
}

/**
 * A stored document renamed by its one log entry, with a snapshot at seq 1 that still has the
 * old name: the snapshot disagrees with the log.
 */
async function aDocumentWithForeignSnapshot(): Promise<DocumentStore> {
  const store = createMemoryDocumentStore({ now: () => 0 });
  const { handlers } = deps();
  const doc = await storeNewDocument(store, DOC, { translate, now: () => 0 });
  const log = createOperationLog();
  const rename: DocumentRenameOp = { type: 'document.rename', v: 1, name: 'Renamed' };
  createOperationDispatcher({ doc, handlers, log, now: () => 0 }).dispatch(rename);
  await store.appendEntries(DOC, log.entries());
  const meta = { id: DOC, name: UNTITLED, createdAt: 0 };
  await store.saveSnapshot(DOC, createSnapshot(createDocument({ meta }), 1));
  return store;
}

describe('openDocument', () => {
  it('creates a missing document in the store, empty and named by translate', async () => {
    const { store, ...rest } = deps();
    const { doc, log } = await openDocument({ store, ...rest });
    expect(doc.meta).toEqual({ id: DOC, name: UNTITLED, createdAt: 1234 });
    expect(doc.studio.features).toEqual([]);
    expect(log.entries()).toEqual([]);
    const infos = await store.listDocuments();
    expect(infos.map((i) => i.meta)).toEqual([doc.meta]);
  });

  it('opens a stored document', async () => {
    const store = createMemoryDocumentStore({ now: () => 0 });
    await storeNewDocument(store, DOC, { translate: () => 'Stored', now: () => 5 });
    const { doc } = await openDocument(deps({ store }));
    expect(doc.meta).toEqual({ id: DOC, name: 'Stored', createdAt: 5 });
  });

  it('read-only does not create a missing document', async () => {
    const store = createMemoryDocumentStore();
    await expect(openDocument(deps({ store, readOnly: true }))).rejects.toThrow(/doc1/);
    expect(await store.listDocuments()).toEqual([]);
  });

  it('rejects a document the store holds broken data for', async () => {
    const store = createMemoryDocumentStore();
    const broken: DocumentStore = {
      listDocuments: () => store.listDocuments(),
      createDocument: (meta, initial) => store.createDocument(meta, initial),
      deleteDocument: (id) => store.deleteDocument(id),
      appendEntries: (id, entries) => store.appendEntries(id, entries),
      saveSnapshot: (id, snapshot) => store.saveSnapshot(id, snapshot),
      load: () => Promise.resolve({ snapshot: {}, base: {}, entries: [] }),
    };
    await expect(openDocument(deps({ store: broken }))).rejects.toThrow(/doc1/);
  });

  it('hands verify to loadDocument: a snapshot that disagrees with the log fails to open', async () => {
    const store = await aDocumentWithForeignSnapshot();
    await expect(openDocument(deps({ store, verify: true }))).rejects.toThrow(/not deterministic/);
  });

  it('without verify the same document opens from the snapshot', async () => {
    const store = await aDocumentWithForeignSnapshot();
    const { doc } = await openDocument(deps({ store }));
    expect(doc.meta.name).toBe(UNTITLED);
  });
});
