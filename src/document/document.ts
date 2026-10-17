import type { Subscribable } from '@/core';
import type {
  BodyId,
  BodyMeta,
  DocumentMeta,
  FeatureId,
  FeatureInstance,
  PartStudioData,
} from './model';

// The client only reads the document (ADR 0031): a view over snapshots of the read model of the
// server (snapshot-document.ts). The writer role of ADR 0011 lives in the core (server/src/document).

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

export type DocumentEvents = {
  /** After every actual change. rename sends the unchanged studio; read the new name from meta. */
  changed: { studio: PartStudioData };
};
