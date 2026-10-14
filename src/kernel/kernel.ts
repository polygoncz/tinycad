import type { Mat4, Plane, Vec3 } from '@/core';
import type { ProfileLoop } from './profile';
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
