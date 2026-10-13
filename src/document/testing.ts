// Test-only entry point of document: builders for tests in this and other modules.
// dependency-cruiser allows importing it only from *.test.ts, so it never reaches
// the production bundle.

import { createDocument } from './cad-document';
import type { DocumentWriter } from './document';
import type { DocumentId, DocumentMeta, FeatureId, FeatureInstance } from './model';

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
