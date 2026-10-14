// Test-only entry point of app: a fake AppViewport, a kernel that can crash, a factory that
// records the kernels it made and a download port that captures the files (M15). dependency-cruiser allows importing it only from *.test.ts.

import { Emitter, RpcError } from '@/core';
import type { Subscribable, Unsubscribe, Vec3 } from '@/core';
import type { BodyId } from '@/document';
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
import { createFakeKernel } from '@/kernel/testing';
import type { FakeKernel } from '@/kernel/testing';
import type { OrbitMode, ScenePalette, StandardView, ViewCubeLabels } from '@/render';
import type { DocumentLocks } from './doc-lock';
import type { DownloadFile } from './file-exporter';
import type { SupervisedKernel } from './kernel-supervisor';
import type { AppViewport } from './session';

type SyncedBody = { readonly id: BodyId; readonly shape: ShapeHandle };
type Ray = ReturnType<FakeViewport['screenToRay']>;

/**
 * An AppViewport for tests: the ViewportPort part of FakeViewport plus recorded mount, body
 * syncs, kernel resets, camera calls (views and view directions), palettes, body visibility,
 * body colours (M15), view cube labels (M17), rotation modes (M17.1) and manipulator views
 * (M18), a prepared projection (M19); emitOrbitModeToggle plays a click on the rotation mode
 * button, emitViewChanged a move of the view (M19). sync settles at once, or while held only on
 * releaseSyncs (M19.1); like BodyLayer, a newer sync or a reset makes a held sync stale, so it
 * settles without showing its bodies (spec 09).
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
  /** Labels of every setViewCubeLabels call, oldest first (M17). */
  readonly viewCubeLabels: ViewCubeLabels[] = [];
  /** Mode of every setOrbitMode call, oldest first (M17.1). */
  readonly orbitModes: OrbitMode[] = [];
  private readonly orbitModeToggles = new Emitter<{ toggle: undefined }>();
  /** Bodies of the last sync that settled current, [] after a reset (M19.1). */
  private shownBodies: readonly SyncedBody[] = [];
  /** Syncs waiting for releaseSyncs (M19.1); at most one, a newer sync makes the held one stale. */
  private readonly held: { readonly bodies: readonly SyncedBody[]; readonly settle: () => void }[] =
    [];
  private holding = false;

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
      this.dropHeld();
    },
  };

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

  setViewCubeLabels(labels: ViewCubeLabels): void {
    this.viewCubeLabels.push(labels);
  }

  setOrbitMode(mode: OrbitMode): void {
    this.orbitModes.push(mode);
  }

  onOrbitModeToggle(listener: () => void): Unsubscribe {
    return this.orbitModeToggles.on('toggle', listener);
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
    for (const { bodies, settle } of this.held.splice(0)) {
      this.shownBodies = bodies;
      settle();
    }
  }

  /** A newer sync or a reset makes the held syncs stale: they settle and show nothing. */
  private dropHeld(): void {
    for (const { settle } of this.held.splice(0)) settle();
  }
}

/**
 * A FakeKernel that can crash like a dead worker (a SupervisedKernel, M19.1): crash() rejects the
 * calls under way and every later one with RpcError 'disconnected' and tells onDisconnected.
 * Like RpcClient.onDisconnected: told once, never by dispose, a late listener at once.
 */
export interface CrashableKernel extends SupervisedKernel {
  readonly fake: FakeKernel;
  /** The worker died: calls under way and later reject 'disconnected' with `message`. */
  crash(message?: string): void;
  readonly disposed: boolean;
}

