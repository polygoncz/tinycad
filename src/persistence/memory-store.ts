import type { DocumentId, DocumentMeta } from '@/document';
import type { LogEntry } from '@/ops';
import type { DocumentSnapshot } from './snapshot';
import { createStoreError, snapshotSeqsToKeep } from './store';
import type { DocumentInfo, DocumentStore, DocumentStoreErrorCode, StoredDocument } from './store';

/** In-memory DocumentStore: for tests and as the reference implementation of the contract. */
export function createMemoryDocumentStore(deps: { now?: () => number } = {}): DocumentStore {
  return new MemoryDocumentStore(deps.now ?? Date.now);
}

interface StoredRecord {
  meta: DocumentMeta;
  lastSeq: number;
  updatedAt: number;
  /** By seq. */
  readonly entries: Map<number, LogEntry>;
  /** By atSeq. */
  readonly snapshots: Map<number, DocumentSnapshot>;
}

/**
 * A deep copy through JSON, both on the way in and on the way out (data isolation).
 * Stricter than the structured clone of IndexedDB: data that is not plain JSON shows up here.
 */
function copy<T>(value: T): T {
  // JSON.parse returns any; the value went in as a T made of plain JSON.
  return JSON.parse(JSON.stringify(value)) as T;
}

// Every method checks everything before it changes anything, so a rejected call writes
// nothing – the in-memory counterpart of one IndexedDB transaction.
class MemoryDocumentStore implements DocumentStore {
  private readonly docs = new Map<DocumentId, StoredRecord>();

  private readonly now: () => number;

  constructor(now: () => number) {
    this.now = now;
  }

  listDocuments(): Promise<readonly DocumentInfo[]> {
    const list = [...this.docs.values()]
      .map((r): DocumentInfo => ({
        meta: copy(r.meta),
        lastSeq: r.lastSeq,
        updatedAt: r.updatedAt,
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
    return Promise.resolve(list);
  }

  createDocument(meta: DocumentMeta, initial: DocumentSnapshot): Promise<void> {
    if (this.docs.has(meta.id)) {
      return reject('already-exists', `Document '${meta.id}' already exists`);
    }
    if (initial.atSeq !== 0) {
      return reject(
        'invalid',
        `The initial snapshot must have atSeq 0, got ${String(initial.atSeq)}`,
      );
    }
    if (initial.document.meta.id !== meta.id) {
      return reject(
        'invalid',
        `The initial snapshot belongs to '${initial.document.meta.id}', not '${meta.id}'`,
      );
    }
    this.docs.set(meta.id, {
      meta: copy(meta),
      lastSeq: 0,
      updatedAt: this.now(),
      entries: new Map(),
      snapshots: new Map([[0, copy(initial)]]),
    });
    return Promise.resolve();
  }

  deleteDocument(id: DocumentId): Promise<void> {
    this.docs.delete(id);
    return Promise.resolve();
  }

  appendEntries(id: DocumentId, entries: readonly LogEntry[]): Promise<void> {
    const record = this.docs.get(id);
    if (record === undefined) return notFound(id);
    const first = entries[0];
    const last = entries.at(-1);
    if (first === undefined || last === undefined) return Promise.resolve();
    const bad = entries.find((e) => !Number.isInteger(e.seq) || e.seq < 1);
    if (bad !== undefined) {
      return reject('invalid', `Entry seq must be a whole number >= 1, got ${String(bad.seq)}`);
    }
    if (first.seq > record.lastSeq + 1) {
      return reject(
        'seq-gap',
        `Entry ${String(first.seq)} does not follow the last stored entry ${String(record.lastSeq)}`,
      );
    }
    for (let i = 1; i < entries.length; i++) {
      const prev = entries[i - 1];
      const curr = entries[i];
      if (prev !== undefined && curr !== undefined && curr.seq !== prev.seq + 1) {
        return reject(
          'seq-gap',
          `Entry ${String(curr.seq)} does not follow entry ${String(prev.seq)} in the batch`,
        );
      }
    }
    for (const e of entries) record.entries.set(e.seq, copy(e));
    record.lastSeq = Math.max(record.lastSeq, last.seq);
    record.updatedAt = this.now();
    return Promise.resolve();
  }

  saveSnapshot(id: DocumentId, snapshot: DocumentSnapshot): Promise<void> {
    const record = this.docs.get(id);
    if (record === undefined) return notFound(id);
    const { atSeq } = snapshot;
    if (!Number.isInteger(atSeq) || atSeq < 1) {
      return reject('invalid', `Snapshot atSeq must be a whole number >= 1, got ${String(atSeq)}`);
    }
    if (snapshot.document.meta.id !== id) {
      return reject('invalid', `Snapshot belongs to '${snapshot.document.meta.id}', not '${id}'`);
    }
    if (atSeq > record.lastSeq) {
      return reject(
        'snapshot-ahead',
        `Snapshot at ${String(atSeq)} is ahead of the last stored entry ${String(record.lastSeq)}`,
      );
    }
    record.snapshots.set(atSeq, copy(snapshot));
    const keep = new Set(snapshotSeqsToKeep([...record.snapshots.keys()]));
    for (const s of [...record.snapshots.keys()]) if (!keep.has(s)) record.snapshots.delete(s);
    return Promise.resolve();
  }

  load(id: DocumentId): Promise<StoredDocument | undefined> {
    const record = this.docs.get(id);
    if (record === undefined) return Promise.resolve(undefined);
    const latest = Math.max(...record.snapshots.keys());
    const entries = [...record.entries.values()].sort((a, b) => a.seq - b.seq);
    return Promise.resolve({
      snapshot: copy(record.snapshots.get(latest)),
      base: copy(record.snapshots.get(0)),
      entries: copy(entries),
    });
  }
}

function reject(code: DocumentStoreErrorCode, message: string): Promise<never> {
  return Promise.reject(createStoreError(code, message));
}

function notFound(id: DocumentId): Promise<never> {
  return reject('not-found', `Document '${id}' does not exist`);
}
