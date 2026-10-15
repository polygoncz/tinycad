// Bodies from regeneration in the scene (spec 09, "Synchronizace s regenerací"): SceneSync decides
// what to swap, `apply` turns the plan into BodyViews in one synchronous block. Sole owner of the
// BodyViews and of the materials they share.

import * as THREE from 'three';
import { assert, type Disposable } from '@/core';
import type { BodyId } from '@/interaction';
import type { BoundingBox, MeshOps, ShapeHandle } from '@/kernel';
import { unionBounds } from './bounds';
import { createBodyMaterials, createBodyView, type BodyStyle, type BodyView } from './body-view';
import type { MeshCache } from './mesh-cache';
import { parseHexColor, type ScenePalette } from './palette';
import { createSceneSync, type PreparedSync, type ScenePlan } from './scene-sync';

export interface BodyLayer {
  /**
   * Updates the shown bodies. Settles once the scene is swapped or the sync became stale; never
   * rejects. A duplicate BodyId is a bug and throws synchronously, before anything changes.
   */
  sync(bodies: readonly { readonly id: BodyId; readonly shape: ShapeHandle }[]): Promise<void>;
  /** Kernel instance swap: drops the cache and the shown bodies, invalidates a running sync. */
  reset(meshes: MeshOps): void;
}

/**
 * A layer of bodies inside the viewport; internal. The viewport has two (M21): the body layer
 * (picking, highlight) and the preview. Both share one mesh cache, so the kernel swap of
 * BodyLayer.reset is done by the viewport: it resets the shared cache and clears both layers.
 */
export interface BodyLayerInternal extends Disposable {
  /** Same contract as BodyLayer.sync. */
  sync(bodies: readonly { readonly id: BodyId; readonly shape: ShapeHandle }[]): Promise<void>;
  /**
   * The first half of sync (SceneSync.prepare): the meshes are requested now, the scene swaps
   * only with commit. BodyLayers commits both layers together (M21).
   */
  prepare(
    bodies: readonly { readonly id: BodyId; readonly shape: ShapeHandle }[],
  ): Promise<PreparedSync>;
  /**
   * Removes and disposes every shown body, forgets the hidden and coloured ones and invalidates
   * a running sync (kernel swap, an emptied preview). Requests a render only when something was
   * shown.
   */
  clear(): void;
  /** Parent of every BodyView object; the viewport puts it into the scene. */
  readonly group: THREE.Group;
  readonly views: ReadonlyMap<BodyId, BodyView>;
  /**
   * Union of the bounds of the shown and visible bodies, null when there are none
   * (CameraRig.getBounds): fitAll leaves hidden bodies out.
   */
  bounds(): BoundingBox | null;
  /** Recolours the shared materials (Q072); the caller requests the render. */
  setPalette(palette: ScenePalette): void;
  /**
   * Shows or hides a shown body (Q071). An unknown body does nothing; a body that leaves the
   * scene forgets that it was hidden. Requests a render only when something changed.
   */
  setBodyVisible(body: BodyId, visible: boolean): void;
  /**
   * Colours the faces of a shown body ('#rrggbb', M15); null returns the material of the
   * palette. Same rules as setBodyVisible: an unknown body does nothing, a body that leaves the
   * scene forgets its colour, the same value does not render. An invalid colour throws.
   */
  setBodyColor(body: BodyId, color: string | null): void;
}

export interface BodyLayerOptions {
  /** A client of the viewport's SharedMeshCache. */
  readonly cache: MeshCache;
  /** Default 'body'. */
  readonly style?: BodyStyle;
  readonly reportError: (body: BodyId, error: unknown) => void;
  readonly requestRender: () => void;
  readonly palette: ScenePalette;
  /** Called after every scene swap (`apply`): the highlight rebuilds from the new meshes. */
  readonly afterApply?: () => void;
  /** Called after setBodyVisible changed a body: the highlight of a hidden body is not drawn. */
  readonly afterVisibilityChange?: () => void;
}

