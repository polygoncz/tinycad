import { describe, expect, it, vi } from 'vitest';
import type { GeometryKernel } from '@/kernel';
import type { Regenerator } from '@/regen';
import { createKernelSupervisor, RESTART_WINDOW_MS } from './kernel-supervisor';
import type { KernelUiState } from './kernel-supervisor';
import { aKernelFactory, createCrashableKernel, settle } from './testing';
import type { CrashableKernel } from './testing';

/** A stand-in Regenerator that remembers its kernel; the supervisor never runs it. */
function aRegenerator(kernel: GeometryKernel): Regenerator & { kernel: GeometryKernel } {
  return {
    kernel,
    run: () => Promise.reject(new Error('not used')),
    events: { on: () => () => undefined, once: () => () => undefined },
  };
}

function aSupervisor() {
  const factory = aKernelFactory();
  let time = 1000;
  const onReady = vi.fn<(kernel: GeometryKernel) => void>();
  const onError = vi.fn<(e: unknown) => void>();
  const supervisor = createKernelSupervisor({
    createKernel: factory.create,
    createRegenerator: aRegenerator,
    now: () => time,
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
    advance: (ms: number) => {
      time += ms;
    },
  };
}

describe('KernelSupervisor', () => {
  it('starts the kernel: starting → ready, then a Regenerator over it and onReady', async () => {
    const { factory, supervisor, onReady, states } = aSupervisor();
    expect(supervisor.state.get()).toBe('starting');
    expect(supervisor.regenerator()).toBeNull();
    await settle();
    expect(states).toEqual(['ready']);
    expect(factory.kernels).toHaveLength(1);
    expect(onReady).toHaveBeenCalledWith(factory.last);
    const regenerator = supervisor.regenerator();
    expect(regenerator).not.toBeNull();
  });

  it('kernel(): null while starting, the live kernel when ready, null after a crash', async () => {
    const { factory, supervisor } = aSupervisor();
    expect(supervisor.kernel()).toBeNull();
    await settle();
    expect(supervisor.kernel()).toBe(factory.last);
    const first = supervisor.regenerator();
    if (first === null) throw new Error('not ready');
    supervisor.lost(first);
    expect(supervisor.kernel()).toBeNull();
    await settle();
    expect(supervisor.kernel()).toBe(factory.last);
    supervisor.dispose();
    expect(supervisor.kernel()).toBeNull();
  });

  it('kernel() is null when the kernel did not start', async () => {
    const factory = aKernelFactory();
    factory.failNext();
    const supervisor = createKernelSupervisor({
      createKernel: factory.create,
      createRegenerator: aRegenerator,
      now: () => 0,
      onReady: vi.fn(),
      onError: vi.fn(),
    });
    await settle();
    expect(supervisor.kernel()).toBeNull();
  });

  it('a failed start → unavailable with the text of the error, not failed; reported', async () => {
    const factory = aKernelFactory();
    factory.failNext(new Error('no wasm'));
    const onError = vi.fn();
    const supervisor = createKernelSupervisor({
      createKernel: factory.create,
      createRegenerator: aRegenerator,
      now: () => 0,
      onReady: vi.fn(),
      onError,
    });
    expect(supervisor.error.get()).toBeNull();
    await settle();
    expect(supervisor.state.get()).toBe('unavailable');
    expect(supervisor.error.get()).toBe('no wasm');
    expect(supervisor.regenerator()).toBeNull();
    expect(onError).toHaveBeenCalledWith(new Error('no wasm'));
  });

  it('a lost kernel is disposed and replaced by a new one: restarting → ready', async () => {
    const { factory, supervisor, onReady, states } = aSupervisor();
    await settle();
    const first = supervisor.regenerator();
    const firstKernel = factory.last;
    if (first === null) throw new Error('not ready');

    supervisor.lost(first);
    expect(supervisor.state.get()).toBe('restarting');
    expect(supervisor.regenerator()).toBeNull();
    expect(firstKernel.disposed).toBe(true);
    await settle();

    expect(states).toEqual(['ready', 'restarting', 'ready']);
    expect(factory.kernels).toHaveLength(2);
    expect(onReady).toHaveBeenLastCalledWith(factory.last);
    const second = supervisor.regenerator();
    expect(second).not.toBeNull();
    expect(second).not.toBe(first);
  });

  it('a second loss within the window → failed, no new kernel', async () => {
    const { factory, supervisor, advance } = aSupervisor();
    await settle();
    const first = supervisor.regenerator();
    if (first === null) throw new Error('not ready');
    supervisor.lost(first);
    await settle();
    advance(RESTART_WINDOW_MS - 1);
    const second = supervisor.regenerator();
    if (second === null) throw new Error('not ready');
    supervisor.lost(second);
    await settle();
    expect(supervisor.state.get()).toBe('failed');
    expect(supervisor.regenerator()).toBeNull();
    expect(factory.kernels).toHaveLength(2);
    expect(factory.last.disposed).toBe(true);
  });

  it('a second loss after the window restarts again', async () => {
    const { factory, supervisor, advance } = aSupervisor();
    await settle();
    const first = supervisor.regenerator();
    if (first === null) throw new Error('not ready');
    supervisor.lost(first);
    await settle();
    advance(RESTART_WINDOW_MS);
    const second = supervisor.regenerator();
    if (second === null) throw new Error('not ready');
    supervisor.lost(second);
    await settle();
    expect(supervisor.state.get()).toBe('ready');
    expect(factory.kernels).toHaveLength(3);
  });

  it('ignores the loss of a Regenerator that is no longer current', async () => {
    const { factory, supervisor, states } = aSupervisor();
    await settle();
    const first = supervisor.regenerator();
    if (first === null) throw new Error('not ready');
    supervisor.lost(first);
    supervisor.lost(first);
    await settle();
    supervisor.lost(first);
    await settle();
    expect(states).toEqual(['ready', 'restarting', 'ready']);
    expect(factory.kernels).toHaveLength(2);
  });

  it('a failed restart → unavailable with the text of the error, reported', async () => {
    const { factory, supervisor, onError } = aSupervisor();
    await settle();
    const first = supervisor.regenerator();
    if (first === null) throw new Error('not ready');
    factory.failNext(new Error('again'));
    supervisor.lost(first);
    await settle();
    expect(supervisor.state.get()).toBe('unavailable');
    expect(supervisor.error.get()).toBe('again');
    expect(onError).toHaveBeenCalledWith(new Error('again'));
  });

  it('a crash gives no error text: failed, error stays null', async () => {
    const { supervisor } = aSupervisor();
    await settle();
    const first = supervisor.regenerator();
    if (first === null) throw new Error('not ready');
    supervisor.lost(first);
    await settle();
    const second = supervisor.regenerator();
    if (second === null) throw new Error('not ready');
    supervisor.lost(second);
    expect(supervisor.state.get()).toBe('failed');
    expect(supervisor.error.get()).toBeNull();
  });

  it('a start that finishes after dispose: the kernel is released, onReady is not called', async () => {
    let finish: (kernel: CrashableKernel) => void = () => undefined;
    const onReady = vi.fn();
    const supervisor = createKernelSupervisor({
      createKernel: () =>
        new Promise<CrashableKernel>((resolve) => {
          finish = resolve;
        }),
      createRegenerator: aRegenerator,
      now: () => 0,
      onReady,
      onError: vi.fn(),
    });
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
    const onError = vi.fn();
    const supervisor = createKernelSupervisor({
      createKernel: () =>
        new Promise<CrashableKernel>((_, reject) => {
          fail = reject;
        }),
      createRegenerator: aRegenerator,
      now: () => 0,
      onReady: vi.fn(),
      onError,
    });
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
});
