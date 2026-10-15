// Bodies from regeneration in the scene (spec 09, "Synchronizace s regenerací"): SceneSync decides
// what to swap, `apply` turns the plan into BodyViews in one synchronous block. Sole owner of the
// BodyViews and of the materials they share.

import * as THREE from 'three';
import { assert, type Disposable } from '@/core';
import type { BodyId, BodyMaterial, DEFAULT_BODY_MATERIAL } from '@/interaction';
import type { BoundingBox, MeshOps, ShapeHandle } from '@/kernel';
import { unionBounds } from './bounds';
import { createBodyMaterials, createBodyView, type BodyStyle, type BodyView } from './body-view';
import { DEFAULT_DISPLAY_STYLE, resolveDisplay, samePlan, type DisplayPlan } from './display-style';
import { materialPreset, physicalColor, type PhysicalPreset } from './material-presets';
import type { MeshCache } from './mesh-cache';
import { parseHexColor, type ScenePalette } from './palette';
import { createPhysicalMaterial } from './physical-materials';
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
   * Removes and disposes every shown body, forgets their visibility, colours and materials and
   * invalidates
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
   * The material preset of a shown body (M24, spec 09 "Realistic"); default 'plastic'. Same rules
   * as setBodyColor: an unknown body does nothing, a body that leaves the scene forgets its
   * material, the same value does not render. A material without a preset throws, also for an
   * unknown body. The material shows only in physical faces.
   */
  setBodyMaterial(body: BodyId, material: BodyMaterial): void;
  /**
   * The environment map of every physical material, also of those created later (M24). Never
   * requests a render: the viewport sets it inside a frame.
   */
  setEnvironment(envMap: THREE.Texture | null): void;
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

/**
 * The material of a body without setBodyMaterial (spec 09, "Realistic"). A copy of the document's
 * default, which render may see only as a type: typeof keeps the two equal at compile time.
 */
