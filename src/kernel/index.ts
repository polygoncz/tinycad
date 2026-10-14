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
export type {
  BooleanOp,
  BooleanOps,
  GeometryKernel,
  LifecycleOps,
  MeshOps,
  PrimitiveOps,
  QueryOps,
  SketchOps,
  TransformOps,
} from './kernel';
export { validateFaceInput } from './profile';
export type { ProfileCurve, ProfileLoop } from './profile';
export { isRigidMotion } from './transform';
export { createKernelError, kernelErrorCode } from './errors';
export type { KernelErrorCode } from './errors';
export { validateMeshData } from './mesh';
