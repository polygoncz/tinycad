// Ring 1 – GeometryKernel port and FakeKernel for tests.
// Public API of kernel (spec 06). Everything else in this folder is internal.

export type {
  BoundingBox,
  EdgeInfo,
  FaceInfo,
  FacePlane,
  HistoryLink,
  MeshData,
  MeshQuality,
  ShapeHandle,
  ShapeHistory,
  ShapeResult,
  SubShapeIndex,
  SurfaceType,
  TopologySummary,
} from './types';
export type {
  Axis,
  BooleanOp,
  BooleanOps,
  DressupOps,
  ExchangeOps,
  GeometryKernel,
  LifecycleOps,
  MeshOps,
  PrimitiveOps,
  QueryOps,
  SketchOps,
  SweepOps,
  TransformOps,
} from './kernel';
export { validateFaceInput } from './profile';
export type { ProfileCurve, ProfileLoop } from './profile';
export { isRigidMotion } from './transform';
export { createKernelError, kernelErrorCode } from './errors';
export type { KernelErrorCode } from './errors';
export { validateMeshData } from './mesh';
