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

export interface Body {
  /** Stable name, e.g. 'f3k9/body'. */
  readonly id: BodyId;
  readonly shape: ShapeHandle;
  readonly createdBy: FeatureId;
  readonly names: NameTable;
}

export interface RegenState {
  readonly bodies: ReadonlyMap<BodyId, Body>;
}

// Object.freeze does not stop Map.set; ReadonlyMap guards the bodies at compile time.
export const EMPTY_STATE: RegenState = Object.freeze({ bodies: new Map<BodyId, Body>() });

export interface FeatureError {
  readonly code: 'INVALID_PARAMS' | 'UNRESOLVED_REFERENCE' | 'KERNEL' | 'UNKNOWN_TYPE';
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