export function createBodyLayer(options: BodyLayerOptions): BodyLayerInternal {
  const { requestRender } = options;
  const group = new THREE.Group();
  const materials = createBodyMaterials(options.palette, options.style);
  const views = new Map<BodyId, BodyView>();
  /** Hidden bodies; always a subset of the keys of `views`. */
  const hidden = new Set<BodyId>();
  /** Colours of shown bodies; always a subset of the keys of `views`. */
  const colors = new Map<BodyId, string>();
  /** Face materials by colour, shared by the bodies of that colour, with their user count. */
  const colorMaterials = new Map<
    string,
    { readonly material: THREE.MeshStandardMaterial; users: number }
  >();
  let disposed = false;

  /** Face material for a colour; a copy of the shared one, so only the colour differs. */
  function acquireColor(color: string): THREE.MeshStandardMaterial {
    const entry = colorMaterials.get(color);
    if (entry !== undefined) {
      entry.users++;
      return entry.material;
    }
    const material = materials.faces.clone();
    material.color.setHex(parseHexColor(color));
    colorMaterials.set(color, { material, users: 1 });
    return material;
  }

  /** The last user of a colour disposes its material. */
  function releaseColor(color: string): void {
    const entry = colorMaterials.get(color);
    assert(entry !== undefined, `No material for colour ${color}`);
    entry.users--;
    if (entry.users > 0) return;
    colorMaterials.delete(color);
    entry.material.dispose();
  }

  /**
   * Swaps the scene in one synchronous block, so no frame shows half of the old and half of the
   * new model. Also called outside sync: clear (and so dispose) removes every shown body.
   */
  function apply(plan: ScenePlan): void {
    /** Colours of removed views, released after the adds (see below). */
    const released: string[] = [];
    for (const id of plan.remove) {
      const view = views.get(id);
      if (view === undefined) continue;
      views.delete(id);
      group.remove(view.object);
      view.dispose();
      const color = colors.get(id);
      if (color !== undefined) released.push(color);
    }
    for (const { id, mesh } of plan.add) {
      // SceneSync removes a body before it adds it again; a second view would leak.
      assert(!views.has(id), `Body ${id} is already shown`);
      const view = createBodyView(id, mesh, materials);
      // A body kept under the same id with a new shape stays hidden.
      view.object.visible = !hidden.has(id);
      // ... and keeps its colour.
      const color = colors.get(id);
      if (color !== undefined) view.faces.material = acquireColor(color);
      views.set(id, view);
      group.add(view.object);
    }
    // After the adds: a body removed and added again in one plan is still in the scene, and
    // its colour material is reused instead of disposed and created again.
    for (const color of released) releaseColor(color);
    for (const id of hidden) if (!views.has(id)) hidden.delete(id);
    for (const id of colors.keys()) if (!views.has(id)) colors.delete(id);
    options.afterApply?.();
    requestRender();
  }

  const sceneSync = createSceneSync({
    cache: options.cache,
    reportError: options.reportError,
    apply,
  });

  return {
    group,
    views,
    bounds(): BoundingBox | null {
      const visible = [...views.values()].filter((view) => view.object.visible);
      return unionBounds(visible.map((view) => view.bounds));
    },
    sync(bodies) {
      return sceneSync.sync(bodies);
    },
    prepare(bodies) {
      return sceneSync.prepare(bodies);
    },
    setPalette(palette) {
      materials.setPalette(palette);
    },
    setBodyVisible(body, visible) {
      const view = views.get(body);
      if (view === undefined || view.object.visible === visible) return;
      view.object.visible = visible;
      if (visible) hidden.delete(body);
      else hidden.add(body);
      options.afterVisibilityChange?.();
      requestRender();
    },
    setBodyColor(body, color) {
      // Validates before anything changes, also for an unknown body.
      if (color !== null) parseHexColor(color);
      const view = views.get(body);
      if (view === undefined) return;
      const current = colors.get(body) ?? null;
      if (current === color) return;
      // Acquire before release: a material is never disposed while it is being handed over.
      view.faces.material = color === null ? materials.faces : acquireColor(color);
      if (current !== null) releaseColor(current);
      if (color === null) colors.delete(body);
      else colors.set(body, color);
      requestRender();
    },
    clear() {
      sceneSync.clear();
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      // Disposes every BodyView through apply and makes a running sync stale, so it never
      // applies (and never creates views) after this.
      sceneSync.clear();
      materials.dispose();
    },
  };
}
