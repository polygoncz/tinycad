// Ring 1 – the types of the geometry kernel the client knows (N122): meshes, bounding boxes,
// profile regions of the read model and kernel errors. The kernel itself runs on the server.
// Public API of kernel (spec 06). Everything else in this folder is internal.

export type { BoundingBox, MeshData, MeshQuality, ShapeHandle } from './types';
export type { MeshOps } from './kernel';
export type { ProfileCurve, ProfileLoop, ProfileRegion } from './profile';
export { createKernelError } from './errors';
export type { KernelErrorCode } from './errors';
export { validateMeshData } from './mesh';
