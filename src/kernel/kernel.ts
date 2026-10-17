import type { Mat4, Plane, Vec2, Vec3 } from '@/core';
import type {
  CurveIntersection,
  FilletArc,
  OffsetCurve,
  ProfileCurve,
  ProfileLoop,
  ProfileRegions,
} from './profile';
import type {
  BoundingBox,
  MeshData,
  MeshQuality,
  ShapeHandle,
  ShapeResult,
  TopologySummary,
} from './types';

// The GeometryKernel port (spec 06, ADR 0011), segregated by capability. It grows with the
// milestones that need it; nothing is added in advance.
// Every method returns a Promise and never throws synchronously; a failure is a rejection
// with a kernel error code (see errors.ts).

export interface PrimitiveOps {
  /** Box from the corner origin in +x, +y, +z. AABB = [origin, origin + size]. */
  makeBox(p: { readonly origin: Vec3; readonly size: Vec3 }): Promise<ShapeResult>;
  /** Cylinder: base centre `base`, axis along `axis` (need not be unit), `height` along the axis. */
  makeCylinder(p: {
    readonly base: Vec3;
    readonly axis: Vec3;
    readonly radius: number;
    readonly height: number;
  }): Promise<ShapeResult>;
}

export interface TransformOps {
  /** New shape = `shape` moved by the rigid motion m (rotation + translation, no mirror, no scale). */
  transform(shape: ShapeHandle, m: Mat4): Promise<ShapeResult>;
}

export type BooleanOp = 'union' | 'subtract' | 'intersect';

export interface BooleanOps {
  /** One resulting shape (a compound of several solids if need be); the inputs stay valid. */
  boolean(
    op: BooleanOp,
    targets: readonly ShapeHandle[],
    tools: readonly ShapeHandle[],
  ): Promise<ShapeResult>;
}

export interface SketchOps {
  /**
   * Planar face in `plane` bounded by the loop `outer`, with the holes `holes`. Loop coordinates
   * are in the plane (x = xDir, y = normal × xDir); loop orientation is arbitrary.
   */
  makeFace(p: {
    readonly plane: Plane;
    readonly outer: ProfileLoop;
    readonly holes: readonly ProfileLoop[];
  }): Promise<ShapeResult>;
  /**
   * M30: regions bounded by the curves (spec 06 "Stav po M30", spec 12 "Oblasti (profily)").
   * Every curve has a unique id; order and orientation are arbitrary. No handle, no side effects.
   */
  profileRegions(p: { readonly curves: readonly ProfileCurve[] }): Promise<ProfileRegions>;
  /**
   * M33: every common point of each pair of curves (a before b in the input order) and of each
   * spline with itself, ordered by a, b, ta (spec 06 "Stav po M33"). Ids as in profileRegions.
   * No handle, no side effects.
   */
  curveIntersections(p: {
    readonly curves: readonly ProfileCurve[];
  }): Promise<readonly CurveIntersection[]>;
  /**
   * M33: the piece of `curve` between the parameters from < to (t of spec 12), of the same kind
   * (a circle gives an arc), with the id of the input. No handle, no side effects.
   */
  curveSegment(p: {
    readonly curve: ProfileCurve;
    readonly from: number;
    readonly to: number;
  }): Promise<ProfileCurve>;
  /**
   * M34: the center of a fillet of radius `radius` between the lines or arcs `a` and `b`: at the
   * distance `radius` from both carriers (a line infinite, an arc its whole circle), the one
   * nearest `near`, with the touching points and their t (spec 06 "Stav po M34"). No handle,
   * no side effects; no solution rejects with 'operation-failed'.
   */
  filletArc(p: {
    readonly a: ProfileCurve;
    readonly b: ProfileCurve;
    readonly radius: number;
    readonly near: Vec2;
  }): Promise<FilletArc>;
  /**
   * M35: the offset of a chain of curves (spec 06 "Stav po M35"): the curves oriented along the
   * chain and joined end to start (the last to the first when `closed`; a circle alone),
   * `distance` ≠ 0 (closed > 0 outwards, open > 0 to the right of the direction of travel). The
   * result runs along the chain, joined, each curve with the id of its input as `source`; sharp
   * corners outwards, vanished curves left out, a spline as a cubic B-spline. No handle, no side
   * effects; an impossible offset rejects with 'operation-failed'.
   */
  offsetCurves(p: {
    readonly curves: readonly ProfileCurve[];
    readonly closed: boolean;
    readonly distance: number;
  }): Promise<readonly OffsetCurve[]>;
}

/** An axis: a point and a direction (need not be unit length). */
export interface Axis {
  readonly origin: Vec3;
  readonly direction: Vec3;
}

export interface SweepOps {
  /**
   * Prism: the face `profile` (a makeFace result or its transform) moved by `distance` along
   * `direction` (need not be unit length; the kernel normalises it). The profile stays valid.
   */
  extrude(profile: ShapeHandle, direction: Vec3, distance: number): Promise<ShapeResult>;
  /**
   * Solid of revolution: the face `profile` turned about `axis` by `angle` radians, positive by
   * the right-hand rule about axis.direction, 0 < angle ≤ 2π. The profile stays valid.
   */
  revolve(profile: ShapeHandle, axis: Axis, angle: number): Promise<ShapeResult>;
}

/** Dress-up of edges (M14). */
export interface DressupOps {
  /** Fillet of the edges `edges` (edge indices of `shape`) with the radius `radius`. */
  fillet(shape: ShapeHandle, edges: readonly number[], radius: number): Promise<ShapeResult>;
  /** Symmetric chamfer of the edges `edges` by `distance`. */
  chamfer(shape: ShapeHandle, edges: readonly number[], distance: number): Promise<ShapeResult>;
}

/** Exchange formats (M15). Not part of the builders' ModelingKernel: a feature exports nothing. */
export interface ExchangeOps {
  /** A STEP file (AP214, mm) with all the shapes `shapes`; the bytes of an ASCII/UTF-8 text. */
  exportStep(shapes: readonly ShapeHandle[]): Promise<Uint8Array<ArrayBuffer>>;
}

export interface MeshOps {
  tessellate(shape: ShapeHandle, q: MeshQuality): Promise<MeshData>;
}

export interface QueryOps {
  boundingBox(shape: ShapeHandle): Promise<BoundingBox>;
  /** Faces, edges and vertex count of the shape (M14); the same indices as its mesh. */
  topology(shape: ShapeHandle): Promise<TopologySummary>;
}

export interface LifecycleOps {
  release(handles: readonly ShapeHandle[]): Promise<void>;
  /** Number of handles not yet released; for leak tests (mark & sweep). */
  liveHandleCount(): Promise<number>;
}

export interface GeometryKernel
  extends
    PrimitiveOps,
    TransformOps,
    BooleanOps,
    SketchOps,
    SweepOps,
    DressupOps,
    ExchangeOps,
    MeshOps,
    QueryOps,
    LifecycleOps {}
