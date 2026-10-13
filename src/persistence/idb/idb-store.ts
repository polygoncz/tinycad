import type { DocumentId, DocumentMeta } from '@/document';
import type { LogEntry } from '@/ops';
import { createStoreError, snapshotSeqsToKeep } from '@/persistence';
import type { DocumentInfo, DocumentSnapshot, DocumentStore, StoredDocument } from '@/persistence';

// The real IndexedDB DocumentStore (spec 05, "Schéma IndexedDB"). Runs inside the worker but
// knows neither the worker nor RPC, so tests drive it with fake-indexeddb in Node.

const DB_NAME = 'tinycad';
const DB_VERSION = 1;

const DOCUMENTS = 'documents';
const ENTRIES = 'entries';
const SNAPSHOTS = 'snapshots';

/** `documents` store, keyPath 'id'. */
interface DocumentRecord {
  readonly id: DocumentId;
  readonly meta: DocumentMeta;
  readonly lastSeq: number;
  readonly updatedAt: number;
}

/** `entries` store, keyPath ['docId', 'seq']. */
interface EntryRecord {
  readonly docId: DocumentId;
  readonly seq: number;
  readonly entry: LogEntry;
}

/** `snapshots` store, keyPath ['docId', 'atSeq']. */
interface SnapshotRecord {
  readonly docId: DocumentId;
  readonly atSeq: number;
  readonly snapshot: DocumentSnapshot;
}

export function createIdbStoreImpl(deps: {
  indexedDB: IDBFactory;
  now: () => number;
}): DocumentStore {
  return new IdbDocumentStore(deps.indexedDB, deps.now);
}

// Every method is ONE transaction over the stores it needs. The checks (not-found, seq-gap,
// snapshot-ahead) read inside that transaction, so no other call can slip in between the
// check and the write; a rejected call aborts the transaction and writes nothing.
class IdbDocumentStore implements DocumentStore {
  private readonly factory: IDBFactory;
  private readonly now: () => number;
  /**
   * Opened on first use and kept. Forgotten when opening fails or the connection closes, so the
   * next call opens again (spec 05, "Spojení"); otherwise the service's retry could never succeed.
   */
  private db: Promise<IDBDatabase> | undefined;

  constructor(factory: IDBFactory, now: () => number) {
    this.factory = factory;
    this.now = now;
  }

  listDocuments(): Promise<readonly DocumentInfo[]> {
    return this.run([DOCUMENTS], 'readonly', async (tx) => {
      const records = await getAll<DocumentRecord>(tx.objectStore(DOCUMENTS));
      return records
        .map((r): DocumentInfo => ({ meta: r.meta, lastSeq: r.lastSeq, updatedAt: r.updatedAt }))
        .sort((a, b) => b.updatedAt - a.updatedAt);
    });
  }

  createDocument(meta: DocumentMeta, initial: DocumentSnapshot): Promise<void> {
    return this.run([DOCUMENTS, SNAPSHOTS], 'readwrite', async (tx) => {
      const documents = tx.objectStore(DOCUMENTS);
      if ((await getDocument(documents, meta.id)) !== undefined) {
        throw createStoreError('already-exists', `Document '${meta.id}' already exists`);
      }
      if (initial.atSeq !== 0) {
        throw createStoreError(
          'invalid',
          `The initial snapshot must have atSeq 0, got ${String(initial.atSeq)}`,
        );
      }
      if (initial.document.meta.id !== meta.id) {
        throw createStoreError(
          'invalid',
          `The initial snapshot belongs to '${initial.document.meta.id}', not '${meta.id}'`,
        );
      }
      const record: DocumentRecord = { id: meta.id, meta, lastSeq: 0, updatedAt: this.now() };
      const base: SnapshotRecord = { docId: meta.id, atSeq: 0, snapshot: initial };
      await Promise.all([
        promised(documents.put(record)),
        promised(tx.objectStore(SNAPSHOTS).put(base)),
      ]);
    });
  }

  deleteDocument(id: DocumentId): Promise<void> {
    return this.run([DOCUMENTS, ENTRIES, SNAPSHOTS], 'readwrite', async (tx) => {
      const range = rangeOf(id);
      await Promise.all([
        promised(tx.objectStore(DOCUMENTS).delete(id)),
        promised(tx.objectStore(ENTRIES).delete(range)),
        promised(tx.objectStore(SNAPSHOTS).delete(range)),
      ]);
    });
  }