export function createCrashableKernel(): CrashableKernel {
  const fake = createFakeKernel();
  let crashed: RpcError | null = null;
  /** The crash onDisconnected told: not one that came after dispose. */
  let told: RpcError | null = null;
  let disposed = false;
  /** Rejects of the calls under way. */
  const running = new Set<(error: RpcError) => void>();
  const listeners = new Emitter<{ disconnected: RpcError }>();
  const guard = <T>(call: () => Promise<T>): Promise<T> => {
    if (crashed !== null) return Promise.reject(crashed);
    return new Promise<T>((resolve, reject) => {
      running.add(reject);
      // After a crash the promise is rejected already, so the late result changes nothing.
      call()
        .then(resolve, reject)
        .finally(() => running.delete(reject));
    });
  };
  return {
    fake,
    makeBox: (p) => guard(() => fake.makeBox(p)),
    makeCylinder: (p) => guard(() => fake.makeCylinder(p)),
    transform: (shape, m) => guard(() => fake.transform(shape, m)),
    boolean: (op, targets, tools) => guard(() => fake.boolean(op, targets, tools)),
    makeFace: (p) => guard(() => fake.makeFace(p)),
    extrude: (profile, direction, distance) =>
      guard(() => fake.extrude(profile, direction, distance)),
    revolve: (profile, axis, angle) => guard(() => fake.revolve(profile, axis, angle)),
    fillet: (shape, edges, radius) => guard(() => fake.fillet(shape, edges, radius)),
    chamfer: (shape, edges, distance) => guard(() => fake.chamfer(shape, edges, distance)),
    exportStep: (shapes) => guard(() => fake.exportStep(shapes)),
    tessellate: (shape, q) => guard(() => fake.tessellate(shape, q)),
    boundingBox: (shape) => guard(() => fake.boundingBox(shape)),
    topology: (shape) => guard(() => fake.topology(shape)),
    release: (handles) => guard(() => fake.release(handles)),
    liveHandleCount: () => guard(() => fake.liveHandleCount()),
    crash: (message = 'Kernel crashed') => {
      if (crashed !== null) return;
      const error = new RpcError('disconnected', message);
      crashed = error;
      const waiting = [...running];
      running.clear();
      for (const reject of waiting) reject(error);
      if (disposed) return;
      told = error;
      listeners.emit('disconnected', error);
    },
    onDisconnected: (listener) => {
      if (told !== null) {
        listener(told);
        return () => undefined;
      }
      return listeners.on('disconnected', listener);
    },
    dispose: () => {
      disposed = true;
    },
    get disposed() {
      return disposed;
    },
  };
}

/** createKernel for AppSessionDeps that records every kernel; failNext makes the next start reject. */
export interface KernelFactory {
  readonly create: () => Promise<CrashableKernel>;
  readonly kernels: readonly CrashableKernel[];
  /** The last kernel made; throws when there is none. */
  readonly last: CrashableKernel;
  failNext(error?: Error): void;
}

export function aKernelFactory(): KernelFactory {
  const kernels: CrashableKernel[] = [];
  const failures: Error[] = [];
  return {
    create: () => {
      const failure = failures.shift();
      if (failure !== undefined) return Promise.reject(failure);
      const kernel = createCrashableKernel();
      kernels.push(kernel);
      return Promise.resolve(kernel);
    },
    kernels,
    get last() {
      const kernel = kernels[kernels.length - 1];
      if (kernel === undefined) throw new Error('No kernel was created');
      return kernel;
    },
    failNext: (error: Error = new Error('Kernel start failed')) => {
      failures.push(error);
    },
  };
}

/** Lets every pending promise chain of resolved fakes run to its end (one macrotask). */
export function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** A LockManager with ifAvailable semantics: one holder per name, a busy name gets null. */
export function aFakeLocks(): {
  readonly locks: DocumentLocks;
  /** Names held now. */
  readonly held: Set<string>;
  readonly requests: { name: string; ifAvailable: boolean }[];
} {
  const held = new Set<string>();
  const requests: { name: string; ifAvailable: boolean }[] = [];
  const locks: DocumentLocks = {
    request(name, options, callback) {
      requests.push({ name, ifAvailable: options.ifAvailable });
      if (held.has(name)) return callback(null);
      held.add(name);
      return callback({ name }).finally(() => {
        held.delete(name);
      });
    },
  };
  return { locks, held, requests };
}

/** AppSessionDeps.download that keeps every file (M15). */
export function aDownloads(): {
  readonly download: (file: DownloadFile) => void;
  /** Downloaded files, oldest first. */
  readonly files: readonly DownloadFile[];
} {
  const files: DownloadFile[] = [];
  return {
    download: (file) => {
      files.push(file);
    },
    files,
  };
}
