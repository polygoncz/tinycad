import type { Vec3 } from '@/core';
import type { BoundingBox, MeshData, MeshQuality, ShapeHandle, ShapeResult } from './types';

// The GeometryKernel port (spec 06, ADR 0011), segregated by capability. It grows with the
// milestones that need it; nothing is added in advance.
// Every method returns a Promise and never throws synchronously; a failure is a rejection
// with a kernel error code (see errors.ts).

export interface PrimitiveOps {
  /** Box from the corner origin in +x, +y, +z. AABB = [origin, origin + size]. */
  makeBox(p: { readonly origin: Vec3; readonly size: Vec3 }): Promise<ShapeResult>;
}

export interface MeshOps {
  tessellate(shape: ShapeHandle, q: MeshQuality): Promise<MeshData>;
}

export interface QueryOps {
  boundingBox(shape: ShapeHandle): Promise<BoundingBox>;
}

export interface LifecycleOps {
  release(handles: readonly ShapeHandle[]): Promise<void>;
  /** Number of handles not yet released; for leak tests (mark & sweep). */
  liveHandleCount(): Promise<number>;
}

export interface GeometryKernel extends PrimitiveOps, MeshOps, QueryOps, LifecycleOps {}
