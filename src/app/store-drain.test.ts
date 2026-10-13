import { describe, expect, it } from 'vitest';
import { createSequentialIdGenerator } from '@/core';
import type { DocumentId } from '@/document';
import { boxPlugin } from '@/features/box';
import { createMemoryDocumentStore } from '@/persistence';
import type { DocumentStore } from '@/persistence';
import { createManualScheduler } from '@/persistence/testing';
import { createAppSession } from './session';
import { createDrainableStore } from './store-drain';
import { aKernelFactory, FakeAppViewport, settle } from './testing';

// Branded ids are created by a cast at one place in tests.
const DOC = 'doc1' as DocumentId;

/** A store delegating to `inner`, with listDocuments replaced. */
function withList(
  inner: DocumentStore,
  listDocuments: DocumentStore['listDocuments'],
): DocumentStore {
  return {
    listDocuments,
    createDocument: (meta, initial) => inner.createDocument(meta, initial),
    deleteDocument: (id) => inner.deleteDocument(id),
    appendEntries: (id, entries) => inner.appendEntries(id, entries),
    saveSnapshot: (id, snapshot) => inner.saveSnapshot(id, snapshot),
    load: (id) => inner.load(id),
  };
}

/** A store whose listDocuments waits until `release` is called. */
function aSlowStore(): { store: DocumentStore; release: () => void } {
  const inner = createMemoryDocumentStore();
  let release = (): void => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    store: withList(inner, () => gate.then(() => inner.listDocuments())),
    release: () => {
      release();
    },
  };
}

describe('createDrainableStore', () => {
  it('drains at once when nothing runs', async () => {
    const drainable = createDrainableStore(createMemoryDocumentStore());
    await expect(drainable.drained()).resolves.toBeUndefined();
  });

  it('waits for a call in flight', async () => {
    const slow = aSlowStore();
    const drainable = createDrainableStore(slow.store);
    const call = drainable.store.listDocuments();
    let drained = false;
    const done = drainable.drained().then(() => {
      drained = true;
    });
    await settle();
    expect(drained).toBe(false);
    slow.release();
    await done;
    await call;
    expect(drained).toBe(true);
  });

  it('waits for a failing call too', async () => {
    const failing = withList(createMemoryDocumentStore(), () => Promise.reject(new Error('I/O')));
    const drainable = createDrainableStore(failing);
    await expect(drainable.store.listDocuments()).rejects.toThrow('I/O');
    await expect(drainable.drained()).resolves.toBeUndefined();
  });

  it('lets the final flush of a disposed session reach the store', async () => {
    const memory = createMemoryDocumentStore({ now: () => 0 });
    const drainable = createDrainableStore(memory);
    const session = await createAppSession({
      plugins: [boxPlugin],
      store: drainable.store,
      docId: DOC,
      createKernel: aKernelFactory().create,
      viewport: new FakeAppViewport(),
      scheduler: createManualScheduler(),
      now: () => 0,
      ids: createSequentialIdGenerator('f'),
      translate: (key) => key,
      readOnly: false,
    });
    const edit = session.features.create('box');
    edit.commit();
    // No timer ran: only the flush of dispose writes the entry.
    session.dispose();
    await drainable.drained();
    expect((await memory.listDocuments())[0]?.lastSeq).toBe(1);
  });
});
