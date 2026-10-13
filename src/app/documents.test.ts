import { describe, expect, it } from 'vitest';
import { createSequentialIdGenerator } from '@/core';
import { createFeatureSchemaRegistry } from '@/document';
import { createOpHandlerRegistry } from '@/ops';
import { createMemoryDocumentStore, loadDocument } from '@/persistence';
import { createNewDocument, deleteDocument, listDocuments } from './documents';

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
    const loaded = await loadDocument(store, id, {
      schemas: createFeatureSchemaRegistry(),
      handlers: createOpHandlerRegistry(),
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
    await deleteDocument(store, removed);
    await deleteDocument(store, removed);
    expect((await listDocuments(store)).map((d) => d.meta.id)).toEqual([kept]);
  });
});
