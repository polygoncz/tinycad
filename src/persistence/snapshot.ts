import { toData } from '@/document';
import type { DocumentData, DocumentReader } from '@/document';

/** Full document state at a point of the log, so opening does not replay the whole log (spec 05). */
export interface DocumentSnapshot {
  readonly format: 'tinycad.snapshot';
  readonly formatVersion: 1;
  /** State after entry atSeq; 0 = before the first entry (the base snapshot). */
  readonly atSeq: number;
  readonly document: DocumentData;
}

/** Synchronous and cheap: toData does not copy, the document is immutable. */
export function createSnapshot(doc: DocumentReader, atSeq: number): DocumentSnapshot {
  return Object.freeze({
    format: 'tinycad.snapshot',
    formatVersion: 1,
    atSeq,
    document: toData(doc),
  });
}
