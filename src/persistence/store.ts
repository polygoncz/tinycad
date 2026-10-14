import type { DocumentId, DocumentMeta } from '@/document';
import { isDocumentRename } from '@/ops';
import type { LogEntry } from '@/ops';
import type { DocumentSnapshot } from './snapshot';

// The DocumentStore port (spec 05, ADR 0011): persistence and loadDocument program against
// this interface; MemoryDocumentStore and the IndexedDB adapter implement it.

export interface DocumentInfo {
  readonly meta: DocumentMeta;
  /** Highest stored seq, 0 = no entries. */
  readonly lastSeq: number;
  /** ms since epoch, the last write to the document. */
  readonly updatedAt: number;
}

/** What the store returns. Data from outside, hence unknown: loadDocument checks the shape. */
export interface StoredDocument {
  /** The snapshot with the highest atSeq. */
  readonly snapshot: unknown;
  /** The snapshot with atSeq 0. */
  readonly base: unknown;
  /** All entries ordered by seq. */
  readonly entries: readonly unknown[];
}

export interface DocumentStore {
  /** Ordered by updatedAt, newest first. */
  listDocuments(): Promise<readonly DocumentInfo[]>;
  /** initial.atSeq must be 0. Existing id → 'already-exists'. */
  createDocument(meta: DocumentMeta, initial: DocumentSnapshot): Promise<void>;
  /** Missing id → nothing happens (idempotent). */
  deleteDocument(id: DocumentId): Promise<void>;
  /**
   * Writes the batch atomically. When an entry of the batch has a document.rename operation,
   * meta.name of the document record takes the name of the last one, in the same write
   * (M19.2, D5), so listDocuments shows the new name.
   */
  appendEntries(id: DocumentId, entries: readonly LogEntry[]): Promise<void>;
  saveSnapshot(id: DocumentId, snapshot: DocumentSnapshot): Promise<void>;
  /** Missing id → undefined (a result, not an error). */
  load(id: DocumentId): Promise<StoredDocument | undefined>;
}

const STORE_ERROR_CODES = [
  'not-found',
  'already-exists',
  'seq-gap',
  'snapshot-ahead',
  'invalid',
] as const;

export type DocumentStoreErrorCode = (typeof STORE_ERROR_CODES)[number];

/**
 * Rejection of a store call. Internal: adapters create it with createStoreError and callers
 * read the code with storeErrorCode, because over core/rpc it arrives as an RpcError.
 */
class DocumentStoreError extends Error {
  override readonly name = 'DocumentStoreError';
  readonly code: DocumentStoreErrorCode;

  constructor(code: DocumentStoreErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

/** Code of a store error, or undefined for any other error (I/O). Works in memory and over RPC. */
export function storeErrorCode(e: unknown): DocumentStoreErrorCode | undefined {
  if (typeof e !== 'object' || e === null || !('code' in e)) return undefined;
  const { code } = e;
  return STORE_ERROR_CODES.find((c) => c === code);
}

/** A store rejection with `code`, for DocumentStore implementations (memory, IndexedDB). */
export function createStoreError(code: DocumentStoreErrorCode, message: string): Error {
  return new DocumentStoreError(code, message);
}

/** Snapshots kept besides the base one (Q009). */
const KEPT_SNAPSHOTS = 3;

/**
 * atSeq values to keep after a snapshot write: the base (0) and the KEPT_SNAPSHOTS highest
 * (Q009). Shared by the store implementations, so the rule lives in one place.
 */
export function snapshotSeqsToKeep(atSeqs: readonly number[]): readonly number[] {
  const newest = atSeqs
    .filter((s) => s !== 0)
    .sort((a, b) => b - a)
    .slice(0, KEPT_SNAPSHOTS);
  return atSeqs.includes(0) ? [0, ...newest] : newest;
}

/**
 * The name the last document.rename of the batch gives the document (M19.2, D5), so the list
 * shows it without loading the log; undefined = the batch does not rename it. Both adapters set
 * DocumentInfo.meta.name by it in appendEntries.
 */
export function renamedTo(entries: readonly LogEntry[]): string | undefined {
  return entries.map((e) => e.op).findLast(isDocumentRename)?.name;
}
