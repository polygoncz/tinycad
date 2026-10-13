// Ring 1 – GeometryKernel port and FakeKernel for tests.
// Public API of kernel (spec 06). Everything else in this folder is internal.

export type {
  BoundingBox,
  HistoryLink,
  MeshData,
  MeshQuality,
  ShapeHandle,
  ShapeHistory,
  ShapeResult,
  SubShapeIndex,
} from './types';
export type { GeometryKernel, LifecycleOps, MeshOps, PrimitiveOps, QueryOps } from './kernel';
export { createKernelError, kernelErrorCode } from './errors';
export type { KernelErrorCode } from './errors';
export { validateMeshData } from './mesh';
