// The Three.js viewport (spec 09, "Viewport"): owns the scene, the camera, the renderer while
// mounted, and turns canvas events into ViewportPort events. Renders on demand only.

import * as THREE from 'three';
import {
  assert,
  DisposableStore,
  Emitter,
  type Disposable,
  type Subscribable,
  type Unsubscribe,
  type Vec3,
} from '@/core';
import type {
  BodyId,
  HandleVisibility,
  HighlightPort,
  ManipulatorGlyphs,
  OverlayPort,
  PickFilter,
  PickResult,
  ViewPointerEvent,
  ViewportEvents,
  ViewportPort,
} from '@/interaction';
import type { BoundingBox, MeshOps, MeshQuality, ShapeHandle } from '@/kernel';
import type { BodyLayer } from './body-layer';
import { createBodyLayers } from './body-layers';
import { unionBounds } from './bounds';
import { createCameraRig, type CameraController } from './camera-controller';
import type { OrbitMode } from './camera-ops';
import { createFrameScheduler } from './frame-scheduler';
import { createHighlightLayer } from './highlight-layer';
import {
  createManipulatorLayer,
  type HandleProjection,
  type ManipulatorLayer,
} from './manipulator-layer';
import type { ScreenPoint } from './manipulator-pick';
import { createOverlayLayer } from './overlay-layer';
import { LIGHT_PALETTE, type ScenePalette } from './palette';
import { toNdc } from './pick-math';
import { createSceneHelpers, GRID_BOUNDS } from './scene-helpers';
import { sketchGridStep } from './sketch-grid';
import { createSketchLayer, type SketchLayer } from './sketch-layer';
import { createViewCube } from './view-cube';
import { DEFAULT_VIEW_CUBE_LABELS, type ViewCubeLabels } from './view-cube-labels';
import { viewChangedSince, type ViewSnapshot } from './view-change';
import { toViewKeyEvent, toViewPointerEvent } from './view-events';

/** Hover and selection (spec 09, "Vrstvy pro interakci"). */
export type HighlightLayer = HighlightPort;
/** Temporary geometry of tools (spec 09, "Vrstvy pro interakci"). */
export type OverlayLayer = OverlayPort;

/**
 * The result of the edited feature as a transparent preview (M21, ADR 0025). A second set of
 * bodies with its own map by BodyId; never picked or highlighted. setBodyVisible and
 * setBodyColor apply to it too.
 */
export interface PreviewLayer {
  /** Same contract as BodyLayer.sync. */
  sync(bodies: readonly { readonly id: BodyId; readonly shape: ShapeHandle }[]): Promise<void>;
  /** Removes and disposes every preview body, invalidates a running sync. */
  clear(): void;
}

export interface Viewport extends ViewportPort, Disposable {
  /** Creates canvas, renderer, ResizeObserver and camera input; twice without unmount = error. */
  mount(el: HTMLElement): void;
  /** Releases renderer and canvas; the scene (bodies, camera) stays. Idempotent. */
  unmount(): void;

  /** Rendering on demand, not a 60 fps loop. */
  requestRender(): void;
  /** px relative to the canvas (CSS px); an unmounted viewport → null. Filter: spec 10. */
  pick(x: number, y: number, filter?: PickFilter): PickResult | null;
  /** Unmounted → error. */
  screenToRay(x: number, y: number): { origin: Vec3; direction: Vec3 };

