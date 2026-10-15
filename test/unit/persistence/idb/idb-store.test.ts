import { forceCloseDatabase, IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRpcClient, serveRpc } from '@/core';
import type { DocumentId, DocumentMeta, FeatureId } from '@/document';
import { aFeature } from '@/document/testing';
import { OP_VERSION } from '@/ops';
import type { FeatureRenameOp, LogEntry } from '@/ops';
import { anOpsSession } from '@/ops/testing';
import { createSnapshot, storeErrorCode } from '@/persistence';
import type { DocumentSnapshot, DocumentStore } from '@/persistence';
import { describeDocumentStoreContract } from '@/persistence/testing';
import { createDocumentStoreClient } from '@/persistence/idb/client';
import { createIdbStoreImpl } from '@/persistence/idb/idb-store';
import type { DocumentStoreProtocol } from '@/persistence/idb/protocol';

const ports: MessagePort[] = [];

beforeEach(() => {
  // The adapter uses the global IDBKeyRange, as in a worker. It is stateless, so sharing it
  // between tests is safe; every test still gets its own IDBFactory (its own databases).
  vi.stubGlobal('IDBKeyRange', IDBKeyRange);
});

afterEach(() => {
  // Open ports keep Node's event loop alive and Vitest would never finish.
  for (const p of ports.splice(0)) p.close();
  vi.unstubAllGlobals();
});

/** The IndexedDB store behind real core/rpc over a Node MessageChannel, as with a worker. */
function connect(indexedDB: IDBFactory, now: () => number): DocumentStore {
  const { port1, port2 } = new MessageChannel();
  ports.push(port1, port2);
  serveRpc<DocumentStoreProtocol>(port1, createIdbStoreImpl({ indexedDB, now }));
  return createDocumentStoreClient(createRpcClient<DocumentStoreProtocol>(port2));
}

describeDocumentStoreContract('IdbDocumentStore', ({ now }) =>
  Promise.resolve(connect(new IDBFactory(), now)),
);

// Branded ids are created by a cast at one place in tests.
const docId = (s: string): DocumentId => s as DocumentId;
const featureA = 'a' as FeatureId;

function metaOf(id: string): DocumentMeta {
  return { id: docId(id), name: `Doc ${id}`, createdAt: 0 };
}

/** `count` log entries of document `id` and the snapshot after each: snapshots[0] is the base. */
function aHistory(
  id: string,
  count: number,
): { entries: readonly LogEntry[]; snapshots: readonly DocumentSnapshot[] } {
  const session = anOpsSession({ meta: metaOf(id), features: [aFeature({ id: 'a', name: 'A' })] });
  const snapshots = [createSnapshot(session.doc, 0)];
  for (let n = 1; n <= count; n++) {
    const rename: FeatureRenameOp = {
      type: 'feature.rename',
      v: OP_VERSION['feature.rename'],
      featureId: featureA,
      name: `A${String(n)}`,
    };
    session.dispatcher.dispatch(rename);
    snapshots.push(createSnapshot(session.doc, n));
  }
  return { entries: session.log.entries(), snapshots };
}

function nth<T>(list: readonly T[], i: number): T {
  const item = list[i];
  if (item === undefined) expect.fail(`Fixture has no item ${String(i)}`);
  return item;
}

function promised<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(request.error ?? new Error('IndexedDB request failed'));
    };
  });
}

/** All primary keys of an object store, read directly from the fake database. */
async function keysOf(indexedDB: IDBFactory, storeName: string): Promise<readonly IDBValidKey[]> {
  const db = await promised(indexedDB.open('tinycad'));
  try {
    return await promised(db.transaction(storeName).objectStore(storeName).getAllKeys());
  } finally {
    db.close();
  }
}

