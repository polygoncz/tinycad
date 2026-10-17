// The optimistic mirror of the document (N63): the document of the last read model plus the
// changes not confirmed yet, over an inner Document of document. Everyone reads it as a
// DocumentReader; only the remote dispatcher writes through writer().

import { Emitter } from '@/core';
import type { Subscribable, Unsubscribe } from '@/core';
import { createDocument } from '@/document';
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

/**
 * The read model carries no createdAt yet (DocumentView.created_at_ms of N89 is not decoded into
 * ReadModelData), so the mirror has a fixed one. Nothing in the client reads it.
 */
const UNKNOWN_CREATED_AT = 0;

/** Deep equality of plain JSON data (features, params, body metadata). */
function sameJson(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => sameJson(item, b[i]));
  }
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  // Both are plain JSON objects here, so reading them as records is safe.
  const recA = a as Readonly<Record<string, unknown>>;
  const recB = b as Readonly<Record<string, unknown>>;
  return (
    keysA.length === keysB.length &&
    keysA.every((key) => Object.hasOwn(recB, key) && sameJson(recA[key], recB[key]))
  );
}

export class MirrorDocument implements DocumentReader {
  private readonly emitter = new Emitter<DocumentEvents>();
  // Only on/once, not the Emitter itself: a cast back to Emitter must not give emit (Q023).
  readonly events: Subscribable<DocumentEvents> = this.emitter.asSubscribable();
  private inner: DocumentWriter;
  private offInner: Unsubscribe;
  /** Delegates to the current inner document, so it survives every reset. */
  private readonly writerFacade: DocumentWriter;

  constructor(data: ReadModelData['document']) {
    this.inner = MirrorDocument.documentOf(data);
    this.offInner = this.forward(this.inner);
    this.writerFacade = new MirrorWriter(() => this.inner, this.events);
  }

  get meta(): DocumentMeta {
    return this.inner.meta;
  }

  get studio(): PartStudioData {
    return this.inner.studio;
  }

  feature(id: FeatureId): FeatureInstance | undefined {
    return this.inner.feature(id);
  }

  indexOf(id: FeatureId): number {
    return this.inner.indexOf(id);
  }

  bodyMeta(body: BodyId): BodyMeta {
    return this.inner.bodyMeta(body);
  }

  /**
   * Replaces the content by the document of a read model; `changed` only on a real change. A
   * feature equal to the one already shown keeps its object, so the dialog and the tree compare
   * values by identity as with the local document.
   */
  reset(data: ReadModelData['document']): void {
    const current = this.inner;
    const studio = this.shared(data.studio);
    if (
      studio === current.studio &&
      data.name === current.meta.name &&
      data.id === current.meta.id
    ) {
      return;
    }
    this.offInner();
    this.inner = MirrorDocument.documentOf({ ...data, studio });
    this.offInner = this.forward(this.inner);
    this.emitter.emit('changed', { studio: this.inner.studio });
  }

  /** The writer for the optimistic application (only the remote dispatcher). */
  writer(): DocumentWriter {
    return this.writerFacade;
  }

  private static documentOf(data: ReadModelData['document']): DocumentWriter {
    return createDocument({
      meta: { id: data.id, name: data.name, createdAt: UNKNOWN_CREATED_AT },
      studio: data.studio,
    });
  }

  /** `next` with the unchanged parts of the current studio; the current one when all equal. */
  private shared(next: PartStudioData): PartStudioData {
    const current = this.inner.studio;
    const features = next.features.map((f) => {
      const old = this.inner.feature(f.id);
      return old !== undefined && sameJson(old, f) ? old : f;
    });
    const bodies = sameJson(current.bodies, next.bodies) ? current.bodies : next.bodies;
    const sameFeatures =
      features.length === current.features.length &&
      features.every((f, i) => f === current.features[i]);
    if (sameFeatures && bodies === current.bodies && next.rollbackIndex === current.rollbackIndex) {
      return current;
    }
    return {
      features,
      rollbackIndex: next.rollbackIndex,
      ...(bodies === undefined ? {} : { bodies }),
    };
  }

  private forward(doc: DocumentWriter): Unsubscribe {
    return doc.events.on('changed', (e) => {
      this.emitter.emit('changed', e);
    });
  }
}

/**
 * The writer of the mirror: every call goes to the inner document of the moment, which reset
 * replaces; its events are those of the mirror.
 */
class MirrorWriter implements DocumentWriter {
  readonly events: Subscribable<DocumentEvents>;
  private readonly inner: () => DocumentWriter;

  constructor(inner: () => DocumentWriter, events: Subscribable<DocumentEvents>) {
    this.inner = inner;
    this.events = events;
  }

  get meta(): DocumentMeta {
    return this.inner().meta;
  }

  get studio(): PartStudioData {
    return this.inner().studio;
  }

  feature(id: FeatureId): FeatureInstance | undefined {
    return this.inner().feature(id);
  }

  indexOf(id: FeatureId): number {
    return this.inner().indexOf(id);
  }

  bodyMeta(body: BodyId): BodyMeta {
    return this.inner().bodyMeta(body);
  }

  insertFeature(index: number, f: FeatureInstance): void {
    this.inner().insertFeature(index, f);
  }

  removeFeature(id: FeatureId): void {
    this.inner().removeFeature(id);
  }

  replaceFeature(f: FeatureInstance): void {
    this.inner().replaceFeature(f);
  }

  moveFeature(id: FeatureId, toIndex: number): void {
    this.inner().moveFeature(id, toIndex);
  }

  setRollbackIndex(index: number): void {
    this.inner().setRollbackIndex(index);
  }

  setBodyMeta(body: BodyId, meta: BodyMeta): void {
    this.inner().setBodyMeta(body, meta);
  }

  rename(name: string): void {
    this.inner().rename(name);
  }
}
