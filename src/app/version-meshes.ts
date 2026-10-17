// Meshes of the bodies of the read model by content_version (N66, Q100, spec 09): MeshOps for
// render whose handles are versions. Every version gets a stable synthetic ShapeHandle, so the
// identity of a handle is the identity of a version and SceneSync swaps meshes exactly when a
// version changes. M46 task 1 fixes the contract; task 4 implements it.

import type { MeshData, MeshOps, ShapeHandle } from '@/kernel';

export interface VersionMeshes extends MeshOps {
  /** Stores the mesh of a version decoded from a read model. */
  put(version: string, mesh: MeshData): void;
  /** The stable handle of a version (a counter from 1, interned for the lifetime of the tab). */
  handleOf(version: string): ShapeHandle;
  /** Drops the meshes of every other version. */
  retain(versions: Iterable<string>): void;
  /** The versions with a mesh, for known_meshes. */
  versions(): readonly string[];
}

export function createVersionMeshes(): VersionMeshes {
  throw new Error('createVersionMeshes: not implemented (M46 task 4)');
}
