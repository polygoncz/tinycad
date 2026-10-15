import { assert, Emitter } from '@/core';
import type { Subscribable } from '@/core';
import type { DocumentEvents, DocumentWriter } from './document';
import { deepFreeze } from './freeze';
import { isBodyColor } from './model';
import type {
  BodyId,
  BodyMeta,
  DocumentMeta,
  FeatureId,
  FeatureInstance,
  PartStudioData,
} from './model';

export interface CreateDocumentInit {
  /** Required: the document never invents ids or timestamps itself (determinism). */
  readonly meta: DocumentMeta;
  readonly studio?: PartStudioData;
}

/** The only way to get a document; CadDocument stays inside the module (ADR 0011). */
export function createDocument(init: CreateDocumentInit): DocumentWriter {
  return new CadDocument(init.meta, init.studio ?? { features: [], rollbackIndex: 0 });
}

function assertStudio(studio: PartStudioData): void {
  const seen = new Set<FeatureId>();
  for (const f of studio.features) {
    assert(!seen.has(f.id), `Duplicate feature id '${f.id}'`);
    seen.add(f.id);
  }
  assertRollbackIndex(studio.rollbackIndex, studio.features.length);
}

function assertRollbackIndex(index: number, length: number): void {
  assert(
    Number.isInteger(index) && index >= 0 && index <= length,
    `Rollback index ${String(index)} out of range 0..${String(length)}`,
  );
}

function assertIndex(index: number, max: number): void {
  assert(
    Number.isInteger(index) && index >= 0 && index <= max,
    `Feature index ${String(index)} out of range 0..${String(max)}`,
  );
}

type Bodies = NonNullable<PartStudioData['bodies']>;

/** What bodyMeta gives for a body without metadata: one shared frozen object. */
const NO_META: BodyMeta = Object.freeze({});

/**
 * The canonical form of body metadata (spec 03): name only when non-empty, hidden only as true;
 * undefined when nothing is left. A new frozen object, nothing of `meta` is kept.
 */
function canonicalMeta(meta: BodyMeta): BodyMeta | undefined {
  const name = typeof meta.name === 'string' && meta.name !== '' ? meta.name : undefined;
  const hidden = meta.hidden === true;
  const color = isBodyColor(meta.color) ? meta.color : undefined;
  if (name === undefined && !hidden && color === undefined) return undefined;
  return Object.freeze({
    ...(name === undefined ? {} : { name }),
    ...(hidden ? { hidden } : {}),
    ...(color === undefined ? {} : { color }),
  });
}

function sameMeta(a: BodyMeta | undefined, b: BodyMeta | undefined): boolean {
  return a?.name === b?.name && a?.hidden === b?.hidden && a?.color === b?.color;
}

// Every mutator validates first and then commits a whole new studio in one step,
// so a mutator that fails its checks leaves the document untouched and emits nothing.
// An exception thrown by a `changed` subscriber propagates after the change is done.
class CadDocument implements DocumentWriter {
  private readonly emitter = new Emitter<DocumentEvents>();
  // Only on/once, not the Emitter itself: a cast back to Emitter must not give emit (Q023).
  readonly events: Subscribable<DocumentEvents> = this.emitter.asSubscribable();
  private _meta: DocumentMeta;
  private _studio: PartStudioData;

  constructor(meta: DocumentMeta, studio: PartStudioData) {
    assertStudio(studio);
    this._meta = deepFreeze(meta);
    this._studio = deepFreeze(studio);
  }

  get meta(): DocumentMeta {
    return this._meta;
  }

  get studio(): PartStudioData {
    return this._studio;
  }

  feature(id: FeatureId): FeatureInstance | undefined {
    return this._studio.features.find((f) => f.id === id);
  }

  // Linear scan: tens to hundreds of features, an id map would only add state to keep in sync.
  indexOf(id: FeatureId): number {
    return this._studio.features.findIndex((f) => f.id === id);
  }

