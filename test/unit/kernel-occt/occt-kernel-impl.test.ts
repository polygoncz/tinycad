import { beforeAll, describe, expect, it } from 'vitest';
import type { Vec3 } from '@/core';
import { kernelErrorCode, type GeometryKernel, type ShapeHandle } from '@/kernel';
import { loadOcct, type Occt } from '@/kernel-occt/occt';
import { OcctKernelImpl } from '@/kernel-occt/occt-kernel-impl';

let oc: Occt;

beforeAll(async () => {
  oc = await loadOcct();
});

function aKernel(): GeometryKernel {
  return new OcctKernelImpl(oc);
}

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (e) {
    return kernelErrorCode(e);
  }
  return 'resolved';
}

// Never issued by a fresh kernel in these tests.
const UNKNOWN = 1_000_000 as ShapeHandle;
const unitBox = { origin: [0, 0, 0] as Vec3, size: [1, 1, 1] as Vec3 };

describe('OcctKernelImpl.makeBox', () => {
  it('returns a new, increasing handle for every box, starting at 1', async () => {
    const kernel = aKernel();
    const a = await kernel.makeBox(unitBox);
    const b = await kernel.makeBox(unitBox);
    expect(a.shape).toBe(1);
    expect(b.shape).toBe(2);
  });

  it('returns the six roles of the box faces and no history (M14)', async () => {
    const result = await aKernel().makeBox(unitBox);
    expect(Object.keys(result.roles ?? {}).sort()).toEqual([
      'face:back',
      'face:bottom',
      'face:front',
      'face:left',
      'face:right',
      'face:top',
    ]);
    expect(result.history).toBeUndefined();
  });

  it.each([
    ['infinite origin', { origin: [Infinity, 0, 0], size: [1, 1, 1] }],
    ['NaN origin', { origin: [0, Number.NaN, 0], size: [1, 1, 1] }],
    ['infinite size', { origin: [0, 0, 0], size: [1, Infinity, 1] }],
    ['zero size', { origin: [0, 0, 0], size: [1, 1, 0] }],
    ['negative size', { origin: [0, 0, 0], size: [-1, 1, 1] }],
  ] as const)('rejects %s with invalid-input and creates no handle', async (_, p) => {
    const kernel = aKernel();
    expect(await codeOf(kernel.makeBox(p))).toBe('invalid-input');
    expect(await kernel.liveHandleCount()).toBe(0);
  });

  it('never throws synchronously', () => {
    const kernel = aKernel();
    let promise: Promise<unknown> | undefined;
    expect(() => {
      promise = kernel.makeBox({ origin: [0, 0, 0], size: [0, 0, 0] });
    }).not.toThrow();
    return expect(promise).rejects.toThrow();
  });

  it('reads its input synchronously at the call (isolation)', async () => {
    const kernel = aKernel();
    const origin: [number, number, number] = [1, 2, 3];
    const size: [number, number, number] = [4, 5, 6];
    const pending = kernel.makeBox({ origin, size });
    origin[0] = 100;
    size[2] = 100;
    const { shape } = await pending;
    expect(await kernel.boundingBox(shape)).toEqual({ min: [1, 2, 3], max: [5, 7, 9] });
  });
});

describe('OcctKernelImpl.boundingBox', () => {
  it('is exactly [origin, origin + size] without the shape tolerance', async () => {
    const kernel = aKernel();
    const { shape } = await kernel.makeBox({ origin: [-1, 2.5, 3], size: [10, 20, 0.5] });
    expect(await kernel.boundingBox(shape)).toEqual({ min: [-1, 2.5, 3], max: [9, 22.5, 3.5] });
  });

  it('returns a new object on every call', async () => {
    const kernel = aKernel();
    const { shape } = await kernel.makeBox(unitBox);
    const a = await kernel.boundingBox(shape);
    const b = await kernel.boundingBox(shape);
    expect(a).not.toBe(b);
    expect(a.min).not.toBe(b.min);
  });

  it('rejects an unknown handle with unknown-handle', async () => {
    expect(await codeOf(aKernel().boundingBox(UNKNOWN))).toBe('unknown-handle');
  });

  it('rejects a released handle with unknown-handle', async () => {
    const kernel = aKernel();
    const { shape } = await kernel.makeBox(unitBox);
    await kernel.release([shape]);
    expect(await codeOf(kernel.boundingBox(shape))).toBe('unknown-handle');
  });
});

describe('OcctKernelImpl.release and liveHandleCount', () => {
  it('counts created and not yet released handles', async () => {
    const kernel = aKernel();
    expect(await kernel.liveHandleCount()).toBe(0);
    const a = await kernel.makeBox(unitBox);
    const b = await kernel.makeBox(unitBox);
    expect(await kernel.liveHandleCount()).toBe(2);
    await kernel.release([a.shape]);
    expect(await kernel.liveHandleCount()).toBe(1);
    await kernel.release([b.shape]);
    expect(await kernel.liveHandleCount()).toBe(0);
  });

  it('does nothing for an empty array', async () => {
    const kernel = aKernel();
    await kernel.makeBox(unitBox);
    await kernel.release([]);
    expect(await kernel.liveHandleCount()).toBe(1);
  });

  it('rejects an unknown or already released handle with unknown-handle', async () => {
    const kernel = aKernel();
    const { shape } = await kernel.makeBox(unitBox);
    expect(await codeOf(kernel.release([UNKNOWN]))).toBe('unknown-handle');
    await kernel.release([shape]);
    expect(await codeOf(kernel.release([shape]))).toBe('unknown-handle');
  });

  it('is atomic: an unknown handle releases nothing', async () => {
    const kernel = aKernel();
    const { shape } = await kernel.makeBox(unitBox);
    expect(await codeOf(kernel.release([shape, UNKNOWN]))).toBe('unknown-handle');
    expect(await kernel.liveHandleCount()).toBe(1);
    await expect(kernel.boundingBox(shape)).resolves.toBeDefined();
  });

  it('rejects the same handle twice in one call with invalid-input and releases nothing', async () => {
    const kernel = aKernel();
    const a = await kernel.makeBox(unitBox);
    const b = await kernel.makeBox(unitBox);
    expect(await codeOf(kernel.release([a.shape, b.shape, a.shape]))).toBe('invalid-input');
    expect(await kernel.liveHandleCount()).toBe(2);
  });

  it('reads the handle array synchronously at the call (isolation)', async () => {
    const kernel = aKernel();
    const a = await kernel.makeBox(unitBox);
    const b = await kernel.makeBox(unitBox);
    const handles = [a.shape];
    const pending = kernel.release(handles);
    handles.push(b.shape);
    await pending;
    expect(await kernel.liveHandleCount()).toBe(1);
    await expect(kernel.boundingBox(b.shape)).resolves.toBeDefined();
  });

  it('never reuses a released handle', async () => {
    const kernel = aKernel();
    const a = await kernel.makeBox(unitBox);
    await kernel.release([a.shape]);
    const b = await kernel.makeBox(unitBox);
    expect(b.shape).not.toBe(a.shape);
  });
});
