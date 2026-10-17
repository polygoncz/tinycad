// Test-only entry point of app: a fake AppViewport and settle. dependency-cruiser allows importing
// it only from *.test.ts.

import { Emitter } from '@/core';
import type { Subscribable, Unsubscribe, Vec3 } from '@/core';
import type { BodyId, BodyMaterial } from '@/document';
import type {
  HandleView,
  HighlightPort,
  HighlightTarget,
  ManipulatorPort,
  OverlayPort,
  OverlayShape,
  PickFilter,
  PickResult,
  SketchDrawing,
  SketchPort,
  ViewChangedEvent,
  ViewKeyEvent,
  ViewPointerEvent,
  ViewportEvents,
} from '@/interaction';
import { FakeViewport } from '@/interaction/testing';
import type { MeshOps, ShapeHandle } from '@/kernel';
import type {
  AoSettings,
  DisplayStyle,
  OrbitMode,
  ScenePalette,
  StandardView,
  ViewCubeLabels,
} from '@/render';
import type { AppViewport } from './app-session';

type SyncedBody = { readonly id: BodyId; readonly shape: ShapeHandle };
type Ray = ReturnType<FakeViewport['screenToRay']>;

/**
 * An AppViewport for tests: the ViewportPort part of FakeViewport plus recorded mount, body
 * syncs, kernel resets, camera calls (views and view directions), palettes, body visibility,
 * body colours (M15), view cube labels (M17), rotation modes (M17.1) and manipulator views
 * (M18), a prepared projection (M19), step of the sketch grid (M19.2) and display styles (M22);
 * emitOrbitModeToggle plays a click on the rotation mode
 * button, emitViewChanged a move of the view (M19). sync settles at once, or while held only on
 * releaseSyncs (M19.1); like BodyLayer, a newer sync or a reset makes a held sync stale, so it
 * settles without showing its bodies (spec 09). syncLayers (M21) records the main bodies in `syncs`
 * and the preview ones in `previewSyncs` and is held like sync; a held pair shows both layers
 * together on release, a reset empties the preview like the view.
 * It wraps a FakeViewport instead of extending it: a class of another module is no base
 * class (ADR 0011), so its members are passed on one by one.
 */
export class FakeAppViewport implements AppViewport {
  private readonly port = new FakeViewport();
  readonly highlight: HighlightPort = this.port.highlight;
  readonly overlay: OverlayPort = this.port.overlay;
  readonly sketches: SketchPort = this.port.sketches;
  readonly manipulators: ManipulatorPort = this.port.manipulators;
  readonly events: Subscribable<ViewportEvents> = this.port.events;

  /** Element of the last mount, null before any. */
  mountedOn: HTMLElement | null = null;
  /** Bodies of every sync call, oldest first. */
  readonly syncs: (readonly SyncedBody[])[] = [];
  /** Preview bodies of every syncLayers call, oldest first (M21). */
  readonly previewSyncs: (readonly SyncedBody[])[] = [];
  /** MeshOps of every reset call, oldest first. */
  readonly resets: MeshOps[] = [];
  fitAllCount = 0;
  readonly views: StandardView[] = [];
  /** Directions of every camera.setViewDirection call, oldest first. */
  readonly viewDirections: Vec3[] = [];
  /** Palette of the last setPalette, null before any. */
  palette: ScenePalette | null = null;
  /** Every setBodyVisible call, oldest first. */
  readonly visibilityCalls: { readonly body: BodyId; readonly visible: boolean }[] = [];
  /** Every setBodyColor call, oldest first (M15). */
  readonly colorCalls: { readonly body: BodyId; readonly color: string | null }[] = [];
  /** Every setBodyMaterial call, oldest first (M24). */
  readonly materialCalls: { readonly body: BodyId; readonly material: BodyMaterial }[] = [];
  /** Labels of every setViewCubeLabels call, oldest first (M17). */
  readonly viewCubeLabels: ViewCubeLabels[] = [];
  /** Mode of every setOrbitMode call, oldest first (M17.1). */
  readonly orbitModes: OrbitMode[] = [];
  /** Style of every setDisplayStyle call, oldest first (M22). */
  readonly displayStyles: DisplayStyle[] = [];
  /** Settings of every setAoSettings call, oldest first (M23). */
  readonly aoSettings: AoSettings[] = [];
  private readonly orbitModeToggles = new Emitter<{ toggle: undefined }>();
  /** Bodies of the last sync that settled current, [] after a reset (M19.1). */
  private shownBodies: readonly SyncedBody[] = [];
  /**
   * Syncs waiting for releaseSyncs (M19.1); at most one, a newer sync makes the held one stale.
   * `preview` is set for a held syncLayers (M21), which shows both layers on release.
   */
  private readonly held: {
    readonly bodies: readonly SyncedBody[];
    readonly preview?: readonly SyncedBody[];
    readonly settle: () => void;
  }[] = [];
  private holding = false;
  /** Bodies of the preview: of the last syncLayers that settled current, [] after a reset (M21). */
  private previewBodies: readonly SyncedBody[] = [];
  private gridStep = 1;

