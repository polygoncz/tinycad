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

/**
 * One MeshCache shared by several SceneSyncs (the body layer and the preview, M21): the same
 * handle is tessellated once whichever layer shows it. Each SceneSync gets its own client.
 */
export interface SharedMeshCache {
  /**
   * A view of the shared entries for one SceneSync. Its `retain` sets the shapes this client
   * needs; the cache keeps the union over all clients, so one layer never drops the meshes of
   * another. A handle requested by `get` stays until the client's next `retain` or `clear`.
   * `clear` forgets only what this client needs.
   */
  client(): MeshCache;
  /** Kernel instance swap (Q060): forgets everything and tessellates through `meshes` now. */
  reset(meshes: MeshOps): void;
}

export function createSharedMeshCache(meshes: MeshOps, quality: MeshQuality): SharedMeshCache {
  let inner = createMeshCache(meshes, quality);
  /** Per client: the shapes of its last retain plus those requested since then. */
  const needs = new Set<Set<ShapeHandle>>();

  function retainAll(): void {
    inner.retain([...needs].flatMap((need) => [...need]));
  }

  return {
    client(): MeshCache {
      const need = new Set<ShapeHandle>();
      needs.add(need);
      return {
        get(shape: ShapeHandle): Promise<MeshData> {
          need.add(shape);
          return inner.get(shape);
        },
        retain(shapes: readonly ShapeHandle[]): void {
          need.clear();
          for (const shape of shapes) need.add(shape);
          retainAll();
        },
        clear(): void {
          need.clear();
          retainAll();
        },
      };
    },
    reset(next: MeshOps): void {
      inner.clear();
      inner = createMeshCache(next, quality);
      for (const need of needs) need.clear();
    },
  };
}