  bodyMeta(body: BodyId): BodyMeta {
    const bodies = this._studio.bodies;
    // hasOwn: a key is data, never something inherited from Object.prototype.
    return bodies !== undefined && Object.hasOwn(bodies, body)
      ? (bodies[body] ?? NO_META)
      : NO_META;
  }

  insertFeature(index: number, f: FeatureInstance): void {
    const { features, rollbackIndex } = this._studio;
    assertIndex(index, features.length);
    assert(this.indexOf(f.id) === -1, `Duplicate feature id '${f.id}'`);
    deepFreeze(f);
    // Q029: inserting at the bar makes the new feature active.
    this.commit(
      features.toSpliced(index, 0, f),
      index <= rollbackIndex ? rollbackIndex + 1 : rollbackIndex,
    );
  }

  removeFeature(id: FeatureId): void {
    const index = this.requireIndex(id);
    const { features, rollbackIndex } = this._studio;
    this.commit(
      features.toSpliced(index, 1),
      index < rollbackIndex ? rollbackIndex - 1 : rollbackIndex,
    );
  }

  replaceFeature(f: FeatureInstance): void {
    const index = this.requireIndex(f.id);
    const { features, rollbackIndex } = this._studio;
    if (features[index] === f) return;
    deepFreeze(f);
    // Array.with copies the array but keeps the other elements: structural sharing (ADR 0006).
    this.commit(features.with(index, f), rollbackIndex);
  }

  /** `toIndex` is the final index of the feature: remove at `from`, then insert at `toIndex` (Q029). */
  moveFeature(id: FeatureId, toIndex: number): void {
    const from = this.requireIndex(id);
    const { features, rollbackIndex } = this._studio;
    assertIndex(toIndex, features.length - 1);
    if (from === toIndex) return;
    const f = features[from] as FeatureInstance;
    const afterRemove = from < rollbackIndex ? rollbackIndex - 1 : rollbackIndex;
    const afterInsert = toIndex <= afterRemove ? afterRemove + 1 : afterRemove;
    this.commit(features.toSpliced(from, 1).toSpliced(toIndex, 0, f), afterInsert);
  }

  setRollbackIndex(index: number): void {
    assertRollbackIndex(index, this._studio.features.length);
    if (index === this._studio.rollbackIndex) return;
    this.commit(this._studio.features, index);
  }

  setBodyMeta(body: BodyId, meta: BodyMeta): void {
    const next = canonicalMeta(meta);
    if (sameMeta(canonicalMeta(this.bodyMeta(body)), next)) return;
    const current = this._studio.bodies ?? {};
    // A spread keeps the position of an updated entry; removal filters it out.
    const bodies: Bodies =
      next === undefined
        ? Object.fromEntries(Object.entries(current).filter(([key]) => key !== body))
        : { ...current, [body]: next };
    // Same features and rollback index: the regeneration cache keyed by features stays valid.
    this.commitStudio(
      this._studio.features,
      this._studio.rollbackIndex,
      Object.keys(bodies).length === 0 ? undefined : Object.freeze(bodies),
    );
  }

  rename(name: string): void {
    if (name === this._meta.name) return;
    this._meta = Object.freeze({ ...this._meta, name });
    this.emitter.emit('changed', { studio: this._studio });
  }

  private requireIndex(id: FeatureId): number {
    const index = this.indexOf(id);
    assert(index !== -1, `Unknown feature '${id}'`);
    return index;
  }

  /**
   * Freezes only the new array and studio; their features are already deeply frozen. The body
   * metadata stay as they are (only setBodyMeta changes them); absent when empty (canonical form).
   */
  private commit(features: readonly FeatureInstance[], rollbackIndex: number): void {
    this.commitStudio(features, rollbackIndex, this._studio.bodies);
  }

  private commitStudio(
    features: readonly FeatureInstance[],
    rollbackIndex: number,
    bodies: Bodies | undefined,
  ): void {
    this._studio = Object.freeze({
      features: Object.freeze(features),
      rollbackIndex,
      ...(bodies === undefined ? {} : { bodies }),
    });
    this.emitter.emit('changed', { studio: this._studio });
  }
}
