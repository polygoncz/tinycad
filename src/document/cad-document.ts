import { assert, Emitter } from '@/core';
import type { Subscribable } from '@/core';
import type { DocumentEvents, DocumentWriter } from './document';
import { deepFreeze } from './freeze';
import type { DocumentMeta, FeatureId, FeatureInstance, PartStudioData } from './model';

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

// Every mutator validates first and then commits a whole new studio in one step,
// so a mutator that fails its checks leaves the document untouched and emits nothing.
// An exception thrown by a `changed` subscriber propagates after the change is done.
class CadDocument implements DocumentWriter {
  private readonly emitter = new Emitter<DocumentEvents>();
  // Only on/once, not the Emitter itself: a cast back to Emitter must not give emit (Q023).
  readonly events: Subscribable<DocumentEvents> = {
    on: (type, fn) => this.emitter.on(type, fn),
    once: (type, fn) => this.emitter.once(type, fn),
  };
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

  /** Freezes only the new array and studio; their features are already deeply frozen. */
  private commit(features: readonly FeatureInstance[], rollbackIndex: number): void {
    this._studio = Object.freeze({ features: Object.freeze(features), rollbackIndex });
    this.emitter.emit('changed', { studio: this._studio });
  }
}
