// The optimistic mirror of the document (N63): the document of the last read model plus the
// changes not confirmed yet, over an inner Document of document. Everyone reads it as a
// DocumentReader; only the remote dispatcher writes through writer(). M46 task 1 fixes the
// contract; task 3 implements it.

import type { Subscribable } from '@/core';
import type {
  BodyId,
  BodyMeta,
  DocumentEvents,
  DocumentMeta,
  DocumentReader,
  DocumentWriter,
  FeatureId,
  FeatureInstance,
  PartStudioData,
} from '@/document';
import type { ReadModelData } from '@/remote';

const NOT_IMPLEMENTED = 'MirrorDocument: not implemented (M46 task 3)';

export class MirrorDocument implements DocumentReader {
  constructor(data: ReadModelData['document']) {
    throw new Error(NOT_IMPLEMENTED, { cause: data });
  }

  get meta(): DocumentMeta {
    throw new Error(NOT_IMPLEMENTED);
  }

  get studio(): PartStudioData {
    throw new Error(NOT_IMPLEMENTED);
  }

  get events(): Subscribable<DocumentEvents> {
    throw new Error(NOT_IMPLEMENTED);
  }

  feature(id: FeatureId): FeatureInstance | undefined {
    throw new Error(NOT_IMPLEMENTED, { cause: id });
  }

  indexOf(id: FeatureId): number {
    throw new Error(NOT_IMPLEMENTED, { cause: id });
  }

  bodyMeta(body: BodyId): BodyMeta {
    throw new Error(NOT_IMPLEMENTED, { cause: body });
  }

  /** Replaces the content by the document of a read model; `changed` only on a real change. */
  reset(data: ReadModelData['document']): void {
    throw new Error(NOT_IMPLEMENTED, { cause: data });
  }

  /** The writer for the optimistic application (only the remote dispatcher). */
  writer(): DocumentWriter {
    throw new Error(NOT_IMPLEMENTED);
  }
}
