import { describe, expect, it, vi } from 'vitest';
import type { GeometryKernel } from '@/kernel';
import type { Regenerator } from '@/regen';
import { createKernelSupervisor, RESTART_LIMIT, RESTART_WINDOW_MS } from '@/app/kernel-supervisor';
import type { KernelUiState, SupervisedKernel } from '@/app/kernel-supervisor';
import { aKernelFactory, createCrashableKernel, settle } from '@/app/testing';
import type { CrashableKernel } from '@/app/testing';

/** A stand-in Regenerator that remembers its kernel; the supervisor never runs it. */
function aRegenerator(kernel: GeometryKernel): Regenerator & { kernel: GeometryKernel } {
  return {
    kernel,
    run: () => Promise.reject(new Error('not used')),
    events: { on: () => () => undefined, once: () => () => undefined },
  };
}

/** A started supervisor over aKernelFactory, with a manual monotonic clock. */
function aSupervisor(
  createKernel?: () => Promise<SupervisedKernel>,
): ReturnType<typeof anUnstartedSupervisor> {
  const setup = anUnstartedSupervisor(createKernel);
  setup.supervisor.start();
  return setup;
}

function anUnstartedSupervisor(createKernel?: () => Promise<SupervisedKernel>) {
  const factory = aKernelFactory();
  let time = 1000;
  const onReady = vi.fn<(kernel: GeometryKernel) => void>();
  const onError = vi.fn<(e: unknown) => void>();
  const supervisor = createKernelSupervisor({
    createKernel: createKernel ?? factory.create,
    createRegenerator: aRegenerator,
    monotonic: () => time,
    onReady,
    onError,
  });
  const states: KernelUiState[] = [];
  supervisor.state.subscribe(() => states.push(supervisor.state.get()));
  return {
    factory,
    supervisor,
    onReady,
    onError,
    states,
    /** Moves the monotonic clock. */
    advance: (ms: number) => {
      time += ms;
    },
    /** Crashes the live kernel the way its worker would (onDisconnected) and lets it restart. */
    crashLive: async (message = 'OCCT crashed: unreachable') => {
      factory.last.crash(message);
      await settle();
    },
  };
}

function regeneratorOf(supervisor: { regenerator(): Regenerator | null }): Regenerator {
  const regenerator = supervisor.regenerator();
  if (regenerator === null) throw new Error('not ready');
  return regenerator;
}

describe('KernelSupervisor – start', () => {
  it('starts nothing until start(); then starting → ready, a Regenerator and onReady', async () => {
    const { factory, supervisor, onReady, states } = anUnstartedSupervisor();
    await settle();
    expect(factory.kernels).toHaveLength(0);
    expect(supervisor.state.get()).toBe('starting');

    supervisor.start();
    expect(supervisor.regenerator()).toBeNull();
    await settle();
    expect(states).toEqual(['ready']);
    expect(factory.kernels).toHaveLength(1);
    expect(onReady).toHaveBeenCalledWith(factory.last);
    expect(supervisor.regenerator()).not.toBeNull();
  });

  it('a second start() does nothing', async () => {
    const { factory, supervisor } = aSupervisor();
    supervisor.start();
    await settle();
    supervisor.start();
    await settle();
    expect(factory.kernels).toHaveLength(1);
  });

  it('start() after dispose starts nothing', async () => {
    const { factory, supervisor } = anUnstartedSupervisor();
    supervisor.dispose();
    supervisor.start();
    await settle();
    expect(factory.kernels).toHaveLength(0);
  });

  it('kernel(): null while starting, the live kernel when ready, null after a crash', async () => {
    const { factory, supervisor } = aSupervisor();
    expect(supervisor.kernel()).toBeNull();
    await settle();
    expect(supervisor.kernel()).toBe(factory.last);
    supervisor.lost(regeneratorOf(supervisor));
    expect(supervisor.kernel()).toBeNull();
    await settle();
    expect(supervisor.kernel()).toBe(factory.last);
    supervisor.dispose();
    expect(supervisor.kernel()).toBeNull();
  });

  it('a failed start → unavailable with the text of the error, not failed; reported', async () => {
    const { factory, supervisor, onError } = anUnstartedSupervisor();
    factory.failNext(new Error('no wasm'));
    supervisor.start();
    expect(supervisor.error.get()).toBeNull();
    await settle();
    expect(supervisor.state.get()).toBe('unavailable');
    expect(supervisor.error.get()).toBe('no wasm');
    expect(supervisor.regenerator()).toBeNull();
    expect(supervisor.kernel()).toBeNull();
    expect(onError).toHaveBeenCalledWith(new Error('no wasm'));
  });

  it('a kernel that died before the supervisor subscribed is restarted at once', async () => {
    const dead = createCrashableKernel();
    dead.crash('died early');
    const factory = aKernelFactory();
    let first = true;
    const { supervisor, states } = aSupervisor(() => {
      if (!first) return factory.create();
      first = false;
      return Promise.resolve(dead);
    });
    await settle();
    expect(dead.disposed).toBe(true);
    expect(states).toEqual(['restarting', 'ready']);
    expect(supervisor.kernel()).toBe(factory.last);
  });
});

