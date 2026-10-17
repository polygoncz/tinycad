// Meshes of the bodies of the read model by content_version (N66, Q100, spec 09): MeshOps for
// render whose handles are versions. Every version gets a stable synthetic ShapeHandle, so the
// identity of a handle is the identity of a version and SceneSync swaps meshes exactly when a
// version changes.

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
  /** Version → its handle; never shrinks, so a version keeps its handle for the whole tab. */
  const handles = new Map<string, ShapeHandle>();
  /** Handle → version, the way back for tessellate. */
  const versionOf = new Map<ShapeHandle, string>();
  /** Version → its mesh; only the versions of the last read model (retain). */
  const meshes = new Map<string, MeshData>();
  let lastHandle = 0;

  return {
    put(version, mesh) {
      // A content version names one shape, so its mesh never changes: the first one stays.
      if (!meshes.has(version)) meshes.set(version, mesh);
    },
    handleOf(version) {
      const known = handles.get(version);
      if (known !== undefined) return known;
      lastHandle += 1;
      // The one place synthetic handles are minted: a handle here names a version, not a shape
      // of a kernel (N66).
      const handle = lastHandle as ShapeHandle;
      handles.set(version, handle);
      versionOf.set(handle, version);
      return handle;
    },
    retain(versions) {
      const keep = new Set(versions);
      for (const version of [...meshes.keys()]) {
        if (!keep.has(version)) meshes.delete(version);
      }
    },
    versions() {
      return Object.freeze([...meshes.keys()]);
    },
    tessellate(shape) {
      // The quality is the one of the session on the server (OpenSession.mesh_quality).
      const version = versionOf.get(shape);
      const mesh = version === undefined ? undefined : meshes.get(version);
      if (mesh === undefined) {
        // A program error: the view asks only for handles of the shown read model.
        return Promise.reject(
          new Error(
            version === undefined
              ? `Unknown mesh handle ${String(shape)}`
              : `No mesh of version '${version}' (handle ${String(shape)})`,
          ),
        );
      }
      return Promise.resolve(mesh);
    },
  };
}
