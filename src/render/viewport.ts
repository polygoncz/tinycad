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
  HighlightPort,
  OverlayPort,
  PickFilter,
  PickResult,
  ViewKeyEvent,
  ViewPointerEvent,
  ViewportEvents,
  ViewportPort,
} from '@/interaction';
import type { MeshOps, MeshQuality } from '@/kernel';
import { createBodyLayer, type BodyLayer } from './body-layer';
import { createCameraRig, type CameraController } from './camera-controller';
import { createFrameScheduler } from './frame-scheduler';
import { createHighlightLayer } from './highlight-layer';
import { createOverlayLayer } from './overlay-layer';
import { LIGHT_PALETTE, type ScenePalette } from './palette';
import { toNdc } from './pick-math';
import { createPicker } from './picker';
import { createSceneHelpers } from './scene-helpers';
import { createSketchLayer, type SketchLayer } from './sketch-layer';
import { toViewKeyEvent, toViewPointerEvent } from './view-events';

/** Hover and selection (spec 09, "Vrstvy pro interakci"). */
export type HighlightLayer = HighlightPort;
/** Temporary geometry of tools (spec 09, "Vrstvy pro interakci"). */
export type OverlayLayer = OverlayPort;

export interface Viewport extends ViewportPort, Disposable {
  /** Creates canvas, renderer, ResizeObserver and camera controls; twice without unmount = error. */
  mount(el: HTMLElement): void;
  /** Releases renderer and canvas; the scene (bodies, camera) stays. Idempotent. */
  unmount(): void;

  /** Rendering on demand, not a 60 fps loop. */
  requestRender(): void;
  /** px relative to the canvas (CSS px); an unmounted viewport → null. Filter: spec 10. */
  pick(x: number, y: number, filter?: PickFilter): PickResult | null;
  /** Unmounted → error. */
  screenToRay(x: number, y: number): { origin: Vec3; direction: Vec3 };

  /** Bodies from regeneration. */
  readonly bodies: BodyLayer;
  /** Hover and selection (implements HighlightPort). */
  readonly highlight: HighlightLayer;
  /** Temporary geometry of tools (implements OverlayPort). */
  readonly overlay: OverlayLayer;
  /** Drawings of sketches and planes (M12, implements SketchPort). */
  readonly sketches: SketchLayer;
  /** Fit all, standard views, normal to a plane (M12). */
  readonly camera: CameraController;

  /** Recolours the existing materials and the background, creates nothing anew (Q072). */
  setPalette(palette: ScenePalette): void;
  /** View state from the browser (Q071): a hidden body is not drawn and not picked. */
  setBodyVisible(body: BodyId, visible: boolean): void;

  readonly events: Subscribable<{ pointer: ViewPointerEvent; key: ViewKeyEvent }>;
}

export const MESH_QUALITY: MeshQuality = { linearDeflection: 0.1, angularDeflection: 0.5 };

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
}): Viewport {
  let palette = deps.palette ?? LIGHT_PALETTE;
  const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);
  const lifetime = new DisposableStore();
  let emitter = new Emitter<ViewportEvents>();
  let mounted: Mounted | null = null;
  let everMounted = false;
  let disposed = false;

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
  const layer = lifetime.add(
    createBodyLayer({
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
  scene.add(layer.group);
  // After the body layer, so they are disposed before it; rebuild after dispose is a no-op.
  const highlightLayer = lifetime.add(
    createHighlightLayer({ views: layer.views, requestRender: scheduleFrame, palette }),
  );
  scene.add(highlightLayer.group);
  const overlayLayer = lifetime.add(createOverlayLayer({ requestRender: scheduleFrame, palette }));
  scene.add(overlayLayer.group);
  const sketchLayer = lifetime.add(createSketchLayer({ requestRender: scheduleFrame, palette }));
  scene.add(sketchLayer.group);
  const rig = lifetime.add(
    createCameraRig({
      getBounds: () => layer.bounds(),
      requestRender: scheduleFrame,
    }),
  );
  // In the scene, so the headlight (its child) is part of the scene graph.
  scene.add(rig.camera);
  const helpers = lifetime.add(createSceneHelpers(scene, rig.camera, palette));
  const picker = createPicker({
    views: () => layer.views.values(),
    bounds: () => layer.bounds(),
  });

  function draw(): void {
    if (mounted === null) return;
    const { renderer } = mounted;
    // autoClear is off because of the axis triad drawn over the main scene.
    renderer.clear();
    renderer.render(scene, rig.camera);
    helpers.drawAxes(renderer, rig.camera);
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

  function emitPointer(type: ViewPointerEvent['type'], e: PointerEvent): void {
    const input = {
      type,
      offsetX: e.offsetX,
      offsetY: e.offsetY,
      button: e.button,
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

    listen(resources, canvas, 'pointerdown', (e) => {
      emitPointer('down', e);
    });
    listen(resources, canvas, 'pointermove', (e) => {
      emitPointer('move', e);
    });
    listen(resources, canvas, 'pointerup', (e) => {
      emitPointer('up', e);
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
      layer.reset(meshes);
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
      const { clientWidth, clientHeight } = mounted.canvas;
      // Sketches first, over the bodies and without occlusion (spec 09, "Skici").
      if (filter?.includes('sketchEntity') === true) {
        const hit = sketchLayer.pick(rig.camera, x, y, clientWidth, clientHeight);
        if (hit !== null) return hit;
      }
      // 'sketchRegion' (M13) is not picked yet: regions come with Ú5, so a filter with only
      // it gives null through the picker.
      return picker.pick(rig.camera, x, y, clientWidth, clientHeight, filter);
    },
    screenToRay(x: number, y: number): { origin: Vec3; direction: Vec3 } {
      assertAlive();
      assert(mounted !== null, 'screenToRay needs a mounted viewport');
      const width = mounted.canvas.clientWidth;
      const height = mounted.canvas.clientHeight;
      assert(width > 0 && height > 0, 'screenToRay needs a canvas with a size');
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
    },
    bodies,
    highlight,
    overlay,
    sketches,
    camera,
    setPalette(next: ScenePalette): void {
      assertAlive();
      palette = next;
      layer.setPalette(next);
      highlightLayer.setPalette(next);
      overlayLayer.setPalette(next);
      sketchLayer.setPalette(next);
      helpers.setPalette(next);
      // While unmounted, mount takes the background from `palette`.
      mounted?.renderer.setClearColor(next.background);
      scheduleFrame();
    },
    setBodyVisible(body: BodyId, visible: boolean): void {
      assertAlive();
      layer.setBodyVisible(body, visible);
    },
    events,
    dispose(): void {
      if (disposed) return;
      unmount();
      disposed = true;
      // Dropping the emitter drops every subscriber.
      emitter = new Emitter<ViewportEvents>();
      scene.remove(
        rig.camera,
        layer.group,
        highlightLayer.group,
        overlayLayer.group,
        sketchLayer.group,
      );
      // In reverse order: helpers, camera rig, sketches, overlay, highlight, then the body
      // layer, which disposes every BodyView and its shared materials and makes a running sync
      // stale.
      lifetime.dispose();
    },
  };
}
