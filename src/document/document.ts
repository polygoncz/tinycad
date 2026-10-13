import type { Subscribable } from '@/core';
import type { DocumentMeta, FeatureId, FeatureInstance, PartStudioData } from './model';

// Two role interfaces (ADR 0011): everyone reads, only op handlers in ops write.
// The app hands the DocumentWriter out typed as DocumentReader.

export interface DocumentReader {
  readonly meta: DocumentMeta;
  readonly studio: PartStudioData;
  feature(id: FeatureId): FeatureInstance | undefined;
  /** -1 when the feature does not exist. */
  indexOf(id: FeatureId): number;
  readonly events: Subscribable<DocumentEvents>;
}

// Mutators guard the document invariants and throw on violation (programmer error).
// They do not validate feature params: invalid params are a legitimate document state.
export interface DocumentWriter extends DocumentReader {
  insertFeature(index: number, f: FeatureInstance): void;
  removeFeature(id: FeatureId): void;
  /** Same id, new data. */
  replaceFeature(f: FeatureInstance): void;
  moveFeature(id: FeatureId, toIndex: number): void;
  setRollbackIndex(index: number): void;
  rename(name: string): void;
}

export type DocumentEvents = {
  /** After every actual change. rename sends the unchanged studio; read the new name from meta. */
  changed: { studio: PartStudioData };
};