  appendEntries(id: DocumentId, entries: readonly LogEntry[]): Promise<void> {
    return this.run([DOCUMENTS, ENTRIES], 'readwrite', async (tx) => {
      const documents = tx.objectStore(DOCUMENTS);
      const record = await requireDocument(documents, id);
      const first = entries[0];
      const last = entries.at(-1);
      if (first === undefined || last === undefined) return;
      const bad = entries.find((e) => !Number.isInteger(e.seq) || e.seq < 1);
      if (bad !== undefined) {
        throw createStoreError(
          'invalid',
          `Entry seq must be a whole number >= 1, got ${String(bad.seq)}`,
        );
      }
      if (first.seq > record.lastSeq + 1) {
        throw createStoreError(
          'seq-gap',
          `Entry ${String(first.seq)} does not follow the last stored entry ${String(record.lastSeq)}`,
        );
      }
      for (let i = 1; i < entries.length; i++) {
        const prev = entries[i - 1];
        const curr = entries[i];
        if (prev !== undefined && curr !== undefined && curr.seq !== prev.seq + 1) {
          throw createStoreError(
            'seq-gap',
            `Entry ${String(curr.seq)} does not follow entry ${String(prev.seq)} in the batch`,
          );
        }
      }
      const store = tx.objectStore(ENTRIES);
      const updated: DocumentRecord = {
        ...record,
        lastSeq: Math.max(record.lastSeq, last.seq),
        updatedAt: this.now(),
      };
      await Promise.all([
        ...entries.map((entry) => {
          const row: EntryRecord = { docId: id, seq: entry.seq, entry };
          return promised(store.put(row));
        }),
        promised(documents.put(updated)),
      ]);
    });
  }

  saveSnapshot(id: DocumentId, snapshot: DocumentSnapshot): Promise<void> {
    return this.run([DOCUMENTS, SNAPSHOTS], 'readwrite', async (tx) => {
      const record = await requireDocument(tx.objectStore(DOCUMENTS), id);
      const { atSeq } = snapshot;
      if (!Number.isInteger(atSeq) || atSeq < 1) {
        throw createStoreError(
          'invalid',
          `Snapshot atSeq must be a whole number >= 1, got ${String(atSeq)}`,
        );
      }
      if (snapshot.document.meta.id !== id) {
        throw createStoreError(
          'invalid',
          `Snapshot belongs to '${snapshot.document.meta.id}', not '${id}'`,
        );
      }
      if (atSeq > record.lastSeq) {
        throw createStoreError(
          'snapshot-ahead',
          `Snapshot at ${String(atSeq)} is ahead of the last stored entry ${String(record.lastSeq)}`,
        );
      }
      const snapshots = tx.objectStore(SNAPSHOTS);
      const row: SnapshotRecord = { docId: id, atSeq, snapshot };
      await promised(snapshots.put(row));
      // Pruning (Q009) in the same transaction as the write.
      const stored = (await getAllKeys(snapshots, rangeOf(id))).map(atSeqOf);
      const keep = new Set(snapshotSeqsToKeep(stored));
      await Promise.all(
        stored.filter((s) => !keep.has(s)).map((s) => promised(snapshots.delete([id, s]))),
      );
    });
  }

  load(id: DocumentId): Promise<StoredDocument | undefined> {
    return this.run([DOCUMENTS, ENTRIES, SNAPSHOTS], 'readonly', async (tx) => {
      if ((await getDocument(tx.objectStore(DOCUMENTS), id)) === undefined) return undefined;
      const range = rangeOf(id);
      const [entries, snapshots] = await Promise.all([
        getAll<EntryRecord>(tx.objectStore(ENTRIES), range),
        getAll<SnapshotRecord>(tx.objectStore(SNAPSHOTS), range),
      ]);
      // Composite keys keep both lists ordered: entries by seq, snapshots by atSeq.
      return {
        snapshot: snapshots.at(-1)?.snapshot,
        base: snapshots.find((s) => s.atSeq === 0)?.snapshot,
        entries: entries.map((e) => e.entry),
      };
    });
  }