const DEFAULT_MATERIAL: typeof DEFAULT_BODY_MATERIAL = 'plastic';

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
  /** Materials of shown bodies other than the default; always a subset of the keys of `views`. */
  const bodyMaterials = new Map<BodyId, BodyMaterial>();
  /**
   * Physical materials by the pair (material, body colour or none), shared by the bodies of that
   * pair, with their user count. Exist only while the plan has physical faces.
   */
  const physicalMaterials = new Map<
    string,
    {
      readonly material: THREE.MeshPhysicalMaterial;
      readonly preset: PhysicalPreset;
      readonly bodyColor: number | null;
      users: number;
    }
  >();
  /**
   * The key of the physical material each shown body holds. Every shown body while the plan has
   * physical faces, empty otherwise.
   */
  const physicalKeys = new Map<BodyId, string>();
  /** The palette for physical materials created later (plastic without a body colour). */
  let palette = options.palette;
  /** The environment map of setEnvironment, for physical materials created later. */
  let environment: THREE.Texture | null = null;
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

  /** The physical material of a body by its pair; the body holds it under physicalKeys. */
  function acquirePhysical(id: BodyId): void {
    const material = bodyMaterials.get(id) ?? DEFAULT_MATERIAL;
    const color = colors.get(id) ?? null;
    const key = `${material}|${color ?? ''}`;
    physicalKeys.set(id, key);
    const entry = physicalMaterials.get(key);
    if (entry !== undefined) {
      entry.users++;
      return;
    }
    const preset = materialPreset(material);
    const bodyColor = color === null ? null : parseHexColor(color);
    physicalMaterials.set(key, {
      material: createPhysicalMaterial(
        preset,
        physicalColor(preset, bodyColor, palette.face),
        environment,
      ),
      preset,
      bodyColor,
      users: 1,
    });
  }

  /** The last user of a physical material disposes it. */
  function releasePhysical(key: string): void {
    const entry = physicalMaterials.get(key);
    assert(entry !== undefined, `No physical material for ${key}`);
    entry.users--;
    if (entry.users > 0) return;
    physicalMaterials.delete(key);
    entry.material.dispose();
  }

  /**
   * After a change of the colour or the material of a shown body in physical faces: the body
   * takes the material of its new pair. Acquire before release, so a material is never disposed
   * while it is being handed over.
   */
  function rebindPhysical(view: BodyView): void {
    if (plan.faces !== 'physical') return;
    const old = physicalKeys.get(view.id);
    assert(old !== undefined, `Body ${view.id} holds no physical material`);
    acquirePhysical(view.id);
    view.faces.material = faceMaterial(view.id);
    releasePhysical(old);
  }

  /** The face material of a body by the plan; the colour material stays acquired in any case. */
  function faceMaterial(id: BodyId): THREE.Material {
    switch (plan.faces) {
      case 'physical': {
        const key = physicalKeys.get(id);
        assert(key !== undefined, `Body ${id} holds no physical material`);
        const entry = physicalMaterials.get(key);
        assert(entry !== undefined, `No physical material for ${key}`);
        return entry.material;
      }
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
  function apply(scenePlan: ScenePlan): void {
    /** Colours and physical materials of removed views, released after the adds (see below). */
    const released: string[] = [];
    const releasedPhysical: string[] = [];
    for (const id of scenePlan.remove) {
      const view = views.get(id);
      if (view === undefined) continue;
      views.delete(id);
      group.remove(view.object);
      view.dispose();
      const color = colors.get(id);
      if (color !== undefined) released.push(color);
      const key = physicalKeys.get(id);
      if (key !== undefined) {
        physicalKeys.delete(id);
        releasedPhysical.push(key);
      }
    }
    for (const { id, mesh } of scenePlan.add) {
      // SceneSync removes a body before it adds it again; a second view would leak.
      assert(!views.has(id), `Body ${id} is already shown`);
      const view = createBodyView(id, mesh, materials);
      // A body kept under the same id with a new shape stays hidden.
      view.object.visible = !hidden.has(id);
      // ... and keeps its colour.
      const color = colors.get(id);
      if (color !== undefined) acquireColor(color);
      // ... and its material.
      if (plan.faces === 'physical') acquirePhysical(id);
      applyPlan(view);
      views.set(id, view);
      group.add(view.object);
    }
    // After the adds: a body removed and added again in one plan is still in the scene, and
    // its colour material is reused instead of disposed and created again.
    for (const color of released) releaseColor(color);
    for (const key of releasedPhysical) releasePhysical(key);
    for (const id of hidden) if (!views.has(id)) hidden.delete(id);
    for (const id of colors.keys()) if (!views.has(id)) colors.delete(id);
    for (const id of bodyMaterials.keys()) if (!views.has(id)) bodyMaterials.delete(id);
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
    setPalette(next) {
      palette = next;
      materials.setPalette(next);
      // Only plastic without a body colour takes its colour from the palette.
      for (const { material, preset, bodyColor } of physicalMaterials.values()) {
        if (preset.baseColor === null && bodyColor === null) material.color.setHex(next.face);
      }
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
      // The physical material follows the new pair; the old colour is still acquired here.
      rebindPhysical(view);
      if (current !== null) releaseColor(current);
      requestRender();
    },
    setBodyMaterial(body, material) {
      // Validates before anything changes, also for an unknown body.
      materialPreset(material);
      const view = views.get(body);
      if (view === undefined) return;
      const current = bodyMaterials.get(body) ?? DEFAULT_MATERIAL;
      if (current === material) return;
      if (material === DEFAULT_MATERIAL) bodyMaterials.delete(body);
      else bodyMaterials.set(body, material);
      rebindPhysical(view);
      requestRender();
    },
    setEnvironment(envMap) {
      if (envMap === environment) return;
      // A map appearing or disappearing changes the shader program (needsUpdate).
      const programChanged = (envMap === null) !== (environment === null);
      environment = envMap;
      for (const { material } of physicalMaterials.values()) {
        material.envMap = envMap;
        if (programChanged) material.needsUpdate = true;
      }
    },
    setDisplayPlan(next) {
      if (samePlan(plan, next)) return;
      const opacityChanged = plan.faceOpacity !== next.faceOpacity;
      const wasPhysical = plan.faces === 'physical';
      plan = next;
      const isPhysical = plan.faces === 'physical';
      // Physical materials exist only in physical faces: created on the way in ...
      if (isPhysical && !wasPhysical) for (const id of views.keys()) acquirePhysical(id);
      if (opacityChanged) {
        applyOpacity(materials.faces, plan.faceOpacity);
        for (const { material } of colorMaterials.values())
          applyOpacity(material, plan.faceOpacity);
      }
      for (const view of views.values()) applyPlan(view);
      // ... and released on the way out, once no view uses them.
      if (wasPhysical && !isPhysical) {
        for (const key of physicalKeys.values()) releasePhysical(key);
        physicalKeys.clear();
      }
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
