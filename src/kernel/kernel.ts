import type { MeshData, MeshQuality, ShapeHandle } from './types';

// The one capability of the geometry kernel the client still has (spec 06, N122): the meshes of
// the bodies of a version, which the view tessellates through (app/version-meshes over the read
// model). Returns a Promise and never throws synchronously.

export interface MeshOps {
  tessellate(shape: ShapeHandle, q: MeshQuality): Promise<MeshData>;
}
