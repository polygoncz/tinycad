import { describe, expect, it, vi } from 'vitest';
import type { GeometryKernel } from '@/kernel';
import type { Regenerator } from '@/regen';
import { createKernelSupervisor, RESTART_WINDOW_MS } from './kernel-supervisor';
import type { KernelUiState } from './kernel-supervisor';
import { aKernelFactory, settle } from './testing';

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

  it('a failed start → failed, reported', async () => {
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
    await settle();
    expect(supervisor.state.get()).toBe('failed');
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

  it('a failed restart → failed, reported', async () => {
    const { factory, supervisor, onError } = aSupervisor();
    await settle();
    const first = supervisor.regenerator();
    if (first === null) throw new Error('not ready');
    factory.failNext(new Error('again'));
    supervisor.lost(first);
    await settle();
    expect(supervisor.state.get()).toBe('failed');
    expect(onError).toHaveBeenCalledWith(new Error('again'));
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
