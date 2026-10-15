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
 * Name, visibility, color and material of a body (spec 03, M11, color M15, material M24).
 * Canonical form: name only when non-empty, hidden only as true, color only when isBodyColor,
 * material only when isBodyMaterial and not DEFAULT_BODY_MATERIAL; the document keeps it so,
 * which makes replayed data compare equal.
 */
export interface BodyMeta {
  readonly name?: string;
  readonly hidden?: true;
  /** '#rrggbb' in lower case (isBodyColor); absent = the default color of the palette. */
  readonly color?: string;
  /** Absent = DEFAULT_BODY_MATERIAL, which is never stored (M24). */
  readonly material?: BodyMaterial;
}

/** A material preset of a body (spec 03, M24, ADR 0027). Only render knows the PBR parameters. */
export type BodyMaterial = 'plastic' | 'aluminium' | 'steel' | 'brass' | 'glass' | 'rubber';

/** All material presets in UI order (spec 03, M24). */
export const BODY_MATERIALS: readonly BodyMaterial[] = Object.freeze([
  'plastic',
  'aluminium',
  'steel',
  'brass',
  'glass',
  'rubber',
]);

/** The material of a body without one; the canonical form does not store it (M24). */
// The literal type (not BodyMaterial) lets render check its own copy at compile time: render may
// import interaction (and so this constant) only as a type.
export const DEFAULT_BODY_MATERIAL = 'plastic' satisfies BodyMaterial;

/** A valid material preset (spec 03, M24); exact lower-case names only. */
export function isBodyMaterial(v: unknown): v is BodyMaterial {
  // includes on readonly BodyMaterial[] takes only a BodyMaterial; the widened view takes unknown.
  const all: readonly unknown[] = BODY_MATERIALS;
  return all.includes(v);
}

const BODY_COLOR = /^#[0-9a-f]{6}$/;

/**
 * A valid body color '#rrggbb' in lower case (spec 03, M15). Shared by fromData and validate of
 * body.setColor; upper case is refused, so replay needs no conversion.
 */
export function isBodyColor(v: unknown): v is string {
  return typeof v === 'string' && BODY_COLOR.test(v);
}

export interface DocumentMeta {
  readonly id: DocumentId;
  readonly name: string;
  /** Unix time in ms; a number, not Date, so the data stays plain JSON. */
  readonly createdAt: number;
}
