import { describe, expect, it } from 'vitest';
import { kernelErrorCode } from '@/kernel';
import type { ShapeHandle } from '@/kernel';
import { createFakeKernel } from '@/kernel/testing';
import { createTrackingKernel } from './tracking-kernel';

const BOX = { origin: [0, 0, 0], size: [1, 2, 3] } as const;

function setup() {
  const real = createFakeKernel();
  const owned = new Set<ShapeHandle>();
  return { real, owned, kernel: createTrackingKernel(real, owned) };
}

describe('createTrackingKernel', () => {
  it('adds the handle of makeBox to the owned set and returns the real result', async () => {
    const { owned, kernel } = setup();
    const result = await kernel.makeBox(BOX);
    expect([...owned]).toEqual([result.shape]);
  });

  it('records every handle, also intermediate ones', async () => {
    const { owned, kernel } = setup();
    const a = await kernel.makeBox(BOX);
    const b = await kernel.makeBox(BOX);
    expect([...owned]).toEqual([a.shape, b.shape]);
  });

  it('passes kernel errors through unchanged and records nothing', async () => {
    const { real, owned, kernel } = setup();
    real.failNext('makeBox', 'operation-failed');
    const error: unknown = await kernel.makeBox(BOX).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(kernelErrorCode(error)).toBe('operation-failed');
    expect(owned.size).toBe(0);
  });

  it('has no release and no liveHandleCount: a builder cannot release handles (Q041)', () => {
    const { kernel } = setup();
    // @ts-expect-error -- ModelingKernel has no release; the type is the guard, not a rejection.
    expect(kernel.release).toBeUndefined();
    // @ts-expect-error -- neither has it liveHandleCount.
    expect(kernel.liveHandleCount).toBeUndefined();
    expect(Object.keys(kernel).sort()).toEqual(['boundingBox', 'makeBox']);
  });

  it('delegates boundingBox', async () => {
    const { real, kernel } = setup();
    const { shape } = await kernel.makeBox(BOX);
    expect(await kernel.boundingBox(shape)).toEqual(await real.boundingBox(shape));
    expect(real.callCount('boundingBox')).toBe(2);
  });
});