  /**
   * Runs `body` in one transaction and resolves once the transaction has committed. When
   * `body` throws (a rejected contract check), the transaction is aborted.
   */
  private async run<T>(
    stores: readonly string[],
    mode: IDBTransactionMode,
    body: (tx: IDBTransaction) => Promise<T>,
  ): Promise<T> {
    const db = await this.open();
    const tx = db.transaction(stores, mode);
    const committed = completion(tx);
    try {
      const result = await body(tx);
      await committed;
      return result;
    } catch (e) {
      // The abort is reported through `committed`; the original error is the one that matters.
      committed.catch(() => undefined);
      abort(tx);
      throw e;
    }
  }

  private open(): Promise<IDBDatabase> {
    if (this.db !== undefined) return this.db;
    const opening = openDatabase(this.factory).then((db) => {
      // An upgrade or delete in another tab waits for this connection: close it and let go.
      db.onversionchange = () => {
        db.close();
        this.forget(opening);
      };
      // The browser closed the connection on its own (e.g. site data cleared).
      db.onclose = () => {
        this.forget(opening);
      };
      return db;
    });
    opening.catch(() => {
      this.forget(opening);
    });
    this.db = opening;
    return opening;
  }

  /** Only the connection it belongs to: a newer one may already be opening. */
  private forget(connection: Promise<IDBDatabase>): void {
    if (this.db === connection) this.db = undefined;
  }
}

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    // A throwing open() rejects this promise: the executor catches it.
    const request = factory.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      upgrade(request.result, event.oldVersion);
    };
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(request.error ?? new Error(`Cannot open IndexedDB '${DB_NAME}'`));
    };
  });
}

/** Creates the object stores. A future schema change = a new DB_VERSION and a step here. */
function upgrade(db: IDBDatabase, oldVersion: number): void {
  if (oldVersion < 1) {
    db.createObjectStore(DOCUMENTS, { keyPath: 'id' });
    db.createObjectStore(ENTRIES, { keyPath: ['docId', 'seq'] });
    db.createObjectStore(SNAPSHOTS, { keyPath: ['docId', 'atSeq'] });
  }
}

/** All keys [id, n] of one document in `entries` or `snapshots`. Infinity is a valid key. */
function rangeOf(id: DocumentId): IDBKeyRange {
  return IDBKeyRange.bound([id, 0], [id, Infinity]);
}

/** The atSeq part of a `snapshots` key [docId, atSeq]. */
function atSeqOf(key: IDBValidKey): number {
  const atSeq: unknown = Array.isArray(key) ? key[1] : undefined;
  if (typeof atSeq !== 'number') throw new Error(`Unexpected snapshot key ${JSON.stringify(key)}`);
  return atSeq;
}

async function getDocument(
  documents: IDBObjectStore,
  id: DocumentId,
): Promise<DocumentRecord | undefined> {
  const record: unknown = await promised(documents.get(id));
  // The store holds only records this module wrote.
  return record as DocumentRecord | undefined;
}

async function requireDocument(documents: IDBObjectStore, id: DocumentId): Promise<DocumentRecord> {
  const record = await getDocument(documents, id);
  if (record === undefined) throw createStoreError('not-found', `Document '${id}' does not exist`);
  return record;
}

async function getAll<T>(store: IDBObjectStore, range?: IDBKeyRange): Promise<readonly T[]> {
  const records: unknown[] = await promised(store.getAll(range));
  // The store holds only records this module wrote, of the type the caller names.
  return records as T[];
}

function getAllKeys(store: IDBObjectStore, range: IDBKeyRange): Promise<IDBValidKey[]> {
  return promised(store.getAllKeys(range));
}

/** A request as a promise. Safe inside a transaction: promise callbacks run as microtasks. */
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

function completion(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => {
      resolve();
    };
    tx.onerror = () => {
      reject(tx.error ?? new Error('IndexedDB transaction failed'));
    };
    tx.onabort = () => {
      reject(tx.error ?? new Error('IndexedDB transaction aborted'));
    };
  });
}

function abort(tx: IDBTransaction): void {
  try {
    tx.abort();
  } catch {
    // Already committed or aborted (a failed request aborts it on its own): nothing to undo.
  }
}