  /** Bodies from regeneration; reset swaps the kernel for the preview too. */
  readonly bodies: BodyLayer;
  /** Result of the edited feature (M21); not picked, not highlighted. */
  readonly preview: PreviewLayer;
  /**
   * M21 (D3 of M19.1): the bodies and the preview at once. Prepares the meshes of both and swaps
   * both in one synchronous block, so no frame and no published result sees one layer new and
   * the other old. Settles once both are swapped or the call is stale (a newer sync, syncLayers,
   * preview.clear or reset makes it swap neither); never rejects. A duplicate BodyId in either
   * list throws synchronously, before anything changes. An empty `preview` empties the preview.
   */
  syncLayers(next: {
    readonly main: readonly { readonly id: BodyId; readonly shape: ShapeHandle }[];
    readonly preview: readonly { readonly id: BodyId; readonly shape: ShapeHandle }[];
  }): Promise<void>;
  /** Hover and selection (implements HighlightPort). */
  readonly highlight: HighlightLayer;
  /** Temporary geometry of tools (implements OverlayPort). */
  readonly overlay: OverlayLayer;
  /** Drawings of sketches and planes (M12, implements SketchPort). */
  readonly sketches: SketchLayer;
  /** Handles of manipulators (M18, implements ManipulatorPort). */
  readonly manipulators: ManipulatorLayer;
  /** Fit all, standard views, normal to a plane (M12). */
  readonly camera: CameraController;
  /**
   * M19.2: step of the sketch grid in mm (1–2–5 × 10ⁿ, lines at least 10 px apart) for the size of
   * a pixel of the last drawn frame; 1 before the first frame. The sketcher snaps to it.
   */
  sketchGridStep(): number;

  /** Recolours the existing materials and the background, creates nothing anew (Q072). */
  setPalette(palette: ScenePalette): void;
  /**
   * View state from the browser (Q071): a hidden body is not drawn and not picked. Applies to
   * the bodies and the preview.
   */
  setBodyVisible(body: BodyId, visible: boolean): void;
  /**
   * Body colour from its metadata (M15, Q073): '#rrggbb' colours the faces, null returns the
   * palette's. Survives a sync while the body stays; setPalette leaves it alone. Applies to the
   * bodies and the preview (whose faces stay transparent).
   */
  setBodyColor(body: BodyId, color: string | null): void;
  /** M17: face labels and arrow aria-labels of the view cube; the same values = nothing. */
  setViewCubeLabels(labels: ViewCubeLabels): void;
  /**
   * M17.1: rotation mode of the camera and the view cube (spec 09, "Režim otáčení"); the same
   * mode = nothing. ui owns the mode, the viewport only applies it.
   */
  setOrbitMode(mode: OrbitMode): void;
  /** M17.1: click on the rotation mode button of the view cube; dispose drops the listeners. */
  onOrbitModeToggle(listener: () => void): Unsubscribe;

  /**
   * viewChanged (M19) after a drawn frame whose camera (target, orientation, halfHeight) or view
   * area size differs from the previous frame; the first frame after mount counts as changed.
   */
  readonly events: Subscribable<ViewportEvents>;
}

export const MESH_QUALITY: MeshQuality = { linearDeflection: 0.1, angularDeflection: 0.5 };

/** Requests of the view cube to the owner of the rotation mode. */
interface OrbitModeEvents {
  toggle: undefined;
}

/** Resources that exist only while the viewport is mounted. */
interface Mounted {
  readonly canvas: HTMLCanvasElement;
  readonly renderer: THREE.WebGLRenderer;
  /** Releases everything created by mount, in reverse order. */
  readonly resources: DisposableStore;
}

