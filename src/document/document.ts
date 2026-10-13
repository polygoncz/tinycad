import type { Subscribable } from '@/core';
import type {
  BodyId,
  BodyMeta,
  DocumentMeta,
  FeatureId,
  FeatureInstance,
  PartStudioData,
} from './model';

// Two role interfaces (ADR 0011): everyone reads, only op handlers in ops write.
// The app hands the DocumentWriter out typed as DocumentReader.

export interface DocumentReader {
  readonly meta: DocumentMeta;
  readonly studio: PartStudioData;
  feature(id: FeatureId): FeatureInstance | undefined;
  /** -1 when the feature does not exist. */
  indexOf(id: FeatureId): number;
  /** {} (one shared frozen object) for a body without metadata. */
  bodyMeta(body: BodyId): BodyMeta;
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
  /**
   * Stores the metadata in canonical form (spec 03): name only when non-empty, hidden only as
   * true, empty metadata removes the entry. The body need not exist: the document does not know
   * bodies. Keeps the features array and the rollback index; same metadata by value = no change.
   */
  setBodyMeta(body: BodyId, meta: BodyMeta): void;
  rename(name: string): void;
}

export type DocumentEvents = {
  /** After every actual change. rename sends the unchanged studio; read the new name from meta. */
  changed: { studio: PartStudioData };
};
