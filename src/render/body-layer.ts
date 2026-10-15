// Bodies from regeneration in the scene (spec 09, "Synchronizace s regenerací"): SceneSync decides
// what to swap, `apply` turns the plan into BodyViews in one synchronous block. Sole owner of the
// BodyViews and of the materials they share.

import * as THREE from 'three';
import { assert, type Disposable } from '@/core';
import type { BodyId } from '@/interaction';
import type { BoundingBox, MeshOps, ShapeHandle } from '@/kernel';
import { unionBounds } from './bounds';
import { createBodyMaterials, createBodyView, type BodyStyle, type BodyView } from './body-view';
import { DEFAULT_DISPLAY_STYLE, resolveDisplay, samePlan, type DisplayPlan } from './display-style';
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
   * The colour shows only in lit faces; in flat and hidden it waits for the return to lit.
   */
  setBodyColor(body: BodyId, color: string | null): void;
  /**
   * How the bodies are drawn (spec 09, "Styl zobrazení", M22). The same plan as the last one
   * does nothing; otherwise every view switches and a render is requested. Views created later
   * get the current plan. Starts in BodyLayerOptions.initialPlan.
   */
  setDisplayPlan(plan: DisplayPlan): void;
  /**
   * World units per screen pixel: the dashes of the hidden edges stay 6 px long with 4 px gaps.
   * Called inside a frame, so it never requests a render; the same value does nothing.
   */
  setPixelSize(worldPerPx: number): void;
  /**
   * Size of the canvas in pixels for the thick edges of the triangulation (LineMaterial, M22).
   * Without a call they use the default resolution of LineMaterial. Never requests a render.
   */
  setResolution(width: number, height: number): void;
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
  /**
   * The display plan the layer starts in (M22); the viewport owns the plan and passes its own.
   * Default resolveDisplay(DEFAULT_DISPLAY_STYLE).
   */
  readonly initialPlan?: DisplayPlan;
}

/** Length of a dash and of a gap of the hidden edges in screen pixels (spec 09, "Skryté hrany"). */
const DASH_PX = 6;
const GAP_PX = 4;

/**
 * Opacity of lit faces by the plan (spec 09, "Materiály"): translucent faces write no depth, so the
 * edges behind them show. A switch of `transparent` changes the shader program (needsUpdate).
 */
function applyOpacity(material: THREE.MeshStandardMaterial, opacity: number): void {
  const transparent = opacity < 1;
  if (material.transparent !== transparent) material.needsUpdate = true;
  material.transparent = transparent;
  material.opacity = opacity;
  material.depthWrite = !transparent;
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
  let plan = options.initialPlan ?? resolveDisplay(DEFAULT_DISPLAY_STYLE);
  /** worldPerPx of the last setPixelSize; null before the first one. */
  let pixelSize: number | null = null;
  let disposed = false;

  /** Face material for a colour; a copy of the shared one, so only the colour differs. */
  function acquireColor(color: string): THREE.MeshStandardMaterial {
    const entry = colorMaterials.get(color);
    if (entry !== undefined) {
      entry.users++;
      return entry.material;
    }
    // Clones the current state, so a colour acquired in transparent shaded is translucent too.
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

  /** The face material of a body by the plan; the colour material stays acquired in any case. */
  function faceMaterial(id: BodyId): THREE.Material {
    switch (plan.faces) {
      case 'lit': {
        const color = colors.get(id);
        if (color === undefined) return materials.faces;
        const entry = colorMaterials.get(color);
        assert(entry !== undefined, `No material for colour ${color}`);
        return entry.material;
      }
      case 'flat':
        return materials.facesFlat;
      case 'hidden':
        return materials.facesHidden;
    }
  }

  /** Puts a view into the current plan. */
  function applyPlan(view: BodyView): void {
    view.faces.material = faceMaterial(view.id);
    // Over the triangulation the edges are drawn thick instead (spec 09, "Triangulace").
    const thick = plan.edges && plan.meshLines;
    view.edges.visible = plan.edges && !plan.meshLines;
    view.hiddenEdges.visible = plan.hiddenEdges === 'dashed';
    view.setMeshLines(plan.meshLines ? materials.meshLines : null);
    view.setThickEdges(thick ? materials.edgesThick : null);
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
      if (color !== undefined) acquireColor(color);
      applyPlan(view);
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
      if (color !== null) acquireColor(color);
      if (color === null) colors.delete(body);
      else colors.set(body, color);
      view.faces.material = faceMaterial(body);
      if (current !== null) releaseColor(current);
      requestRender();
    },
    setDisplayPlan(next) {
      if (samePlan(plan, next)) return;
      const opacityChanged = plan.faceOpacity !== next.faceOpacity;
      plan = next;
      if (opacityChanged) {
        applyOpacity(materials.faces, plan.faceOpacity);
        for (const { material } of colorMaterials.values())
          applyOpacity(material, plan.faceOpacity);
      }
      for (const view of views.values()) applyPlan(view);
      requestRender();
    },
    setPixelSize(worldPerPx) {
      if (worldPerPx === pixelSize) return;
      pixelSize = worldPerPx;
      materials.hiddenEdges.dashSize = DASH_PX * worldPerPx;
      materials.hiddenEdges.gapSize = GAP_PX * worldPerPx;
    },
    setResolution(width, height) {
      materials.edgesThick.resolution.set(width, height);
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