export function createViewport(deps: {
  meshes: MeshOps;
  quality?: MeshQuality;
  /** Default LIGHT_PALETTE. */
  palette?: ScenePalette;
  reportError?: (body: BodyId, error: unknown) => void;
  /** M17, default English (DEFAULT_VIEW_CUBE_LABELS). */
  viewCubeLabels?: ViewCubeLabels;
  /** Clock of the camera and view cube animations in ms; default performance.now. */
  now?: () => number;
  /**
   * M20: sizes of the glyphs of manipulator handles and limits of their hiding. They belong to
   * interaction, from which render may take only types, so app passes them (MANIPULATOR_GLYPHS,
   * HANDLE_VISIBILITY).
   */
  manipulatorGlyphs: ManipulatorGlyphs;
  handleVisibility: HandleVisibility;
}): Viewport {
  let palette = deps.palette ?? LIGHT_PALETTE;
  const now = deps.now ?? (() => performance.now());
  const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);
  const lifetime = new DisposableStore();
  let emitter = new Emitter<ViewportEvents>();
  let orbitModeToggles = new Emitter<OrbitModeEvents>();
  let mounted: Mounted | null = null;
  let everMounted = false;
  let disposed = false;
  /** What the last frame drew with (viewChanged); null = no frame since mount. */
  let lastView: ViewSnapshot | null = null;
  /** Grows by one with every viewChanged; never reset, so a remount keeps it growing. */
  let viewGeneration = 0;
  /** mm per CSS px of the last drawn frame (sketch grid, M19.2); 0 = no frame yet. */
  let lastWorldPerPx = 0;

  const scheduler = lifetime.add(
    createFrameScheduler({
      requestFrame: (callback) => requestAnimationFrame(callback),
      cancelFrame: (id) => {
        cancelAnimationFrame(id);
      },
      draw,
    }),
  );

  /** Internal render request: only a mounted viewport has something to draw on. */
  function scheduleFrame(): void {
    if (mounted !== null) scheduler.request();
  }

  const scene = new THREE.Scene();
  // Before the camera rig, whose fitAll reads the bounds of the shown bodies.
  const layers = lifetime.add(
    createBodyLayers({
      meshes: deps.meshes,
      quality: deps.quality ?? MESH_QUALITY,
      reportError:
        deps.reportError ??
        ((body, error) => {
          console.error(`Tessellation of body ${body} failed`, error);
        }),
      requestRender: scheduleFrame,
      palette,
      // The highlight is created right below; apply runs only after a sync, reset or dispose.
      afterApply: () => {
        highlightLayer.rebuild();
      },
      afterVisibilityChange: () => {
        highlightLayer.rebuild();
      },
    }),
  );
  const layer = layers.main;
  scene.add(layer.group, layers.preview.group);
  // After the body layers, so they are disposed before them; rebuild after dispose is a no-op.
  // The main layer only: the preview is not highlighted (M21).
  const highlightLayer = lifetime.add(
    createHighlightLayer({
      views: layer.views,
      requestRender: scheduleFrame,
      palette,
      // The sketch layer is created below; the highlight is first set only after construction.
      regions: {
        setRegionHighlight: (hover, selection) => {
          sketchLayer.setRegionHighlight(hover, selection);
        },
      },
    }),
  );
  scene.add(highlightLayer.group);
  const overlayLayer = lifetime.add(createOverlayLayer({ requestRender: scheduleFrame, palette }));
  scene.add(overlayLayer.group);
  const sketchLayer = lifetime.add(createSketchLayer({ requestRender: scheduleFrame, palette }));
  scene.add(sketchLayer.group);
  // Order in the scene does not matter: renderOrder 4 draws the handles after the sketches.
  const manipulatorLayer = lifetime.add(
    createManipulatorLayer({
      requestRender: scheduleFrame,
      palette,
      shape: { glyphs: deps.manipulatorGlyphs, visibility: deps.handleVisibility },
    }),
  );
  scene.add(manipulatorLayer.group);
  const rig = lifetime.add(
    createCameraRig({
      // The preview too: fitAll shows the result of the edited feature (M21).
      getBounds: () => layers.bounds(),
      requestRender: scheduleFrame,
      now,
      isMac,
    }),
  );
  // In the scene, so the headlight (its child) is part of the scene graph.
  scene.add(rig.camera);
  const helpers = lifetime.add(createSceneHelpers(scene, rig.camera, palette));
  // After the rig, so it is disposed before it.
  const viewCube = lifetime.add(
    createViewCube({
      rig,
      palette,
      labels: deps.viewCubeLabels ?? DEFAULT_VIEW_CUBE_LABELS,
      requestRender: scheduleFrame,
      now,
      onOrbitModeToggle: () => {
        orbitModeToggles.emit('toggle', undefined);
      },
    }),
  );
  // The main layer only: the preview is neither picked nor hides anything (M21).
  const picker = layers.picker;

  /**
   * Box of everything visible (spec 09, "Near a far"): bodies and the preview (M21), sketch
   * drawings, tool overlay, manipulator handles (M18), the grid and the camera target. Never null
   * thanks to the grid.
   */
  function sceneBounds(): BoundingBox {
    const target = rig.target;
    return (
      unionBounds([
        layers.bounds(),
        sketchLayer.bounds(),
        overlayLayer.bounds(),
        // The glyph size follows the zoom; drawing and picking run mounted only.
        manipulatorLayer.bounds(worldPerPx(mounted?.canvas.clientHeight ?? 0)),
        GRID_BOUNDS,
        { min: target, max: target },
      ]) ?? GRID_BOUNDS
    );
  }

  /** near/far and the camera position enclose the whole scene; before drawing and picking. */
  function updateClip(): void {
    rig.updateClip(sceneBounds());
  }

  function draw(): void {
    if (mounted === null) return;
    const { renderer } = mounted;
    // Running animations move on first; the clip range follows the new orientation.
    const time = now();
    const animating = rig.tick(time);
    const fading = viewCube.tick(time);
    // Before updateClip: the sketch grid follows the zoom and is part of the scene bounds.
    const { clientWidth, clientHeight } = mounted.canvas;
    lastWorldPerPx = worldPerPx(clientHeight);
    sketchLayer.setPixelSize(lastWorldPerPx, rig.target, Math.hypot(clientWidth, clientHeight));
    updateClip();
    // Constant size on the screen for the camera of this frame (a gesture or animation moved it).
    manipulatorLayer.beforeRender(
      worldPerPx(mounted.canvas.clientHeight),
      viewDirection(),
      rig.orientation,
    );
    // autoClear is off because of the view cube drawn over the main scene.
    renderer.clear();
    renderer.render(scene, rig.camera);
    viewCube.draw(renderer, rig.orientation);
    emitViewChanged(mounted.canvas);
    // The scheduler clears its pending frame before draw, so this asks for the next one.
    if (animating || fading) scheduleFrame();
  }

  /**
   * viewChanged after the frame when its camera or view area differs from the last frame (spec 09,
   * "Vzhled od M19"): an animation sends it every frame, a still scene never.
   */
  function emitViewChanged(canvas: HTMLCanvasElement): void {
    const next: ViewSnapshot = {
      target: rig.target,
      orientation: rig.orientation,
      halfHeight: rig.halfHeight,
      width: canvas.clientWidth,
      height: canvas.clientHeight,
    };
    const changed = viewChangedSince(lastView, next);
    lastView = next;
    if (!changed) return;
    viewGeneration += 1;
    emitter.emit('viewChanged', { generation: viewGeneration });
  }

  /** Ray through (x, y) CSS px of a canvas of width × height CSS px (both > 0). */
  function rayAt(
    x: number,
    y: number,
    width: number,
    height: number,
  ): { origin: Vec3; direction: Vec3 } {
    const cam = rig.camera;
    cam.updateMatrixWorld();
    // Orthographic: the origin is on the near plane (NDC z = -1), the direction is the view
    // direction for the whole canvas (spec 09, "Picking" point 3).
    const ndc = toNdc(x, y, width, height);
    const origin = new THREE.Vector3(ndc.x, ndc.y, -1).unproject(cam);
    const direction = new THREE.Vector3(0, 0, -1).transformDirection(cam.matrixWorld);
    return {
      origin: [origin.x, origin.y, origin.z],
      direction: [direction.x, direction.y, direction.z],
    };
  }

  /**
   * World units per CSS px of the orthographic camera on a canvas `height` CSS px tall; a canvas
   * without a size gives 1, whatever is drawn then is not seen.
   */
  function worldPerPx(height: number): number {
    const cam = rig.camera;
    return height > 0 ? (cam.top - cam.bottom) / cam.zoom / height : 1;
  }

  /** Unit direction the camera looks in. */
  function viewDirection(): Vec3 {
    const cam = rig.camera;
    cam.updateMatrixWorld();
    const d = new THREE.Vector3(0, 0, -1).transformDirection(cam.matrixWorld);
    return [d.x, d.y, d.z];
  }

  /** World → CSS px of a width × height CSS px canvas by the current camera (spec 09, M18). */
  function handleProjection(width: number, height: number): HandleProjection {
    const cam = rig.camera;
    const direction = viewDirection();
    cam.updateProjectionMatrix();
    const matrix = new THREE.Matrix4().multiplyMatrices(
      cam.projectionMatrix,
      cam.matrixWorldInverse,
    );
    const scratch = new THREE.Vector3();
    return {
      project: (p: Vec3): ScreenPoint => {
        scratch.set(...p).applyMatrix4(matrix);
        return [((scratch.x + 1) / 2) * width, ((1 - scratch.y) / 2) * height];
      },
      worldPerPx: worldPerPx(height),
      viewDirection: direction,
    };
  }

  function assertAlive(): void {
    assert(!disposed, 'Viewport used after dispose');
  }

  function resize(el: HTMLElement): void {
    if (mounted === null) return;
    const width = el.clientWidth;
    const height = el.clientHeight;
    // A hidden element (display: none) has no size; keep the last frustum.
    if (width <= 0 || height <= 0) return;
    // updateStyle false: the canvas fills the element by CSS, so its size never feeds back.
    mounted.renderer.setSize(width, height, false);
    rig.resize(width, height);
    highlightLayer.setResolution(width, height);
    sketchLayer.setResolution(width, height);
    manipulatorLayer.setResolution(width, height);
    scheduleFrame();
  }

  function listen<K extends keyof HTMLElementEventMap>(
    resources: DisposableStore,
    target: HTMLElement,
    type: K,
    fn: (e: HTMLElementEventMap[K]) => void,
  ): void {
    target.addEventListener(type, fn);
    resources.add(() => {
      target.removeEventListener(type, fn);
    });
  }

  /** `button` overrides PointerEvent.button (pointercancel reports -1). */
  function emitPointer(type: ViewPointerEvent['type'], e: PointerEvent, button = e.button): void {
    const input = {
      type,
      offsetX: e.offsetX,
      offsetY: e.offsetY,
      button,
      shiftKey: e.shiftKey,
      altKey: e.altKey,
      ctrlKey: e.ctrlKey,
      metaKey: e.metaKey,
    };
    emitter.emit('pointer', toViewPointerEvent(input, isMac));
  }

  function mount(el: HTMLElement): void {
    assertAlive();
    assert(mounted === null, 'Viewport is already mounted');
    const resources = new DisposableStore();
    try {
      attach(el, resources);
      // The default view on the first mount; a remount keeps the camera (spec: the scene stays).
      if (!everMounted) rig.setView('iso');
    } catch (error) {
      // A failed mount (e.g. no WebGL) leaves nothing behind: the viewport stays unmounted and
      // can be mounted again.
      mounted = null;
      resources.dispose();
      throw error;
    }
    everMounted = true;
    scheduleFrame();
  }

  /** Creates the mounted resources into `resources`; on a throw the caller disposes them. */
  function attach(el: HTMLElement, resources: DisposableStore): void {
    const canvas = document.createElement('canvas');
    // Focusable, so it receives keydown.
    canvas.tabIndex = 0;
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.outline = 'none';
    el.appendChild(canvas);
    resources.add(() => {
      canvas.remove();
    });

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setClearColor(palette.background);
    renderer.autoClear = false;
    resources.add(() => {
      renderer.dispose();
      // dispose() keeps the WebGL context; browsers allow only a few, so release it on remount.
      renderer.forceContextLoss();
    });

    mounted = { canvas, renderer, resources };
    resize(el);

    rig.attach(canvas);
    resources.add(() => {
      rig.detach();
    });

    viewCube.mount(el, canvas);
    resources.add(() => {
      viewCube.unmount();
    });
    listen(resources, canvas, 'pointerdown', (e) => {
      // A manipulator drag goes on outside the canvas (spec 09, "Události"); the browser
      // releases the capture on pointerup. Right and middle are captured by the camera input.
      // Emitted first: a capture that throws (an unknown pointerId) must not swallow the down.
      emitPointer('down', e);
      if (e.button === 0) canvas.setPointerCapture(e.pointerId);
    });
    listen(resources, canvas, 'pointermove', (e) => {
      emitPointer('move', e);
    });
    listen(resources, canvas, 'pointerup', (e) => {
      emitPointer('up', e);
    });
    // The system broke the gesture off (spec 09, "Události"): a left up, so a manipulator drag
    // does not get stuck. Not lostpointercapture: it also follows every plain pointerup and the
    // SelectTool would see the click twice.
    listen(resources, canvas, 'pointercancel', (e) => {
      emitPointer('up', e, 0);
    });
    listen(resources, canvas, 'pointerleave', (e) => {
      emitPointer('leave', e);
    });
    listen(resources, canvas, 'keydown', (e) => {
      emitter.emit('key', toViewKeyEvent(e, isMac, false));
    });
    // The right button orbits the camera; no context menu over the view.
    listen(resources, canvas, 'contextmenu', (e) => {
      e.preventDefault();
    });

    const observer = new ResizeObserver(() => {
      resize(el);
    });
    observer.observe(el);
    resources.add(() => {
      observer.disconnect();
    });
  }

  function unmount(): void {
    assertAlive();
    if (mounted === null) return;
    const { resources } = mounted;
    mounted = null;
    // The next mount draws a first frame again, and it announces the view.
    lastView = null;
    resources.dispose();
  }

  const events: Subscribable<ViewportEvents> = {
    on<K extends keyof ViewportEvents>(type: K, fn: (e: ViewportEvents[K]) => void): Unsubscribe {
      assertAlive();
      return emitter.on(type, fn);
    },
    once<K extends keyof ViewportEvents>(type: K, fn: (e: ViewportEvents[K]) => void): Unsubscribe {
      assertAlive();
      return emitter.once(type, fn);
    },
  };

  const bodies: BodyLayer = {
    sync(next) {
      assertAlive();
      return layer.sync(next);
    },
    reset(meshes) {
      assertAlive();
      // The preview shares the mesh cache and holds handles of the old kernel as well.
      layers.reset(meshes);
    },
  };

  const preview: PreviewLayer = {
    sync(next) {
      assertAlive();
      return layers.preview.sync(next);
    },
    clear() {
      assertAlive();
      layers.preview.clear();
    },
  };

  const highlight: HighlightLayer = {
    setHover(target) {
      assertAlive();
      highlightLayer.setHover(target);
    },
    setSelection(targets) {
      assertAlive();
      highlightLayer.setSelection(targets);
    },
  };
  const overlay: OverlayLayer = {
    set(id, shapes) {
      assertAlive();
      overlayLayer.set(id, shapes);
    },
    remove(id) {
      assertAlive();
      overlayLayer.remove(id);
    },
    clear() {
      assertAlive();
      overlayLayer.clear();
    },
  };

  const sketches: SketchLayer = {
    set(id, drawing) {
      assertAlive();
      sketchLayer.set(id, drawing);
    },
    remove(id) {
      assertAlive();
      sketchLayer.remove(id);
    },
  };

  const manipulators: ManipulatorLayer = {
    set(handles) {
      assertAlive();
      manipulatorLayer.set(handles);
    },
    pick(x, y) {
      assertAlive();
      if (mounted === null) return null;
      const { clientWidth, clientHeight } = mounted.canvas;
      if (clientWidth <= 0 || clientHeight <= 0) return null;
      // The camera as the next frame draws it (near/far may move the camera along its view).
      updateClip();
      return manipulatorLayer.pick(x, y, handleProjection(clientWidth, clientHeight));
    },
  };

  const camera: CameraController = {
    fitAll() {
      assertAlive();
      rig.fitAll();
    },
    setView(view) {
      assertAlive();
      rig.setView(view);
    },
    setViewDirection(direction) {
      assertAlive();
      rig.setViewDirection(direction);
    },
  };

  return {
    mount,
    unmount,
    requestRender(): void {
      assertAlive();
      scheduleFrame();
    },
    pick(x: number, y: number, filter?: PickFilter): PickResult | null {
      assertAlive();
      if (mounted === null) return null;
      updateClip();
      const { clientWidth, clientHeight } = mounted.canvas;
      // Sketches first; a hit hidden behind a body does not count, except in the edited sketch
      // (spec 09, "Skici", M19.2).
      const visible = (point: Vec3): boolean => picker.isVisible(rig.camera, point);
      if (filter?.includes('sketchEntity') === true) {
        const hit = sketchLayer.pick(rig.camera, x, y, clientWidth, clientHeight, visible);
        if (hit !== null) return hit;
      }
      // Then regions, with the same occlusion (spec 09, "Skici": sketchEntity > sketchRegion).
      if (filter?.includes('sketchRegion') === true && clientWidth > 0 && clientHeight > 0) {
        const hit = sketchLayer.pickRegion(rayAt(x, y, clientWidth, clientHeight), visible);
        if (hit !== null) return hit;
      }
      return picker.pick(rig.camera, x, y, clientWidth, clientHeight, filter);
    },
    project(world: Vec3): readonly [x: number, y: number] | null {
      assertAlive();
      if (mounted === null) return null;
      const { clientWidth, clientHeight } = mounted.canvas;
      if (clientWidth <= 0 || clientHeight <= 0) return null;
      // No updateClip: near/far and the distance along the view do not move x and y of an
      // orthographic projection.
      return handleProjection(clientWidth, clientHeight).project(world);
    },
    screenToRay(x: number, y: number): { origin: Vec3; direction: Vec3 } {
      assertAlive();
      assert(mounted !== null, 'screenToRay needs a mounted viewport');
      const width = mounted.canvas.clientWidth;
      const height = mounted.canvas.clientHeight;
      assert(width > 0 && height > 0, 'screenToRay needs a canvas with a size');
      updateClip();
      return rayAt(x, y, width, height);
    },
    bodies,
    preview,
    syncLayers(next) {
      assertAlive();
      return layers.syncLayers(next);
    },
    highlight,
    overlay,
    sketches,
    manipulators,
    camera,
    sketchGridStep(): number {
      assertAlive();
      return sketchGridStep(lastWorldPerPx);
    },
    setPalette(next: ScenePalette): void {
      assertAlive();
      palette = next;
      layers.setPalette(next);
      highlightLayer.setPalette(next);
      overlayLayer.setPalette(next);
      sketchLayer.setPalette(next);
      manipulatorLayer.setPalette(next);
      helpers.setPalette(next);
      viewCube.setPalette(next);
      // While unmounted, mount takes the background from `palette`.
      mounted?.renderer.setClearColor(next.background);
      scheduleFrame();
    },
    setBodyVisible(body: BodyId, visible: boolean): void {
      assertAlive();
      layers.setBodyVisible(body, visible);
    },
    setBodyColor(body: BodyId, color: string | null): void {
      assertAlive();
      layers.setBodyColor(body, color);
    },
    setViewCubeLabels(labels: ViewCubeLabels): void {
      assertAlive();
      viewCube.setLabels(labels);
    },
    setOrbitMode(mode: OrbitMode): void {
      assertAlive();
      rig.setOrbitMode(mode);
      viewCube.setOrbitMode(mode);
    },
    onOrbitModeToggle(listener: () => void): Unsubscribe {
      assertAlive();
      return orbitModeToggles.on('toggle', listener);
    },
    events,
    dispose(): void {
      if (disposed) return;
      unmount();
      disposed = true;
      // Dropping the emitter drops every subscriber.
      emitter = new Emitter<ViewportEvents>();
      orbitModeToggles = new Emitter<OrbitModeEvents>();
      scene.remove(
        rig.camera,
        layer.group,
        layers.preview.group,
        highlightLayer.group,
        overlayLayer.group,
        sketchLayer.group,
        manipulatorLayer.group,
      );
      // In reverse order: view cube, helpers, camera rig, manipulators, sketches, overlay,
      // highlight, then the body layers (preview and main), which dispose every BodyView and
      // their shared materials and make a running sync stale.
      lifetime.dispose();
    },
  };
}
