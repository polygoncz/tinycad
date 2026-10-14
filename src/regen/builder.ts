import { createRegistry } from '@/core';
import type { Plane, Registry, Result, Vec3 } from '@/core';
import type {
  AxisRef,
  BodyRef,
  FeatureInstance,
  PlaneRef,
  SketchEntityRef,
  SketchRegionRef,
  TopoRef,
} from '@/document';
import type {
  BooleanOps,
  DressupOps,
  PrimitiveOps,
  QueryOps,
  ShapeHandle,
  SketchOps,
  SweepOps,
  TransformOps,
} from '@/kernel';
import type { Body, FeatureError, RegenState, SketchArtifact } from './state';

// The behaviour half of a feature type (ADR 0004): turns params into geometry.
// The data half (params, validation) is FeatureSchema in document.

export interface BuildInput<P> {
  readonly feature: FeatureInstance<P>;
  /** State before this feature. */
  readonly state: RegenState;
}

/**
 * First reference a resolve method of BuildContext could not find (Q044). PlaneRef since M12;
 * region, axis and sketch entity since M13, TopoRef since M14.
 */
export interface RefError {
  readonly ref: BodyRef | PlaneRef | SketchRegionRef | AxisRef | SketchEntityRef | TopoRef;
  readonly message: string;
}

/** A resolved region of a sketch (M13): its sketch artifact and its planar face in the kernel. */
export interface ResolvedRegion {
  readonly ref: SketchRegionRef;
  readonly sketch: SketchArtifact;
  readonly face: ShapeHandle;
}

/** A resolved axis in world coordinates (M13). */
export interface ResolvedAxis {
  readonly origin: Vec3;
  /** Unit direction. */
  readonly direction: Vec3;
}

/**
 * A resolved plane (M14): the plane of a plane artifact, or the sketch frame of a planar body
 * face (sketchPlaneOfFace).
 */
export interface ResolvedPlane {
  readonly ref: PlaneRef | TopoRef;
  readonly plane: Plane;
}

/** Faces or edges of a body found by name (M14, spec 08): indices ascending, at least one. */
export interface ResolvedTopo {
  readonly ref: TopoRef;
  readonly body: Body;
  readonly indices: readonly number[];
}

/**
 * The part of the kernel a builder may use: it creates shapes and asks about them, it never
 * releases (Q041). Defined here by its consumer (ADR 0011); M11 added TransformOps and
 * BooleanOps, M12 SketchOps, M13 SweepOps, M14 DressupOps (and QueryOps.topology).
 */
export type ModelingKernel = PrimitiveOps &
  TransformOps &
  BooleanOps &
  SketchOps &
  SweepOps &
  DressupOps &
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
   * the first unresolved reference gives err. M12. Since M14 also a planar body face (TopoRef,
   * spec 08): the face with the smallest index (several → warn), a non-planar face gives err.
   */
  resolvePlanes(refs: readonly (PlaneRef | TopoRef)[]): Result<ResolvedPlane[], RefError>;
  /**
   * Regions of sketches (M13): the artifact sketchId(ref.sketch) of kind sketch and the name in
   * its regions; the first unresolved reference gives err.
   */
  resolveRegions(refs: readonly SketchRegionRef[]): Result<ResolvedRegion[], RefError>;
  /**
   * An axis (M13): an artifact of kind axis, or a line of a sketch (construction too) turned into
   * world coordinates through the plane of the sketch. Another entity kind or a zero-length
   * line gives err.
   */
  resolveAxis(ref: AxisRef | SketchEntityRef): Result<ResolvedAxis, RefError>;
  /** Several calls are joined with '\n' into one 'warning' status (Q045). */
  warn(message: string): void;
  /**
   * Faces or edges of bodies by name (M14, spec 08), in the order of refs: no match gives err,
   * several faces warn and are all used, several edges are all used without a warning.
   */
  resolveTopo(refs: readonly TopoRef[], entity: 'face' | 'edge'): Result<ResolvedTopo[], RefError>;
}

export type BuildOutput =
  | { readonly ok: true; readonly state: RegenState }
  | { readonly ok: false; readonly error: FeatureError };

/**
 * Rules (spec 07): never mutate the input state, return a new one; keep the identity of
 * artifacts (ADR 0015: a created body gets bodyId(feature.id) with origin and lastModifiedBy
 * the feature, a changed body keeps id and origin, gets lastModifiedBy and its names from
 * nameShape over the kernel history (M14), a consumed
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
