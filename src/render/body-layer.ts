// Bodies from regeneration in the scene (spec 09, "Synchronizace s regenerací"): SceneSync decides
// what to swap, `apply` turns the plan into BodyViews in one synchronous block. Sole owner of the
// BodyViews and of the materials they share.

import * as THREE from 'three';
import { assert, type Disposable } from '@/core';
import type { BodyId } from '@/interaction';
import type { BoundingBox, MeshOps, MeshQuality, ShapeHandle } from '@/kernel';
import { unionBounds } from './bounds';
import { createBodyMaterials, createBodyView, type BodyView } from './body-view';
import { createSceneSync, type ScenePlan } from './scene-sync';

export interface BodyLayer {
  /**
   * Updates the shown bodies. Settles once the scene is swapped or the sync became stale; never
   * rejects. A duplicate BodyId is a bug and throws synchronously, before anything changes.
   */
  sync(bodies: readonly { readonly id: BodyId; readonly shape: ShapeHandle }[]): Promise<void>;
  /** Kernel instance swap: drops the cache and the shown bodies, invalidates a running sync. */
  reset(meshes: MeshOps): void;
}

/** What the viewport (and later picking and highlight) needs on top of BodyLayer; internal. */
export interface BodyLayerInternal extends BodyLayer, Disposable {
  /** Parent of every BodyView object; the viewport puts it into the scene. */
  readonly group: THREE.Group;
  readonly views: ReadonlyMap<BodyId, BodyView>;
  /** Union of the bounds of the shown bodies, null when there are none (CameraRig.getBounds). */
  bounds(): BoundingBox | null;
}

export interface BodyLayerOptions {
  readonly meshes: MeshOps;
  readonly quality: MeshQuality;
  readonly reportError: (body: BodyId, error: unknown) => void;
  readonly requestRender: () => void;
  /** Called after every scene swap (`apply`): the highlight rebuilds from the new meshes. */
  readonly afterApply?: () => void;
}

export function createBodyLayer(options: BodyLayerOptions): BodyLayerInternal {
  const { requestRender } = options;
  const group = new THREE.Group();
  const materials = createBodyMaterials();
  const views = new Map<BodyId, BodyView>();
  let meshes = options.meshes;
  let disposed = false;

  /**
   * Swaps the scene in one synchronous block, so no frame shows half of the old and half of the
   * new model. Also called outside sync: reset (and so dispose) removes every shown body.
   */
  function apply(plan: ScenePlan): void {
    for (const id of plan.remove) {
      const view = views.get(id);
      if (view === undefined) continue;
      views.delete(id);
      group.remove(view.object);
      view.dispose();
    }
    for (const { id, mesh } of plan.add) {
      // SceneSync removes a body before it adds it again; a second view would leak.
      assert(!views.has(id), `Body ${id} is already shown`);
      const view = createBodyView(id, mesh, materials);
      views.set(id, view);
      group.add(view.object);
    }
    options.afterApply?.();
    requestRender();
  }

  const sceneSync = createSceneSync({
    meshes,
    quality: options.quality,
    reportError: options.reportError,
    apply,
  });

  return {
    group,
    views,
    bounds(): BoundingBox | null {
      return unionBounds([...views.values()].map((view) => view.bounds));
    },
    sync(bodies) {
      return sceneSync.sync(bodies);
    },
    reset(next) {
      meshes = next;
      sceneSync.reset(next);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      // Disposes every BodyView through apply and makes a running sync stale, so it never
      // applies (and never creates views) after this.
      sceneSync.reset(meshes);
      materials.dispose();
    },
  };
}