describe('KernelSupervisor – crashes', () => {
  it('a crash reported by onDisconnected while ready restarts: restarting → ready', async () => {
    const { factory, supervisor, onReady, states } = aSupervisor();
    await settle();
    const first = factory.last;
    const firstRegenerator = regeneratorOf(supervisor);

    first.crash();
    expect(supervisor.state.get()).toBe('restarting');
    expect(supervisor.regenerator()).toBeNull();
    expect(first.disposed).toBe(true);
    await settle();

    expect(states).toEqual(['ready', 'restarting', 'ready']);
    expect(factory.kernels).toHaveLength(2);
    expect(onReady).toHaveBeenLastCalledWith(factory.last);
    expect(regeneratorOf(supervisor)).not.toBe(firstRegenerator);
    expect(supervisor.error.get()).toBeNull();
  });

  it('a lost Regenerator (the second way) restarts the same', async () => {
    const { factory, supervisor, states } = aSupervisor();
    await settle();
    const first = factory.last;
    supervisor.lost(regeneratorOf(supervisor));
    expect(first.disposed).toBe(true);
    await settle();
    expect(states).toEqual(['ready', 'restarting', 'ready']);
    expect(factory.kernels).toHaveLength(2);
  });

  it('the echo of a kernel that is no longer live is ignored', async () => {
    // A kernel that keeps telling its listener even after the supervisor unsubscribed.
    const factory = aKernelFactory();
    const listeners: ((error: Error) => void)[] = [];
    const { supervisor, states } = aSupervisor(async () => {
      const kernel = await factory.create();
      return {
        ...kernel,
        onDisconnected: (listener: (error: Error) => void) => {
          listeners.push(listener);
          return () => undefined;
        },
      };
    });
    await settle();
    const firstRegenerator = regeneratorOf(supervisor);
    listeners[0]?.(new Error('first crash'));
    await settle();
    expect(states).toEqual(['ready', 'restarting', 'ready']);

    // The first kernel again, through both ways: not live, so nothing happens.
    listeners[0]?.(new Error('echo'));
    supervisor.lost(firstRegenerator);
    await settle();
    expect(states).toEqual(['ready', 'restarting', 'ready']);
    expect(factory.kernels).toHaveLength(2);
    expect(factory.last.disposed).toBe(false);
  });

  it(`${String(RESTART_LIMIT)} crashes within the window restart, the next one → failed with its cause`, async () => {
    const { factory, supervisor, crashLive } = aSupervisor();
    await settle();
    for (let i = 1; i <= RESTART_LIMIT; i++) {
      await crashLive(`crash ${String(i)}`);
      expect(supervisor.state.get()).toBe('ready');
    }
    expect(factory.kernels).toHaveLength(RESTART_LIMIT + 1);

    await crashLive('OCCT crashed: out of memory');
    expect(supervisor.state.get()).toBe('failed');
    expect(supervisor.error.get()).toBe('OCCT crashed: out of memory');
    expect(supervisor.regenerator()).toBeNull();
    expect(supervisor.kernel()).toBeNull();
    expect(factory.kernels).toHaveLength(RESTART_LIMIT + 1);
    expect(factory.last.disposed).toBe(true);
  });

  it('a lost Regenerator over the limit → failed with a cause too', async () => {
    const { supervisor, crashLive } = aSupervisor();
    await settle();
    for (let i = 0; i < RESTART_LIMIT; i++) await crashLive();
    supervisor.lost(regeneratorOf(supervisor));
    expect(supervisor.state.get()).toBe('failed');
    expect(supervisor.error.get()).not.toBeNull();
  });

  it('crashes older than the window do not count', async () => {
    const { factory, supervisor, advance, crashLive } = aSupervisor();
    await settle();
    for (let i = 0; i < RESTART_LIMIT; i++) await crashLive();
    advance(61_000);
    await crashLive();
    expect(supervisor.state.get()).toBe('ready');
    expect(factory.kernels).toHaveLength(RESTART_LIMIT + 2);
  });

  it('the window slides: only the crashes of the last 60 s count', async () => {
    const { supervisor, advance, crashLive } = aSupervisor();
    await settle();
    await crashLive(); // t = 0
    advance(20_000);
    await crashLive(); // t = 20 s
    advance(20_000);
    await crashLive(); // t = 40 s
    advance(21_000);
    await crashLive(); // t = 61 s: the one at 0 is out, 3 in the window
    expect(supervisor.state.get()).toBe('ready');
    advance(1_000);
    await crashLive('fourth in the window'); // t = 62 s: 20, 40, 61, 62
    expect(supervisor.state.get()).toBe('failed');
    expect(supervisor.error.get()).toBe('fourth in the window');
    expect(RESTART_WINDOW_MS).toBe(60_000);
  });

  it('a failed restart → unavailable with the text of the error, reported', async () => {
    const { factory, supervisor, onError } = aSupervisor();
    await settle();
    factory.failNext(new Error('again'));
    factory.last.crash();
    await settle();
    expect(supervisor.state.get()).toBe('unavailable');
    expect(supervisor.error.get()).toBe('again');
    expect(onError).toHaveBeenCalledWith(new Error('again'));
  });
});

