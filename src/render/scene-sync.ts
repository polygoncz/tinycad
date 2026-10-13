import type { BodyId } from '@/interaction';
import type { MeshData, MeshOps, MeshQuality, ShapeHandle } from '@/kernel';
import { diffBodies } from './body-diff';
import type { BodyDiff, ShownBody } from './body-diff';
import { createMeshCache } from './mesh-cache';

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
  readonly meshes: MeshOps;
  /** Fixed for the instance; a different quality needs a new SceneSync. */
  readonly quality: MeshQuality;
  /** A tessellation failure of the current generation (Q059); the body is not shown. */
  readonly reportError: (body: BodyId, error: unknown) => void;
  /** Swaps the scene synchronously. Called at most once per generation, never with an empty plan. */
  readonly apply: (plan: ScenePlan) => void;
}

/** Same shape as BodyLayer (spec 09). */
export interface SceneSync {
  /**
   * Updates the shown bodies. Settles once the scene is swapped or the sync became stale; never
   * rejects. A duplicate BodyId is a bug and throws synchronously, before anything changes.
   */
  sync(bodies: readonly ShownBody[]): Promise<void>;
  /** Kernel instance swap (Q060): drops the cache, removes every shown body, invalidates syncs. */
  reset(meshes: MeshOps): void;
}

export function createSceneSync(options: SceneSyncOptions): SceneSync {
  const { quality, reportError, apply } = options;
  let cache = createMeshCache(options.meshes, quality);
  let shown: ReadonlyMap<BodyId, ShapeHandle> = new Map();
  let generation = 0;

  async function run(current: number, bodies: readonly ShownBody[], diff: BodyDiff): Promise<void> {
    const settled = await Promise.allSettled(diff.add.map(({ shape }) => cache.get(shape)));
    // Stale: drop the meshes and errors alike (point 5, Q059). No GPU resources exist yet.
    if (current !== generation) return;

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
      // Diffed against `shown` now: it cannot change before this generation applies, because only
      // the latest generation applies and a newer sync or reset makes this one stale. Diffed
      // before the generation bump, so a duplicate BodyId (assert) leaves a running sync valid.
      const diff = diffBodies(shown, bodies);
      generation += 1;
      return run(generation, bodies, diff);
    },
    reset(meshes: MeshOps): void {
      generation += 1;
      cache.clear();
      cache = createMeshCache(meshes, quality);
      const remove = [...shown.keys()];
      shown = new Map();
      if (remove.length > 0) apply({ remove, add: [] });
    },
  };
}
