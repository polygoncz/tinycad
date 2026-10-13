import type { Brand } from '@/core';

// The document is a recipe: an ordered list of features (ADR 0003). Everything here
// is immutable plain JSON data (ADR 0006); behaviour lives elsewhere (ADR 0004).
// Branded ids are created by a cast at a single trusted place: id generation in ops
// and fromData after the shape check.

export type DocumentId = Brand<string, 'DocumentId'>;
export type FeatureId = Brand<string, 'FeatureId'>;
/**
 * '<featureId>/body' or '<featureId>/body:<n>'; minted only by bodyId() (ADR 0015). Declared
 * here, not in refs.ts, so that PartStudioData can key body metadata by it without a cycle.
 */
export type BodyId = Brand<string, 'BodyId'>;

export interface FeatureInstance<P = unknown> {
  readonly id: FeatureId;
  /** Key into the registries: 'box', 'cylinder', … */
  readonly type: string;
  /** Schema version the params were written with; fromData migrates older ones. */
  readonly typeVersion: number;
  /** Display name, 'Box 1'. */
  readonly name: string;
  readonly params: Readonly<P>;
  /** A suppressed feature is skipped by regeneration. */
  readonly suppressed: boolean;
}

export interface PartStudioData {
  readonly features: readonly FeatureInstance[];
  /** 0..features.length; features[i] is replayed when i < rollbackIndex. */
  readonly rollbackIndex: number;
  /** Metadata of bodies by lineage (ADR 0015); canonical form: absent when empty. */
  readonly bodies?: Readonly<Record<BodyId, BodyMeta>>;
}

/**
 * Name and visibility of a body (spec 03, M11). Canonical form: name only when non-empty,
 * hidden only as true; the document keeps it so, which makes replayed data compare equal.
 */
export interface BodyMeta {
  readonly name?: string;
  readonly hidden?: true;
}

export interface DocumentMeta {
  readonly id: DocumentId;
  readonly name: string;
  /** Unix time in ms; a number, not Date, so the data stays plain JSON. */
  readonly createdAt: number;
}