describe('KernelSupervisor – retry', () => {
  it('retry() from failed → starting → ready, with the error cleared', async () => {
    const { factory, supervisor, states, crashLive } = aSupervisor();
    await settle();
    for (let i = 0; i <= RESTART_LIMIT; i++) await crashLive();
    expect(supervisor.state.get()).toBe('failed');
    states.length = 0;

    supervisor.retry();
    expect(supervisor.state.get()).toBe('starting');
    expect(supervisor.error.get()).toBeNull();
    await settle();
    expect(states).toEqual(['starting', 'ready']);
    expect(supervisor.kernel()).toBe(factory.last);
    expect(factory.last.disposed).toBe(false);
  });

  it('retry() empties the window: the crashes before it do not count', async () => {
    const { supervisor, crashLive } = aSupervisor();
    await settle();
    for (let i = 0; i <= RESTART_LIMIT; i++) await crashLive();
    supervisor.retry();
    await settle();
    for (let i = 0; i < RESTART_LIMIT; i++) await crashLive();
    expect(supervisor.state.get()).toBe('ready');
  });

  it('retry() from unavailable starts the kernel again', async () => {
    const { factory, supervisor, onReady } = anUnstartedSupervisor();
    factory.failNext(new Error('no wasm'));
    supervisor.start();
    await settle();
    expect(supervisor.state.get()).toBe('unavailable');

    supervisor.retry();
    await settle();
    expect(supervisor.state.get()).toBe('ready');
    expect(supervisor.error.get()).toBeNull();
    expect(onReady).toHaveBeenCalledWith(factory.last);
  });

  it('retry() does nothing while starting, ready or restarting, and after dispose', async () => {
    const { factory, supervisor, crashLive } = aSupervisor();
    supervisor.retry();
    await settle();
    supervisor.retry();
    await settle();
    expect(factory.kernels).toHaveLength(1);
    factory.last.crash();
    supervisor.retry();
    await settle();
    expect(factory.kernels).toHaveLength(2);

    for (let i = 0; i < RESTART_LIMIT; i++) await crashLive();
    expect(supervisor.state.get()).toBe('failed');
    supervisor.dispose();
    supervisor.retry();
    await settle();
    expect(supervisor.state.get()).toBe('failed');
    expect(factory.kernels).toHaveLength(RESTART_LIMIT + 1);
  });
});

describe('KernelSupervisor – dispose', () => {
  it('a start that finishes after dispose: the kernel is released, onReady is not called', async () => {
    let finish: (kernel: CrashableKernel) => void = () => undefined;
    const { supervisor, onReady } = aSupervisor(
      () =>
        new Promise<CrashableKernel>((resolve) => {
          finish = resolve;
        }),
    );
    supervisor.dispose();
    const kernel = createCrashableKernel();
    finish(kernel);
    await settle();
    expect(kernel.disposed).toBe(true);
    expect(onReady).not.toHaveBeenCalled();
    expect(supervisor.regenerator()).toBeNull();
    expect(supervisor.state.get()).toBe('starting');
  });

  it('a start that fails after dispose changes nothing and reports nothing', async () => {
    let fail: (error: Error) => void = () => undefined;
    const { supervisor, onError } = aSupervisor(
      () =>
        new Promise<CrashableKernel>((_, reject) => {
          fail = reject;
        }),
    );
    supervisor.dispose();
    fail(new Error('late'));
    await settle();
    expect(supervisor.state.get()).toBe('starting');
    expect(supervisor.error.get()).toBeNull();
    expect(onError).not.toHaveBeenCalled();
  });

  it('dispose releases the kernel; a kernel that arrives after dispose is released at once', async () => {
    const { factory, supervisor, onReady } = aSupervisor();
    supervisor.dispose();
    await settle();
    expect(factory.last.disposed).toBe(true);
    expect(onReady).not.toHaveBeenCalled();
    expect(supervisor.regenerator()).toBeNull();

    const other = aSupervisor();
    await settle();
    other.supervisor.dispose();
    expect(other.factory.last.disposed).toBe(true);
    expect(other.supervisor.regenerator()).toBeNull();
  });

  it('a crash of the kernel during or after dispose starts nothing', async () => {
    const { factory, supervisor, states } = aSupervisor();
    await settle();
    supervisor.dispose();
    factory.last.crash();
    await settle();
    expect(states).toEqual(['ready']);
    expect(factory.kernels).toHaveLength(1);
  });
});
