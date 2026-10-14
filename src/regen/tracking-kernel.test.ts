import { describe, expect, it } from 'vitest';
import { mat4 } from '@/core';
import { kernelErrorCode } from '@/kernel';
import type { ShapeHandle } from '@/kernel';
import { createFakeKernel } from '@/kernel/testing';
import { createTrackingKernel } from './tracking-kernel';

const BOX = { origin: [0, 0, 0], size: [1, 2, 3] } as const;
const CYLINDER = { base: [0, 0, 0], axis: [0, 0, 1], radius: 1, height: 2 } as const;
const FACE = {
  plane: { origin: [0, 0, 0], xDir: [1, 0, 0], normal: [0, 0, 1] },
  outer: [{ kind: 'circle', center: [0, 0], radius: 1 }],
  holes: [],
} as const;
const Y_AXIS = { origin: [0, 0, 0], direction: [0, 1, 0] } as const;

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

  it('adds the handles of makeCylinder, transform and boolean to the owned set', async () => {
    const { owned, kernel } = setup();
    const cylinder = await kernel.makeCylinder(CYLINDER);
    const moved = await kernel.transform(cylinder.shape, mat4.translation([10, 0, 0]));
    const united = await kernel.boolean('union', [cylinder.shape], [moved.shape]);
    expect([...owned]).toEqual([cylinder.shape, moved.shape, united.shape]);
  });

  it('adds the handle of makeFace to the owned set and returns the real result', async () => {
    const { real, owned, kernel } = setup();
    const result = await kernel.makeFace(FACE);
    expect([...owned]).toEqual([result.shape]);
    expect(real.callCount('makeFace')).toBe(1);
    await expect(real.boundingBox(result.shape)).resolves.toEqual({
      min: [-1, -1, 0],
      max: [1, 1, 0],
    });
  });

  it('adds the handles of extrude and revolve to the owned set and returns the real results', async () => {
    const { real, owned, kernel } = setup();
    const face = await kernel.makeFace(FACE);
    const prism = await kernel.extrude(face.shape, [0, 0, 1], 2);
    const revolved = await kernel.revolve(face.shape, Y_AXIS, Math.PI);
    expect([...owned]).toEqual([face.shape, prism.shape, revolved.shape]);
    expect(real.callCount('extrude')).toBe(1);
    expect(real.callCount('revolve')).toBe(1);
    await expect(real.boundingBox(prism.shape)).resolves.toEqual({
      min: [-1, -1, 0],
      max: [1, 1, 2],
    });
  });

  it.each(['makeCylinder', 'transform', 'boolean', 'makeFace', 'extrude', 'revolve'] as const)(
    'passes a %s error through unchanged and records nothing new',
    async (op) => {
      const { real, owned, kernel } = setup();
      const a = await kernel.makeBox(BOX);
      const b = await kernel.makeBox(BOX);
      const face = await kernel.makeFace(FACE);
      const calls = {
        makeCylinder: () => kernel.makeCylinder(CYLINDER),
        transform: () => kernel.transform(a.shape, mat4.identity()),
        boolean: () => kernel.boolean('union', [a.shape], [b.shape]),
        makeFace: () => kernel.makeFace(FACE),
        extrude: () => kernel.extrude(face.shape, [0, 0, 1], 2),
        revolve: () => kernel.revolve(face.shape, Y_AXIS, Math.PI),
      };
      real.failNext(op, 'operation-failed', 'boom');
      const error: unknown = await calls[op]().then(
        () => undefined,
        (e: unknown) => e,
      );
      expect(kernelErrorCode(error)).toBe('operation-failed');
      expect(error).toHaveProperty('message', 'boom');
      expect([...owned]).toEqual([a.shape, b.shape, face.shape]);
    },
  );

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
    expect(Object.keys(kernel).sort()).toEqual([
      'boolean',
      'boundingBox',
      'extrude',
      'makeBox',
      'makeCylinder',
      'makeFace',
      'revolve',
      'topology',
      'transform',
    ]);
  });

  it('delegates boundingBox', async () => {
    const { real, kernel } = setup();
    const { shape } = await kernel.makeBox(BOX);
    expect(await kernel.boundingBox(shape)).toEqual(await real.boundingBox(shape));
    expect(real.callCount('boundingBox')).toBe(2);
  });
});
