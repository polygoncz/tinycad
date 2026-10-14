import { createRegistry } from '@/core';
import type { Registry, Result } from '@/core';
import type { BodyRef, FeatureInstance, PlaneRef } from '@/document';
import type {
  BooleanOps,
  PrimitiveOps,
  QueryOps,
  SketchOps,
  SweepOps,
  TransformOps,
} from '@/kernel';
import type { Body, FeatureError, PlaneArtifact, RegenState } from './state';

// The behaviour half of a feature type (ADR 0004): turns params into geometry.
// The data half (params, validation) is FeatureSchema in document.

export interface BuildInput<P> {
  readonly feature: FeatureInstance<P>;
  /** State before this feature. */
  readonly state: RegenState;
}

/**
 * First reference resolveBodies or resolvePlanes could not find (Q044). PlaneRef since M12; M14
 * widens ref to TopoRef.
 */
export interface RefError {
  readonly ref: BodyRef | PlaneRef;
  readonly message: string;
}

/**
 * The part of the kernel a builder may use: it creates shapes and asks about them, it never
 * releases (Q041). Defined here by its consumer (ADR 0011); M11 added TransformOps and
 * BooleanOps, M12 SketchOps, M13 SweepOps.
 */
export type ModelingKernel = PrimitiveOps &
  TransformOps &
  BooleanOps &
  SketchOps &
  SweepOps &
  QueryOps;

/**
 * The feature error for an unresolved reference of the param `param` (Q044): the UI translates
 * the issue at the param, the message of the RefError stays for logs. Deeply frozen.
 */
export function unresolvedReference(param: string, e: RefError): FeatureError {
  return Object.freeze({
    code: 'UNRESOLVED_REFERENCE',
    message: e.message,
    issues: Object.freeze([Object.freeze({ param, code: 'param.unresolvedRef' })]),
  });
}

export interface BuildContext {
  /** Tracked kernel: every returned handle belongs to the Regenerator (Q041). */
  readonly kernel: ModelingKernel;
  /**
   * Bodies of the input state (artifacts of kind body; another kind under the id gives err);
   * the first unresolved reference gives err (Q044).
   */
  resolveBodies(refs: readonly BodyRef[]): Result<Body[], RefError>;
  /**
   * Planes of the input state (artifacts of kind plane; a missing id or another kind gives err);
   * the first unresolved reference gives err. M12.
   */
  resolvePlanes(refs: readonly PlaneRef[]): Result<PlaneArtifact[], RefError>;
  /** Several calls are joined with '\n' into one 'warning' status (Q045). */
  warn(message: string): void;
}

export type BuildOutput =
  | { readonly ok: true; readonly state: RegenState }
  | { readonly ok: false; readonly error: FeatureError };

/**
 * Rules (spec 07): never mutate the input state, return a new one; keep the identity of
 * artifacts (ADR 0015: a created body gets bodyId(feature.id) with origin and lastModifiedBy
 * the feature, a changed body keeps id, origin and names and gets lastModifiedBy, a consumed
 * body leaves the map); never release handles; create every shape through ctx.kernel; return
 * expected failures as { ok: false } (an unresolved reference through unresolvedReference).
 * Params are already validated.
 */
export interface FeatureBuilder<P = unknown> {
  /** Registry key, same as FeatureSchema.type. */
  readonly type: string;
  build(input: BuildInput<P>, ctx: BuildContext): Promise<BuildOutput>;
}

export type BuilderRegistry = Registry<FeatureBuilder>;

export function createBuilderRegistry(): BuilderRegistry {
  return createRegistry<FeatureBuilder>({ what: 'feature builder', keyOf: (b) => b.type });
}
