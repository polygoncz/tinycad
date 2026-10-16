import type { Plane, Vec3 } from '@/core';
import { ORIGIN, ORIGIN_AXES, ORIGIN_PLANES } from '@/document';
import type { AxisId, BodyId, FeatureId, ParamIssue, PlaneId, SketchId } from '@/document';
import type { ProfileRegion, ShapeHandle } from '@/kernel';
import type { SketchEntity } from '@/sketch';
import type { NameTable } from './names';

// Regeneration state (spec 07): an immutable snapshot of what exists after a feature.
// A feature is a function `output state = f(input state, params)`.

// The name table of a body lives in names.ts (spec 08); state re-exports it for the Body type.
export { EMPTY_NAMES } from './names';
export type { NameTable } from './names';

/** Id of an artifact, always '<owner>/<kind>[:<n>]' (ADR 0015). */
export type ArtifactId = BodyId | SketchId | PlaneId | AxisId;

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

/** A plane (M12): the origin planes of the owner ORIGIN; construction planes later. */
export interface PlaneArtifact {
  readonly kind: 'plane';
  readonly id: PlaneId;
  /** ORIGIN for the origin planes. */
  readonly owner: FeatureId;
  readonly plane: Plane;
}

/**
 * The result of a sketch (M12, spec 12): its plane, the solved geometry for drawing, the planar
 * faces of its regions in the kernel and their outlines (M30).
 */
export interface SketchArtifact {
  readonly kind: 'sketch';
  /** sketchId(owner). */
  readonly id: SketchId;
  readonly owner: FeatureId;
  readonly plane: Plane;
  /** The solved entities of the sketch; render draws them. */
  readonly entities: readonly SketchEntity[];
  /** Region name -> planar face (SketchOps.makeFace), in the order of the regions. */
  readonly regions: ReadonlyMap<string, ShapeHandle>;
  /**
   * M30: the outlines of the regions from the kernel (SketchOps.profileRegions), in the same
   * order and with the same names as `regions`; for drawing and picking the regions.
   */
  readonly outlines: readonly ProfileRegion[];
}

/** An axis (M13): the origin axes of the owner ORIGIN; construction axes later. */
export interface AxisArtifact {
  readonly kind: 'axis';
  readonly id: AxisId;
  /** ORIGIN for the origin axes. */
  readonly owner: FeatureId;
  readonly origin: Vec3;
  /** Unit direction. */
  readonly direction: Vec3;
}

/** Whatever a feature leaves for later features, told apart by `kind`. */
export type Artifact = Body | SketchArtifact | PlaneArtifact | AxisArtifact;

export interface RegenState {
  readonly artifacts: ReadonlyMap<ArtifactId, Artifact>;
}

/** The origin planes as artifacts of the owner ORIGIN, in the order xy, xz, yz. */
const ORIGIN_PLANE_ARTIFACTS: readonly PlaneArtifact[] = Object.freeze(
  ORIGIN_PLANES.map(({ id, plane }): PlaneArtifact =>
    Object.freeze({ kind: 'plane', id, owner: ORIGIN, plane }),
  ),
);

/** The origin axes as artifacts of the owner ORIGIN, in the order x, y, z (M13). */
const ORIGIN_AXIS_ARTIFACTS: readonly AxisArtifact[] = Object.freeze(
  ORIGIN_AXES.map(({ id, origin, direction }): AxisArtifact =>
    Object.freeze({ kind: 'axis', id, owner: ORIGIN, origin, direction }),
  ),
);

/**
 * The state in front of the first feature: the three origin planes (spec 12, Roviny a počátek)
 * and behind them the three origin axes (M13), so a sketch or a revolve refers to them like to
 * any other artifact. The values of ORIGIN_PLANES and ORIGIN_AXES are deeply frozen already.
 * Object.freeze does not stop Map.set; ReadonlyMap guards the artifacts at compile time.
 */
export const EMPTY_STATE: RegenState = Object.freeze({
  artifacts: new Map<ArtifactId, Artifact>(
    [...ORIGIN_PLANE_ARTIFACTS, ...ORIGIN_AXIS_ARTIFACTS].map((a) => [a.id, a]),
  ),
});

/** The body artifacts of the state, in the order of the map. */
export function bodiesOf(state: RegenState): readonly Body[] {
  return [...state.artifacts.values()].filter(isBody);
}

/** The sketch artifacts of the state, in the order of the map. */
export function sketchesOf(state: RegenState): readonly SketchArtifact[] {
  return [...state.artifacts.values()].filter(isSketch);
}

/** The plane artifacts of the state, in the order of the map. */
export function planesOf(state: RegenState): readonly PlaneArtifact[] {
  return [...state.artifacts.values()].filter(isPlane);
}

/** The axis artifacts of the state, in the order of the map (M13). */
export function axesOf(state: RegenState): readonly AxisArtifact[] {
  return [...state.artifacts.values()].filter(isAxis);
}

/** The artifact is a body. Internal to regen: resolveBodies and the sweep read only bodies. */
export function isBody(artifact: Artifact): artifact is Body {
  return artifact.kind === 'body';
}

/** The artifact is a sketch. Internal to regen: the sweep reads the regions of sketches. */
export function isSketch(artifact: Artifact): artifact is SketchArtifact {
  return artifact.kind === 'sketch';
}

/** The artifact is a plane. Internal to regen: resolvePlanes reads only planes. */
export function isPlane(artifact: Artifact): artifact is PlaneArtifact {
  return artifact.kind === 'plane';
}

/** The artifact is an axis. Internal to regen: resolveAxis reads only axes. */
export function isAxis(artifact: Artifact): artifact is AxisArtifact {
  return artifact.kind === 'axis';
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
  /**
   * INVALID_PARAMS: the problems from schema.validate, or ones a builder found itself
   * ('extrude.upToFace', 'fillet.failed', 'chamfer.failed'); UNRESOLVED_REFERENCE: one issue
   * 'param.unresolvedRef' at the param (unresolvedReference). Translated by the UI (ADR 0014).
   */
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
