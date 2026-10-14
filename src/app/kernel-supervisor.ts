// Kernel supervisor (spec 11, "Restart jádra"; Q055, Q049, M19.1 D2): owns the current geometry
// kernel and its Regenerator. Whether a kernel crashed is decided by its connection: the
// supervisor subscribes to onDisconnected of every kernel it starts, so a crash is restarted no
// matter who ran into it first (a regeneration, a tessellation of the viewport, an export). A
// Regenerator that rejected 'disconnected' is the second way to report the same. The crashed
// kernel is dropped with its Regenerator, which is dead from then on, and a new pair is started.
// At most RESTART_LIMIT crashes within a sliding RESTART_WINDOW_MS of the monotonic clock are
// restarted; the next one gives up ('failed', with its cause), so crashes do not cycle. A kernel
// that does not start at all (the worker or the WASM fails to load, OCCT fails to initialise) is
// 'unavailable', with the text of its error. retry() starts again from both. A kernel that starts
// only after dispose is released and never reported ready.

import { ObservableValue } from '@/core';
import type { Disposable, Observable, Unsubscribe } from '@/core';
import type { GeometryKernel } from '@/kernel';
import type { Regenerator } from '@/regen';

export type KernelUiState = 'starting' | 'ready' | 'restarting' | 'failed' | 'unavailable';

/** At most this many crashes within RESTART_WINDOW_MS are restarted; the next one is 'failed'. */
export const RESTART_LIMIT = 3;
/** The sliding window of RESTART_LIMIT, in ms of the monotonic clock (D2). */
export const RESTART_WINDOW_MS = 60_000;

/**
 * The port of the supervisor (ADR 0009, 0011: app defines what it needs): a kernel that can be
 * released and that reports its own death. createOcctKernel is one; tests use CrashableKernel.
 */
export type SupervisedKernel = GeometryKernel &
  Disposable & {
    /**
     * The kernel died (crashed worker, WASM trap): told once; not told by dispose. A listener
     * that subscribes after the death is told at once (RpcClient.onDisconnected).
     */
    onDisconnected(listener: (error: Error) => void): Unsubscribe;
  };

export interface KernelSupervisor extends Disposable {
  readonly state: Observable<KernelUiState>;
  /**
   * Text of the cause: why the kernel did not start ('unavailable') or why it crashed the last
   * time ('failed'); null otherwise.
   */
  readonly error: Observable<string | null>;
  /**
   * The Regenerator of the live kernel; null while starting, restarting, failed, unavailable or
   * disposed.
   */
  regenerator(): Regenerator | null;
  /**
   * The live kernel (the one of regenerator(), for the STEP export, M15); null in the same
   * states as regenerator().
   */
  kernel(): GeometryKernel | null;
  /** Starts the first kernel. A second call, or one after dispose, does nothing. */
  start(): void;
  /**
   * From 'failed' or 'unavailable': starts a kernel again ('starting') with an empty restart
   * window and no error. In any other state, and after dispose, it does nothing.
   */
  retry(): void;
  /**
   * The Regenerator rejected with RpcError 'disconnected': its kernel is gone. The loss of a
   * Regenerator that is no longer current is an echo and is ignored.
   */
  lost(regenerator: Regenerator): void;
}

interface Live {
  readonly kernel: SupervisedKernel;
  readonly regenerator: Regenerator;
}

/**
 * Cause of a crash reported only by a lost Regenerator. A SupervisedKernel tells onDisconnected
 * before its calls reject, so this is the cause only for a kernel that breaks that contract.
 */
const LOST_IN_REGENERATION = 'The geometry kernel was lost during a regeneration';

/** Starts nothing until start(). */
export function createKernelSupervisor(deps: {
  createKernel: () => Promise<SupervisedKernel>;
  createRegenerator: (kernel: GeometryKernel) => Regenerator;
  /** Monotonic clock in ms (performance.now in the browser): the restart window. */
  monotonic: () => number;
  /** A new kernel is ready (start, restart or retry): app resets the viewport and regenerates. */
  onReady: (kernel: GeometryKernel) => void;
  /** A kernel failed to start (also a restart): the supervisor is 'unavailable' from then on. */
  onError: (error: unknown) => void;
}): KernelSupervisor {
  const state = new ObservableValue<KernelUiState>('starting');
  const error = new ObservableValue<string | null>(null);
  let live: Live | null = null;
  /** Ends the subscription to onDisconnected of the live kernel. */
  let unwatch: Unsubscribe = noop;
  /** Monotonic times of the crashes in the window, oldest first. */
  let crashes: readonly number[] = [];
  let started = false;
  let disposed = false;

  async function launch(): Promise<void> {
    let kernel: SupervisedKernel;
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
    adopt(kernel);
  }

  function adopt(kernel: SupervisedKernel): void {
    live = { kernel, regenerator: deps.createRegenerator(kernel) };
    // Live before subscribing: a kernel that died already is told at once, and must count as a
    // crash of the live kernel (crashed has dropped it and restarts then).
    const stop = kernel.onDisconnected((cause) => {
      crashed(kernel, cause);
    });
    if (!isLive(kernel)) {
      stop();
      return;
    }
    unwatch = stop;
    state.set('ready');
    deps.onReady(kernel);
  }

  /** A function: TS would keep `live` narrowed across the call of onDisconnected. */
  function isLive(kernel: GeometryKernel): boolean {
    return live?.kernel === kernel;
  }

  function crashed(kernel: GeometryKernel, cause: unknown): void {
    // A kernel that is no longer live: an echo of a crash already handled.
    if (disposed || !isLive(kernel)) return;
    drop();
    const at = deps.monotonic();
    crashes = [...crashes.filter((t) => at - t < RESTART_WINDOW_MS), at];
    if (crashes.length > RESTART_LIMIT) {
      error.set(errorText(cause));
      state.set('failed');
      return;
    }
    state.set('restarting');
    void launch();
  }

  function drop(): void {
    const last = live;
    live = null;
    unwatch();
    unwatch = noop;
    last?.kernel.dispose();
  }

  return {
    state: state.asObservable(),
    error: error.asObservable(),
    regenerator: () => live?.regenerator ?? null,
    kernel: () => live?.kernel ?? null,
    start() {
      if (started || disposed) return;
      started = true;
      void launch();
    },
    retry() {
      const current = state.get();
      if (disposed || (current !== 'failed' && current !== 'unavailable')) return;
      crashes = [];
      // The mirror of entering 'failed' (error, then state): the state leaves first.
      state.set('starting');
      error.set(null);
      void launch();
    },
    lost(regenerator) {
      if (live?.regenerator !== regenerator) return;
      crashed(live.kernel, new Error(LOST_IN_REGENERATION));
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      drop();
    },
  };
}

function noop(): void {
  // Nothing to end.
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