describe('IdbDocumentStore adapter', () => {
  let indexedDB: IDBFactory;
  let store: DocumentStore;

  beforeEach(() => {
    indexedDB = new IDBFactory();
    store = connect(indexedDB, () => 1000);
  });

  it('keeps the base snapshot and the 3 newest ones in the database (Q009)', async () => {
    const { entries, snapshots } = aHistory('d1', 6);
    await store.createDocument(metaOf('d1'), nth(snapshots, 0));
    await store.appendEntries(docId('d1'), entries);
    for (const n of [2, 5, 1, 6, 3]) await store.saveSnapshot(docId('d1'), nth(snapshots, n));

    expect(await keysOf(indexedDB, 'snapshots')).toEqual([
      ['d1', 0],
      ['d1', 3],
      ['d1', 5],
      ['d1', 6],
    ]);
  });

  it('pruning touches only the snapshots of the saved document', async () => {
    const one = aHistory('d1', 5);
    const two = aHistory('d2', 1);
    await store.createDocument(metaOf('d1'), nth(one.snapshots, 0));
    await store.createDocument(metaOf('d2'), nth(two.snapshots, 0));
    await store.appendEntries(docId('d1'), one.entries);
    await store.appendEntries(docId('d2'), two.entries);
    await store.saveSnapshot(docId('d2'), nth(two.snapshots, 1));
    for (let n = 1; n <= 5; n++) await store.saveSnapshot(docId('d1'), nth(one.snapshots, n));

    expect(await keysOf(indexedDB, 'snapshots')).toEqual([
      ['d1', 0],
      ['d1', 3],
      ['d1', 4],
      ['d1', 5],
      ['d2', 0],
      ['d2', 1],
    ]);
  });

  it('the error code survives the RPC hop', async () => {
    const failed = await store.appendEntries(docId('missing'), []).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(failed).toBeInstanceOf(Error);
    expect(storeErrorCode(failed)).toBe('not-found');
  });

  it('a rejected batch leaves no entry in the database', async () => {
    const { entries, snapshots } = aHistory('d1', 4);
    await store.createDocument(metaOf('d1'), nth(snapshots, 0));
    const broken = [nth(entries, 0), nth(entries, 1), nth(entries, 3)];
    await expect(store.appendEntries(docId('d1'), broken)).rejects.toMatchObject({
      code: 'seq-gap',
    });
    expect(await keysOf(indexedDB, 'entries')).toEqual([]);
  });

  it('checks seq inside the write transaction: concurrent batches apply in call order', async () => {
    // Directly on the implementation: serveRpc would serialize the calls itself.
    const impl = createIdbStoreImpl({ indexedDB, now: () => 1000 });
    const { entries, snapshots } = aHistory('d1', 3);
    await impl.createDocument(metaOf('d1'), nth(snapshots, 0));

    // Started together: a check outside the transaction would see lastSeq 0 for both.
    await Promise.all([
      impl.appendEntries(docId('d1'), entries.slice(0, 2)),
      impl.appendEntries(docId('d1'), entries.slice(2)),
    ]);

    expect((await impl.listDocuments())[0]?.lastSeq).toBe(3);
    expect((await impl.load(docId('d1')))?.entries).toEqual(entries);
  });

  it('deleting a document removes its entries and snapshots from the database', async () => {
    const { entries, snapshots } = aHistory('d1', 2);
    await store.createDocument(metaOf('d1'), nth(snapshots, 0));
    await store.appendEntries(docId('d1'), entries);
    await store.saveSnapshot(docId('d1'), nth(snapshots, 2));
    await store.deleteDocument(docId('d1'));

    expect(await keysOf(indexedDB, 'documents')).toEqual([]);
    expect(await keysOf(indexedDB, 'entries')).toEqual([]);
    expect(await keysOf(indexedDB, 'snapshots')).toEqual([]);
  });
});

/** Resolves with the request's result, or rejects when it is blocked by an open connection. */
function settledOpen(request: IDBOpenDBRequest): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(request.error ?? new Error('open failed'));
    };
    request.onblocked = () => {
      reject(new Error('blocked by an open connection'));
    };
  });
}

/**
 * fake-indexeddb whose `open` throws the first `failures` times and which remembers every
 * connection it opened, so a test can simulate the browser closing one.
 */
class FlakyFactory extends IDBFactory {
  failures = 0;
  readonly opened: IDBDatabase[] = [];

  override open(name: string, version?: number): IDBOpenDBRequest {
    if (this.failures > 0) {
      this.failures--;
      throw new Error('open failed');
    }
    const request = super.open(name, version);
    request.addEventListener('success', () => {
      this.opened.push(request.result);
    });
    return request;
  }
}

/** fake-indexeddb's forced close: the connection closes for an abnormal reason, `close` fires. */
function forceClose(db: IDBDatabase): void {
  // Its types.d.ts declares the parameter as `typeof FDBDatabase` (the class), but the function
  // takes a connection instance, as its README shows.
  const close = forceCloseDatabase as unknown as (connection: IDBDatabase) => void;
  close(db);
}

describe('IdbDocumentStore connection', () => {
  let factory: FlakyFactory;
  let store: DocumentStore;
  const { snapshots } = aHistory('d1', 0);
  const base = nth(snapshots, 0);
  const base2 = createSnapshot(anOpsSession({ meta: metaOf('d2') }).doc, 0);

  beforeEach(() => {
    factory = new FlakyFactory();
    // Directly on the implementation: the connection lives there, not in RPC.
    store = createIdbStoreImpl({ indexedDB: factory, now: () => 1000 });
  });

  it('a failed open is not kept: the next call opens again', async () => {
    factory.failures = 1;
    await expect(store.listDocuments()).rejects.toThrow('open failed');
    await store.createDocument(metaOf('d1'), base);
    expect((await store.listDocuments()).map((d) => d.meta.id)).toEqual(['d1']);
  });

  it('closes on versionchange, so an upgrade in another tab is not blocked', async () => {
    await store.createDocument(metaOf('d1'), base);
    const upgraded = await settledOpen(factory.open('tinycad', 2));
    expect(upgraded.version).toBe(2);
    upgraded.close();
  });

  it('after versionchange the next call opens the database again', async () => {
    await store.createDocument(metaOf('d1'), base);
    // Deleting the database fires versionchange on open connections, like an upgrade does.
    await new Promise<void>((resolve, reject) => {
      const request = factory.deleteDatabase('tinycad');
      request.onsuccess = () => {
        resolve();
      };
      request.onerror = () => {
        reject(request.error ?? new Error('delete failed'));
      };
      request.onblocked = () => {
        reject(new Error('blocked by an open connection'));
      };
    });
    await store.createDocument(metaOf('d2'), base2);
    expect((await store.listDocuments()).map((d) => d.meta.id)).toEqual(['d2']);
    expect(factory.opened).toHaveLength(2);
  });

  it('after the browser closes the connection the next call opens it again', async () => {
    await store.createDocument(metaOf('d1'), base);
    // A forced close (e.g. site data cleared in DevTools): the connection closes, `close` fires.
    forceClose(nth(factory.opened, 0));
    await store.createDocument(metaOf('d2'), base2);
    expect((await store.listDocuments()).map((d) => d.meta.id).sort()).toEqual(['d1', 'd2']);
    expect(factory.opened).toHaveLength(2);
  });
});
