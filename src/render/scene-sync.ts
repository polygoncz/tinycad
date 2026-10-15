import type { BodyId } from '@/interaction';
import type { MeshData, ShapeHandle } from '@/kernel';
import { diffBodies } from './body-diff';
import type { BodyDiff, ShownBody } from './body-diff';
import type { MeshCache } from './mesh-cache';

// The generation logic of BodyLayer (spec 09, "Synchronizace s regenerací", points 1–7), without
// three: the result is a plan of the scene swap, which BodyLayer's `apply` turns into BodyViews.

/** One swap of the scene: remove these views, then add these bodies. */
export interface ScenePlan {
  readonly remove: readonly BodyId[];
  readonly add: readonly {
    readonly id: BodyId;
    readonly shape: ShapeHandle;
    readonly mesh: MeshData;
  }[];
}

export interface SceneSyncOptions {
  /**
   * Meshes by handle; a client of a SharedMeshCache, so the body layer and the preview (M21)
   * tessellate a handle once. The owner of the shared cache swaps the kernel (Q060).
   */
  readonly cache: MeshCache;
  /** A tessellation failure of the current generation (Q059); the body is not shown. */
  readonly reportError: (body: BodyId, error: unknown) => void;
  /** Swaps the scene synchronously. Called at most once per generation, never with an empty plan. */
  readonly apply: (plan: ScenePlan) => void;
}

/**
 * A sync whose meshes are ready but not yet in the scene (M21): BodyLayers commits the syncs of
 * both layers together, so the main layer and the preview swap in one synchronous block.
 */
export interface PreparedSync {
  /** No newer sync or clear came since: commit would swap the scene. */
  isCurrent(): boolean;
  /**
   * Reports the tessellation failures and swaps the scene. Nothing when stale or committed
   * already.
   */
  commit(): void;
}

export interface SceneSync {
  /**
   * Updates the shown bodies. Settles once the scene is swapped or the sync became stale; never
   * rejects. A duplicate BodyId is a bug and throws synchronously, before anything changes.
   */
  sync(bodies: readonly ShownBody[]): Promise<void>;
  /**
   * The first half of sync: diffs and requests the meshes now (a duplicate BodyId throws
   * synchronously, before anything changes) and settles once they are ready. The scene swaps
   * only with commit. Like sync, a newer sync or clear makes it stale.
   */
  prepare(bodies: readonly ShownBody[]): Promise<PreparedSync>;
  /**
   * Removes every shown body, forgets what this sync needed from the cache and invalidates a
   * running sync. A kernel swap (Q060) is a reset of the shared cache followed by clear.
   */
  clear(): void;
}

export function createSceneSync(options: SceneSyncOptions): SceneSync {
  const { cache, reportError, apply } = options;
  let shown: ReadonlyMap<BodyId, ShapeHandle> = new Map();
  let generation = 0;

  function prepare(bodies: readonly ShownBody[]): Promise<PreparedSync> {
    // Diffed against `shown` now: it cannot change before this generation applies, because only
    // the latest generation applies and a newer sync or reset makes this one stale. Diffed
    // before the generation bump, so a duplicate BodyId (assert) leaves a running sync valid.
    const diff = diffBodies(shown, bodies);
    generation += 1;
    const current = generation;
    // Requested synchronously, so the shared cache knows this client needs the handles before
    // another client's retain or clear could drop them.
    const meshes = Promise.allSettled(diff.add.map(({ shape }) => cache.get(shape)));
    return meshes.then((settled): PreparedSync => {
      let committed = false;
      const isCurrent = (): boolean => !committed && current === generation;
      return {
        isCurrent,
        commit() {
          // Stale: drop the meshes and errors alike (point 5, Q059). No GPU resources exist yet.
          if (!isCurrent()) return;
          committed = true;
          commitPlan(bodies, diff, settled);
        },
      };
    });
  }

  function commitPlan(
    bodies: readonly ShownBody[],
    diff: BodyDiff,
    settled: readonly PromiseSettledResult<MeshData>[],
  ): void {
    const add: ScenePlan['add'][number][] = [];
    diff.add.forEach(({ id, shape }, i) => {
      const result = settled[i];
      if (result === undefined) return;
      if (result.status === 'fulfilled') add.push({ id, shape, mesh: result.value });
      else reportError(id, result.reason);
    });

    const next = new Map(shown);
    for (const id of diff.remove) next.delete(id);
    for (const { id, shape } of add) next.set(id, shape);
    shown = next;
    cache.retain(bodies.map(({ shape }) => shape));

    // Nothing to swap (everything kept, or every add failed with nothing to remove): no apply, so
    // BodyLayer does not request a render for an unchanged scene.
    if (diff.remove.length === 0 && add.length === 0) return;
    apply({ remove: diff.remove, add });
  }

  return {
    sync(bodies: readonly ShownBody[]): Promise<void> {
      return prepare(bodies).then((prepared) => {
        prepared.commit();
      });
    },
    prepare,
    clear(): void {
      generation += 1;
      cache.clear();
      const remove = [...shown.keys()];
      shown = new Map();
      if (remove.length > 0) apply({ remove, add: [] });
    },
  };
}
