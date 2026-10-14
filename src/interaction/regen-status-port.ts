// The regeneration status port (spec 10, "Port stavu regenerace"): interaction must not know
// regen, yet the feature tree shows regeneration errors and the selection of subshapes is
// follows a regeneration by topological names. So interaction defines its own port and app feeds
// it from RegenState (Q063, R102). Suppression and the rollback bar are not here: interaction reads
// them from the document directly, so they show at once, not after a regeneration.

import type { Observable, Vec3 } from '@/core';
import type { BodyId, FeatureId, ParamIssue, SketchId, TopoName } from '@/document';

export type FeatureHealth =
  | { readonly kind: 'ok' }
  | { readonly kind: 'warning'; readonly message: string }
  | {
      readonly kind: 'error';
      readonly message: string;
      /** Invalid params (INVALID_PARAMS); ui translates these, not the message (ADR 0014). */
      readonly issues?: readonly ParamIssue[];
    };

/** A body of the last regeneration, the feature that made it and its names (M14). */
export interface RegenBody {
  readonly body: BodyId;
  readonly feature: FeatureId;
  readonly names: TopoNames;
}

/**
 * Topological names of a body of the last regeneration (M14, spec 08). A narrow interface
 * defined here so interaction does not know regen; regen's NameTable fits it structurally.
 */
export interface TopoNames {
  nameOfFace(index: number): TopoName | undefined;
  nameOfEdge(index: number): TopoName | undefined;
  /** Indices of the faces with the name, ascending; an unknown name → []. */
  faces(name: TopoName): readonly number[];
  /** Indices of the edges with the name, ascending; an unknown name → []. */
  edges(name: TopoName): readonly number[];
}

const NO_INDICES: readonly number[] = Object.freeze([]);

/** Names nothing: a body whose names are not known. */
export const NO_TOPO_NAMES: TopoNames = Object.freeze({
  nameOfFace: () => undefined,
  nameOfEdge: () => undefined,
  faces: () => NO_INDICES,
  edges: () => NO_INDICES,
});

/** A sketch of the last regeneration and the feature that made it (M12). */
export interface RegenSketch {
  readonly sketch: SketchId;
  readonly feature: FeatureId;
  /** Names of the regions in the order of the artifact (M13, the browser). */
  readonly regions: readonly string[];
}

/**
 * An anchor of a manipulator (M18, ADR 0021): a point and an optional unit direction in world
 * coordinates. Structurally the same as regen's Anchor, so app passes it on unchanged.
 */
export interface Anchor {
  readonly point: Vec3;
  readonly direction?: Vec3;
}

/** Anchors of one feature by name ('pivot', 'base'…); the plugin chooses names and meaning. */
export type FeatureAnchors = Readonly<Record<string, Anchor>>;

export interface RegenSnapshot {
  /** Grows by 1 with each finished regeneration; 0 = none yet. */
  readonly generation: number;
  /** Features the last regeneration evaluated (not suppressed, not after the bar). */
  readonly health: ReadonlyMap<FeatureId, FeatureHealth>;
  /** Bodies of the final state of the last regeneration, in its order (the browser rows). */
  readonly bodies: readonly RegenBody[];
  /** Sketches of the final state of the last regeneration, in its order (the browser, M12). */
  readonly sketches: readonly RegenSketch[];
  /** Anchors of the manipulators of the last regeneration's features (M18, RegenResult.anchors). */
  readonly anchors: ReadonlyMap<FeatureId, FeatureAnchors>;
}

export interface RegenStatusPort {
  readonly state: Observable<RegenSnapshot>;
}

/**
 * The name of the face or edge `index` of `body` in `snapshot` (M14), undefined when the body is
 * not in the snapshot or the face or edge has no name. The one lookup of the name of a hit in
 * interaction: the reference pick, the selection and the TopoInspector.
 */
export function nameOfHit(
  snapshot: RegenSnapshot,
  body: BodyId,
  kind: 'face' | 'edge',
  index: number,
): TopoName | undefined {
  const names = snapshot.bodies.find((b) => b.body === body)?.names;
  return kind === 'face' ? names?.nameOfFace(index) : names?.nameOfEdge(index);
}
