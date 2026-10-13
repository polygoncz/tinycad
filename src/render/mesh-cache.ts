import type { MeshData, MeshOps, MeshQuality, ShapeHandle } from '@/kernel';

// Cache of tessellated meshes for SceneSync (spec 09, "Synchronizace s regenerací", point 2).
// Holds only CPU data (MeshData); GPU resources belong to BodyView. No three import.
//
// One instance tessellates through one MeshOps with one quality. The spec's key "handle + quality"
// is therefore just the handle: a different quality (or a new kernel instance) means a new cache,
// which is the spec's "a change of quality empties the cache".

export interface MeshCache {
  /**
   * The mesh of `shape`. Concurrent requests for the same handle share one `tessellate` call.
   * A rejected promise is dropped from the cache, so the next request tries again.
   */
  get(shape: ShapeHandle): Promise<MeshData>;
  /** Forgets every handle not in `shapes` (the kernel may already have released them). */
  retain(shapes: readonly ShapeHandle[]): void;
  /** Forgets everything. */
  clear(): void;
}

export function createMeshCache(meshes: MeshOps, quality: MeshQuality): MeshCache {
  const entries = new Map<ShapeHandle, Promise<MeshData>>();

  return {
    get(shape: ShapeHandle): Promise<MeshData> {
      const cached = entries.get(shape);
      if (cached !== undefined) return cached;
      const promise = meshes.tessellate(shape, quality);
      entries.set(shape, promise);
      // Only the entry still holding this promise is dropped: after clear/retain the handle may
      // already have a newer request. The catch also keeps the rejection from being unhandled
      // here; callers still see it on the returned promise.
      promise.catch(() => {
        if (entries.get(shape) === promise) entries.delete(shape);
      });
      return promise;
    },
    retain(shapes: readonly ShapeHandle[]): void {
      const keep = new Set(shapes);
      for (const shape of [...entries.keys()]) {
        if (!keep.has(shape)) entries.delete(shape);
      }
    },
    clear(): void {
      entries.clear();
    },
  };
}
