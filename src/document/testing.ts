// Test-only entry point of document: builders for tests in this and other modules.
// dependency-cruiser allows importing it only from *.test.ts, so it never reaches
// the production bundle.

import { createDocument } from './cad-document';
import type { DocumentReader, DocumentWriter } from './document';
import type { Evaluated } from './evaluate';
import type { DocumentId, DocumentMeta, FeatureId, FeatureInstance, PartStudioData } from './model';
import { createSnapshotDocument } from './snapshot-document';

// Parts of the model only tests use since the core owns minting ids, origin axis ids in
// feature params and serialization (M47): kept here, outside the public API.
export { ORIGIN_AXIS_IDS } from './origin';
export { bodyId } from './refs';
export type { ParamSchemaOf } from './schema';
export { fromData, toData } from './serialize';

// Default ids depend on call order within a test file. Tests that assert on ids or
// names pass them explicitly; the defaults only guarantee uniqueness.
let nextFeature = 0;

type FeatureOverrides<P> = Omit<Partial<FeatureInstance<P>>, 'id'> & { readonly id?: string };

/** Default params of aFeature(). */
export interface DefaultParams {
  readonly size: number;
}

/**
 * A valid feature with defaults; override only what the test is about.
 * With own params type P, params are required, so the type never lies.
 */
export function aFeature(
  overrides?: FeatureOverrides<DefaultParams>,
): FeatureInstance<DefaultParams>;
export function aFeature<P>(
  overrides: FeatureOverrides<P> & { readonly params: P },
): FeatureInstance<P>;
export function aFeature(overrides: FeatureOverrides<unknown> = {}): FeatureInstance {
  const n = ++nextFeature;
  const { id, ...rest } = overrides;
  const defaults: DefaultParams = { size: 1 };
  return {
    type: 'box',
    typeVersion: 1,
    name: `Feature ${String(n)}`,
    params: defaults,
    suppressed: false,
    ...rest,
    id: (id ?? `f${String(n)}`) as FeatureId,
  };
}

export interface DocumentOptions {
  readonly meta?: Partial<DocumentMeta>;
  readonly features?: readonly FeatureInstance[];
  /** Defaults to features.length: everything active. */
  readonly rollbackIndex?: number;
}

/** A document with the given features; meta has fixed, deterministic values. */
export function aDocument(options: DocumentOptions = {}): DocumentWriter {
  const features = options.features ?? [];
  return createDocument({
    meta: { id: 'doc1' as DocumentId, name: 'Test document', createdAt: 0, ...options.meta },
    studio: { features, rollbackIndex: options.rollbackIndex ?? features.length },
  });
}

/** A document of a test: the reader and a way to script the next read model. */
export interface TestDocument extends DocumentReader {
  /** The next snapshot: the given parts replace those of the current one (createSnapshotDocument). */
  replace(next: { readonly name?: string; readonly studio?: PartStudioData }): void;
}

/** A snapshot document with the given features; meta as aDocument. */
export function aSnapshotDocument(options: DocumentOptions = {}): TestDocument {
  const features = options.features ?? [];
  const snapshots = createSnapshotDocument({
    meta: { id: 'doc1' as DocumentId, name: 'Test document', createdAt: 0, ...options.meta },
    studio: { features, rollbackIndex: options.rollbackIndex ?? features.length },
  });
  const { reader } = snapshots;
  return {
    get meta() {
      return reader.meta;
    },
    get studio() {
      return reader.studio;
    },
    feature: (id) => reader.feature(id),
    indexOf: (id) => reader.indexOf(id),
    bodyMeta: (body) => reader.bodyMeta(body),
    events: reader.events,
    replace(next) {
      snapshots.replace({
        meta: next.name === undefined ? reader.meta : { ...reader.meta, name: next.name },
        studio: next.studio ?? reader.studio,
      });
    },
  };
}

/**
 * The params as evaluated, without evaluateParams and its validation (M20): for tests of builders
 * and manipulators that pass params straight in, invalid ones too.
 */
export function anEvaluated<P>(params: P): Evaluated<P> {
  // The brand exists only in types; in production only evaluateParams mints it.
  return params as Evaluated<P>;
}
