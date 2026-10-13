// Test-only entry point of app: a fake AppViewport, a kernel that can crash and a factory that
// records the kernels it made. dependency-cruiser allows importing it only from *.test.ts.

import { RpcError } from '@/core';
import type { Disposable, Subscribable } from '@/core';
import type { BodyId } from '@/document';
import type {
  HighlightPort,
  HighlightTarget,
  OverlayPort,
  OverlayShape,
  PickFilter,
  PickResult,
  ViewKeyEvent,
  ViewPointerEvent,
  ViewportEvents,
} from '@/interaction';
import { FakeViewport } from '@/interaction/testing';
import type { GeometryKernel, MeshOps, ShapeHandle } from '@/kernel';
import { createFakeKernel } from '@/kernel/testing';
import type { FakeKernel } from '@/kernel/testing';
import type { ScenePalette, StandardView } from '@/render';
import type { DocumentLocks } from './doc-lock';
import type { AppViewport } from './session';

type SyncedBody = { readonly id: BodyId; readonly shape: ShapeHandle };
type Ray = ReturnType<FakeViewport['screenToRay']>;

/**
 * An AppViewport for tests: the ViewportPort part of FakeViewport plus recorded mount, body
 * syncs, kernel resets, camera calls, palettes and body visibility. sync resolves at once.
 * It wraps a FakeViewport instead of extending it: a class of another module is no base
 * class (ADR 0011), so its members are passed on one by one.
 */
export class FakeAppViewport implements AppViewport {
  private readonly port = new FakeViewport();
  readonly highlight: HighlightPort = this.port.highlight;
  readonly overlay: OverlayPort = this.port.overlay;
  readonly events: Subscribable<ViewportEvents> = this.port.events;

  /** Element of the last mount, null before any. */
  mountedOn: HTMLElement | null = null;
  /** Bodies of every sync call, oldest first. */
  readonly syncs: (readonly SyncedBody[])[] = [];
  /** MeshOps of every reset call, oldest first. */
  readonly resets: MeshOps[] = [];
  fitAllCount = 0;
  readonly views: StandardView[] = [];
  /** Palette of the last setPalette, null before any. */
  palette: ScenePalette | null = null;
  /** Every setBodyVisible call, oldest first. */
  readonly visibilityCalls: { readonly body: BodyId; readonly visible: boolean }[] = [];

  readonly bodies = {
    sync: (bodies: readonly SyncedBody[]): Promise<void> => {
      this.syncs.push(bodies.map(({ id, shape }) => ({ id, shape })));
      return Promise.resolve();
    },
    reset: (meshes: MeshOps): void => {
      this.resets.push(meshes);
    },
  };

  readonly camera = {
    fitAll: (): void => {
      this.fitAllCount++;
    },
    setView: (view: StandardView): void => {
      this.views.push(view);
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

  /** A fixed result, or a function of the view coordinates (FakeViewport.setPick). */
  setPick(result: Parameters<FakeViewport['setPick']>[0]): void {
    this.port.setPick(result);
  }

  setScreenToRay(fn: (x: number, y: number) => Ray): void {
    this.port.setScreenToRay(fn);
  }

  pick(x: number, y: number, filter?: PickFilter): PickResult | null {
    return this.port.pick(x, y, filter);
  }

  screenToRay(x: number, y: number): Ray {
    return this.port.screenToRay(x, y);
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

  emitPointer(e: ViewPointerEvent): void {
    this.port.emitPointer(e);
  }

  emitKey(e: ViewKeyEvent): void {
    this.port.emitKey(e);
  }

  /** Bodies of the last sync; empty before any. */
  get lastSync(): readonly SyncedBody[] {
    return this.syncs[this.syncs.length - 1] ?? [];
  }
}

/** A FakeKernel that can crash like a dead worker: every later call rejects 'disconnected'. */
export interface CrashableKernel extends GeometryKernel, Disposable {
  readonly fake: FakeKernel;
  /** From now on every call rejects with RpcError 'disconnected'. */
  crash(): void;
  readonly disposed: boolean;
}

export function createCrashableKernel(): CrashableKernel {
  const fake = createFakeKernel();
  let crashed = false;
  let disposed = false;
  const guard = <T>(call: () => Promise<T>): Promise<T> =>
    crashed ? Promise.reject(new RpcError('disconnected', 'Kernel crashed')) : call();
  return {
    fake,
    makeBox: (p) => guard(() => fake.makeBox(p)),
    makeCylinder: (p) => guard(() => fake.makeCylinder(p)),
    transform: (shape, m) => guard(() => fake.transform(shape, m)),
    boolean: (op, targets, tools) => guard(() => fake.boolean(op, targets, tools)),
    tessellate: (shape, q) => guard(() => fake.tessellate(shape, q)),
    boundingBox: (shape) => guard(() => fake.boundingBox(shape)),
    release: (handles) => guard(() => fake.release(handles)),
    liveHandleCount: () => guard(() => fake.liveHandleCount()),
    crash: () => {
      crashed = true;
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