  readonly bodies = {
    sync: (bodies: readonly SyncedBody[]): Promise<void> => {
      const copy = bodies.map(({ id, shape }) => ({ id, shape }));
      this.syncs.push(copy);
      this.dropHeld();
      if (!this.holding) {
        this.shownBodies = copy;
        return Promise.resolve();
      }
      return new Promise((resolve) => {
        this.held.push({ bodies: copy, settle: resolve });
      });
    },
    reset: (meshes: MeshOps): void => {
      this.resets.push(meshes);
      this.shownBodies = [];
      // The preview shares the meshes of the kernel (spec 09).
      this.previewBodies = [];
      this.dropHeld();
    },
  };

  syncLayers(next: {
    readonly main: readonly SyncedBody[];
    readonly preview: readonly SyncedBody[];
  }): Promise<void> {
    const copy = (bodies: readonly SyncedBody[]): SyncedBody[] =>
      bodies.map(({ id, shape }) => ({ id, shape }));
    const main = copy(next.main);
    const preview = copy(next.preview);
    this.syncs.push(main);
    this.previewSyncs.push(preview);
    this.dropHeld();
    if (!this.holding) {
      this.shownBodies = main;
      this.previewBodies = preview;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.held.push({ bodies: main, preview, settle: resolve });
    });
  }

  readonly camera = {
    fitAll: (): void => {
      this.fitAllCount++;
    },
    setView: (view: StandardView): void => {
      this.views.push(view);
    },
    setViewDirection: (direction: Vec3): void => {
      this.viewDirections.push(direction);
    },
  };

  mount(el: HTMLElement): void {
    this.mountedOn = el;
  }

  setPalette(palette: ScenePalette): void {
    this.palette = palette;
  }

  setBodyVisible(body: BodyId, visible: boolean): void {
    this.visibilityCalls.push({ body, visible });
  }

  setBodyColor(body: BodyId, color: string | null): void {
    this.colorCalls.push({ body, color });
  }

  setBodyMaterial(body: BodyId, material: BodyMaterial): void {
    this.materialCalls.push({ body, material });
  }

  setViewCubeLabels(labels: ViewCubeLabels): void {
    this.viewCubeLabels.push(labels);
  }

  setOrbitMode(mode: OrbitMode): void {
    this.orbitModes.push(mode);
  }

  onOrbitModeToggle(listener: () => void): Unsubscribe {
    return this.orbitModeToggles.on('toggle', listener);
  }

  setDisplayStyle(style: DisplayStyle): void {
    this.displayStyles.push(style);
  }

  setAoSettings(settings: AoSettings): void {
    this.aoSettings.push(settings);
  }

  /** Plays a click on the rotation mode button of the view cube (M17.1). */
  emitOrbitModeToggle(): void {
    this.orbitModeToggles.emit('toggle', undefined);
  }

  /** A fixed result, or a function of the view coordinates (FakeViewport.setPick). */
  setPick(result: Parameters<FakeViewport['setPick']>[0]): void {
    this.port.setPick(result);
  }

  setScreenToRay(fn: (x: number, y: number) => Ray): void {
    this.port.setScreenToRay(fn);
  }

  /** The result of manipulators.pick (FakeViewport.prepareHandlePick, M18). */
  prepareHandlePick(fn: (x: number, y: number) => string | null): void {
    this.port.prepareHandlePick(fn);
  }

  pick(x: number, y: number, filter?: PickFilter): PickResult | null {
    return this.port.pick(x, y, filter);
  }

  screenToRay(x: number, y: number): Ray {
    return this.port.screenToRay(x, y);
  }

  /** The result of project as a function of the world point (FakeViewport.prepareProject, M19). */
  prepareProject(fn: (world: Vec3) => readonly [x: number, y: number] | null): void {
    this.port.prepareProject(fn);
  }

  /** The step sketchGridStep returns from now on (M19.2); 1 until a test prepares another. */
  prepareSketchGridStep(step: number): void {
    this.gridStep = step;
  }

  sketchGridStep(): number {
    return this.gridStep;
  }

  /** FakeViewport.project: null until a test prepares it (M19). */
  project(world: Vec3): readonly [x: number, y: number] | null {
    return this.port.project(world);
  }

  /** Last state passed to highlight.setHover. */
  get hover(): HighlightTarget | null {
    return this.port.hover;
  }

  /** Last state passed to highlight.setSelection. */
  get selection(): readonly HighlightTarget[] {
    return this.port.selection;
  }

  /** Last overlay state per id. */
  get overlayShapes(): ReadonlyMap<string, readonly OverlayShape[]> {
    return this.port.overlayShapes;
  }

  /** Current sketch drawings per id (FakeViewport.sketchDrawings). */
  get sketchDrawings(): ReadonlyMap<string, SketchDrawing> {
    return this.port.sketchDrawings;
  }

  /** Last state passed to manipulators.set (M18). */
  get manipulatorViews(): readonly HandleView[] {
    return this.port.manipulatorViews;
  }

  emitPointer(e: ViewPointerEvent): void {
    this.port.emitPointer(e);
  }

  emitKey(e: ViewKeyEvent): void {
    this.port.emitKey(e);
  }

  /** Plays a move of the view: the HUD positions are stale (M19). */
  emitViewChanged(e: ViewChangedEvent): void {
    this.port.emitViewChanged(e);
  }

  /** Bodies of the last sync; empty before any. */
  get lastSync(): readonly SyncedBody[] {
    return this.syncs[this.syncs.length - 1] ?? [];
  }

  /** Bodies the view shows: those of the last sync that settled current (M19.1). */
  get shown(): readonly SyncedBody[] {
    return this.shownBodies;
  }

  /** Bodies the preview shows (M21): those of the last current syncLayers, [] after a reset. */
  get previewShown(): readonly SyncedBody[] {
    return this.previewBodies;
  }

  /** Number of syncs held back now (M19.1). */
  get heldSyncs(): number {
    return this.held.length;
  }

  /** Every later sync stays pending until releaseSyncs, a newer sync or a reset (M19.1). */
  holdSyncs(): void {
    this.holding = true;
  }

  /** Settles the held sync and shows its bodies; later syncs settle at once again. */
  releaseSyncs(): void {
    this.holding = false;
    for (const { bodies, preview, settle } of this.held.splice(0)) {
      this.shownBodies = bodies;
      if (preview !== undefined) this.previewBodies = preview;
      settle();
    }
  }

  /** A newer sync or a reset makes the held syncs stale: they settle and show nothing. */
  private dropHeld(): void {
    for (const { settle } of this.held.splice(0)) settle();
  }
}

/** Lets every pending promise chain of resolved fakes run to its end (one macrotask). */
export function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
