// Kernel supervisor (spec 11, "Restart jádra"; Q055, Q049): owns the current geometry kernel and
// its Regenerator. A kernel that ends 'disconnected' (WASM trap, crashed worker) is dropped with
// its Regenerator, which is dead from then on, and a new pair is started. A second crash within
// RESTART_WINDOW_MS gives up ('failed'), so crashes do not cycle. A kernel that does not start at
// all (the worker or the WASM fails to load, OCCT fails to initialise) is 'unavailable', with the
// text of its error; a kernel that starts only after dispose is released and never reported ready.

import { ObservableValue } from '@/core';
import type { Disposable, Observable } from '@/core';
import type { GeometryKernel } from '@/kernel';
import type { Regenerator } from '@/regen';

export type KernelUiState = 'starting' | 'ready' | 'restarting' | 'failed' | 'unavailable';

/** A crash this soon after the previous one is not restarted (spec 11). */
export const RESTART_WINDOW_MS = 10_000;

export interface KernelSupervisor extends Disposable {
  readonly state: Observable<KernelUiState>;
  /** Text of the error of a kernel that failed to start ('unavailable'); null otherwise. */
  readonly error: Observable<string | null>;
  /**
   * The Regenerator of the live kernel; null while starting, restarting, failed, unavailable or
   * disposed.
   */
  regenerator(): Regenerator | null;
  /**
   * The Regenerator rejected with RpcError 'disconnected': its kernel is gone. The loss of a
   * Regenerator that is no longer current is an echo and is ignored.
   */
  lost(regenerator: Regenerator): void;
}

interface Live {
  readonly kernel: GeometryKernel & Disposable;
  readonly regenerator: Regenerator;
}

/** Starts the first kernel at once. */
export function createKernelSupervisor(deps: {
  createKernel: () => Promise<GeometryKernel & Disposable>;
  createRegenerator: (kernel: GeometryKernel) => Regenerator;
  now: () => number;
  /** A new kernel is ready (start or restart): app resets the viewport and regenerates. */
  onReady: (kernel: GeometryKernel) => void;
  /** A kernel failed to start (also a restart): the supervisor is 'unavailable' from then on. */
  onError: (error: unknown) => void;
}): KernelSupervisor {
  const state = new ObservableValue<KernelUiState>('starting');
  const error = new ObservableValue<string | null>(null);
  let live: Live | null = null;
  let lastCrashAt: number | undefined;
  let disposed = false;

  async function start(): Promise<void> {
    let kernel: GeometryKernel & Disposable;
    try {
      kernel = await deps.createKernel();
    } catch (e) {
      if (disposed) return;
      error.set(errorText(e));
      state.set('unavailable');
      deps.onError(e);
      return;
    }
    // The session ended while the kernel was starting: nobody will use it.
    if (disposed) {
      kernel.dispose();
      return;
    }
    live = { kernel, regenerator: deps.createRegenerator(kernel) };
    state.set('ready');
    deps.onReady(kernel);
  }

  function drop(): void {
    const last = live;
    live = null;
    last?.kernel.dispose();
  }

  void start();

  return {
    state: state.asObservable(),
    error: error.asObservable(),
    regenerator: () => live?.regenerator ?? null,
    lost(regenerator) {
      if (disposed || live?.regenerator !== regenerator) return;
      drop();
      const at = deps.now();
      const again = lastCrashAt !== undefined && at - lastCrashAt < RESTART_WINDOW_MS;
      lastCrashAt = at;
      if (again) {
        state.set('failed');
        return;
      }
      state.set('restarting');
      void start();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      drop();
    },
  };
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
