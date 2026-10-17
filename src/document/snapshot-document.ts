// The document of the client (N165): a read-only view over immutable snapshots of the read model
// of the server. The client changes nothing in it; it only replaces the snapshot with the next
// read model. Two faces: `reader` (a DocumentReader for everyone) and `replace` for the one place
// that follows the read model (app).

import { Emitter } from '@/core';
import type { Subscribable } from '@/core';
import type { DocumentEvents, DocumentReader } from './document';
import { deepFreeze } from './freeze';
import type {
  BodyId,
  BodyMeta,
  DocumentMeta,
  FeatureId,
  FeatureInstance,
  PartStudioData,
} from './model';

/** The document of one read model. */
export interface DocumentSnapshot {
  readonly meta: DocumentMeta;
  readonly studio: PartStudioData;
}

export interface SnapshotDocument {
  /** The read-only view for everyone; an object of its own, so a cast of it never reaches replace. */
  readonly reader: DocumentReader;
  /**
   * Replaces the snapshot. A feature equal to the one shown (deep JSON equality) stays the same
   * object, and so do the bodies and the whole studio; `changed` only on a real change of the meta
   * or the studio.
   */
  replace(next: DocumentSnapshot): void;
}

export function createSnapshotDocument(initial: DocumentSnapshot): SnapshotDocument {
  const holder = new SnapshotHolder(initial);
  return {
    reader: holder.reader,
    replace(next) {
      holder.replace(next);
    },
  };
}

/** What bodyMeta gives for a body without metadata: one shared frozen object. */
const NO_META: BodyMeta = Object.freeze({});

/** Owns the current snapshot and its events. */
class SnapshotHolder {
  readonly reader: DocumentReader;
  private readonly emitter = new Emitter<DocumentEvents>();
  private current: DocumentSnapshot;

  constructor(initial: DocumentSnapshot) {
    this.current = deepFreeze({ meta: { ...initial.meta }, studio: initial.studio });
    // Only on/once, not the Emitter itself: a cast back to Emitter must not give emit (Q023).
    this.reader = new SnapshotReader(() => this.current, this.emitter.asSubscribable());
  }

  replace(next: DocumentSnapshot): void {
    const studio = this.shared(next.studio);
    const meta = this.current.meta;
    const sameMeta =
      next.meta.id === meta.id &&
      next.meta.name === meta.name &&
      next.meta.createdAt === meta.createdAt;
    if (sameMeta && studio === this.current.studio) return;
    this.current = deepFreeze({ meta: sameMeta ? meta : { ...next.meta }, studio });
    this.emitter.emit('changed', { studio });
  }

  /** `next` with the unchanged parts of the current studio; the current one when all equal. */
  private shared(next: PartStudioData): PartStudioData {
    const current = this.current.studio;
    const features = next.features.map((f) => {
      const old = current.features.find((o) => o.id === f.id);
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
}

/** The reading face: every call reads the snapshot of the moment. */
class SnapshotReader implements DocumentReader {
  readonly events: Subscribable<DocumentEvents>;
  private readonly snapshot: () => DocumentSnapshot;

  constructor(snapshot: () => DocumentSnapshot, events: Subscribable<DocumentEvents>) {
    this.snapshot = snapshot;
    this.events = events;
  }

  get meta(): DocumentMeta {
    return this.snapshot().meta;
  }

  get studio(): PartStudioData {
    return this.snapshot().studio;
  }

  feature(id: FeatureId): FeatureInstance | undefined {
    return this.snapshot().studio.features.find((f) => f.id === id);
  }

  // Linear scan: tens to hundreds of features, an id map would only add state to keep in sync.
  indexOf(id: FeatureId): number {
    return this.snapshot().studio.features.findIndex((f) => f.id === id);
  }

  bodyMeta(body: BodyId): BodyMeta {
    const bodies = this.snapshot().studio.bodies;
    // hasOwn: a key is data, never something inherited from Object.prototype.
    return bodies !== undefined && Object.hasOwn(bodies, body)
      ? (bodies[body] ?? NO_META)
      : NO_META;
  }
}

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
