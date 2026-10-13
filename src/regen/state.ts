import type { BodyId, FeatureId, ParamIssue } from '@/document';
import type { ShapeHandle } from '@/kernel';

// Regeneration state (spec 07): an immutable snapshot of what exists after a feature.
// A feature is a function `output state = f(input state, params)`.

/**
 * Topological names of the faces and edges of one shape (spec 08).
 * Empty until M14 fills it in; until then every body carries EMPTY_NAMES.
 */
export type NameTable = Readonly<Record<string, never>>;

export const EMPTY_NAMES: NameTable = Object.freeze({});

/**
 * Id of an artifact, always '<owner>/<kind>[:<n>]' (ADR 0015). Only bodies until M12, which adds
 * SketchId and PlaneId.
 */
export type ArtifactId = BodyId;

/**
 * A solid. Its identity is its lineage (ADR 0015): the feature that creates it mints the id and
 * is its origin; a feature that changes it keeps id, origin and names and becomes lastModifiedBy;
 * a feature that consumes it removes it from the map.
 */
export interface Body {
  readonly kind: 'body';
  /** bodyId(origin, n) from document, the one place that mints it, e.g. 'f3k9/body'. */
  readonly id: BodyId;
  /** The feature whose builder minted the id; it does not change along the lineage. */
  readonly origin: FeatureId;
  /** The last feature that gave the body a new shape. */
  readonly lastModifiedBy: FeatureId;
  readonly shape: ShapeHandle;
  readonly names: NameTable;
}

/** Whatever a feature leaves for later features, told apart by `kind`. M12 adds SketchArtifact. */
export type Artifact = Body;

export interface RegenState {
  readonly artifacts: ReadonlyMap<ArtifactId, Artifact>;
}

// Object.freeze does not stop Map.set; ReadonlyMap guards the artifacts at compile time.
export const EMPTY_STATE: RegenState = Object.freeze({
  artifacts: new Map<ArtifactId, Artifact>(),
});

/** The body artifacts of the state, in the order of the map. */
export function bodiesOf(state: RegenState): readonly Body[] {
  return [...state.artifacts.values()].filter(isBody);
}

/** The artifact is a body. Internal to regen: resolveBodies and the sweep read only bodies. */
export function isBody(artifact: Artifact): artifact is Body {
  // Widened to string: with Body the only kind until M12 the type checker would call a direct
  // `artifact.kind === 'body'` always true, but artifacts of other kinds must still be skipped.
  const kind: string = artifact.kind;
  return kind === 'body';
}

export interface FeatureError {
  readonly code:
    | 'INVALID_PARAMS'
    | 'UNRESOLVED_REFERENCE'
    | 'KERNEL'
    | 'UNKNOWN_TYPE'
    /** typeVersion of the feature is not the version of its schema: data that missed migration. */
    | 'STALE_VERSION';
  /** Technical text for logs and kernel errors; the UI does not show it for INVALID_PARAMS. */
  readonly message: string;
  /** Only INVALID_PARAMS: the problems from schema.validate, translated by the UI (ADR 0014). */
  readonly issues?: readonly ParamIssue[];
}

export type FeatureStatus =
  | { readonly kind: 'ok' }
  | { readonly kind: 'warning'; readonly message: string }
  | { readonly kind: 'error'; readonly error: FeatureError }
  | { readonly kind: 'suppressed' }
  /** Behind the rollback bar. */
  | { readonly kind: 'rolledBack' }
  /** Not regenerated yet; only the UI uses it, before the first regeneration. */
  | { readonly kind: 'pending' };
