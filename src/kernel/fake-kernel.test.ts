import { describe, expect, it } from 'vitest';
import { kernelErrorCode } from './errors';
import { createFakeKernel, describeGeometryKernelContract } from './testing';
import type { ShapeHandle } from './types';

describeGeometryKernelContract('FakeKernel', () => Promise.resolve(createFakeKernel()));

const BOX = { origin: [1, -2, 3], size: [2, 3, 4] } as const;
const QUALITY = { linearDeflection: 0.1, angularDeflection: 0.5 };
// A handle the kernel has never issued; branded ids are created by a cast in tests.
const UNKNOWN = 42 as ShapeHandle;

async function rejection(p: Promise<unknown>): Promise<unknown> {
  return p.then(
    () => expect.fail('Expected the call to reject'),
    (e: unknown) => e,
  );
}

describe('FakeKernel', () => {
  describe('failNext', () => {
    it('makes only the next call of the method reject with the code and message', async () => {
      const kernel = createFakeKernel();
      kernel.failNext('makeBox', 'operation-failed', 'boom');
      const e = await rejection(kernel.makeBox(BOX));
      expect(kernelErrorCode(e)).toBe('operation-failed');
      expect(e).toBeInstanceOf(Error);
      expect(e).toHaveProperty('message', 'boom');
      await expect(kernel.makeBox(BOX)).resolves.toBeDefined();
    });

    it('has a default message', async () => {
      const kernel = createFakeKernel();
      kernel.failNext('liveHandleCount', 'internal');
      const e = await rejection(kernel.liveHandleCount());
      expect(kernelErrorCode(e)).toBe('internal');
    });

    it('affects only the given method', async () => {
      const kernel = createFakeKernel();
      kernel.failNext('tessellate', 'operation-failed');
      const { shape } = await kernel.makeBox(BOX);
      await kernel.boundingBox(shape);
      expect(kernelErrorCode(await rejection(kernel.tessellate(shape, QUALITY)))).toBe(
        'operation-failed',
      );
      await expect(kernel.tessellate(shape, QUALITY)).resolves.toBeDefined();
    });

    it('queues several failures of one method in order', async () => {
      const kernel = createFakeKernel();
      kernel.failNext('boundingBox', 'operation-failed');
      kernel.failNext('boundingBox', 'internal');
      const { shape } = await kernel.makeBox(BOX);
      expect(kernelErrorCode(await rejection(kernel.boundingBox(shape)))).toBe('operation-failed');
      expect(kernelErrorCode(await rejection(kernel.boundingBox(shape)))).toBe('internal');
      await expect(kernel.boundingBox(shape)).resolves.toBeDefined();
    });

    it('an injected makeBox failure creates no handle', async () => {
      const kernel = createFakeKernel();
      kernel.failNext('makeBox', 'operation-failed');
      await rejection(kernel.makeBox(BOX));
      expect(await kernel.liveHandleCount()).toBe(0);
    });

    it('an injected release failure releases nothing', async () => {
      const kernel = createFakeKernel();
      const { shape } = await kernel.makeBox(BOX);
      kernel.failNext('release', 'internal');
      await rejection(kernel.release([shape]));
      expect(await kernel.liveHandleCount()).toBe(1);
      await expect(kernel.boundingBox(shape)).resolves.toBeDefined();
    });

    it('wins over a validation error of the same call', async () => {
      const kernel = createFakeKernel();
      kernel.failNext('boundingBox', 'internal');
      expect(kernelErrorCode(await rejection(kernel.boundingBox(UNKNOWN)))).toBe('internal');
    });
  });

  describe('callCount', () => {
    it('counts calls per method and in total, including failed ones', async () => {
      const kernel = createFakeKernel();
      expect(kernel.callCount()).toBe(0);
      const { shape } = await kernel.makeBox(BOX);
      await rejection(kernel.makeBox({ origin: [0, 0, 0], size: [0, 1, 1] }));
      kernel.failNext('makeBox', 'operation-failed');
      await rejection(kernel.makeBox(BOX));
      await kernel.tessellate(shape, QUALITY);
      await kernel.liveHandleCount();
      expect(kernel.callCount('makeBox')).toBe(3);
      expect(kernel.callCount('tessellate')).toBe(1);
      expect(kernel.callCount('boundingBox')).toBe(0);
      expect(kernel.callCount('liveHandleCount')).toBe(1);
      expect(kernel.callCount()).toBe(5);
    });

    it('counts a call as soon as it is made', () => {
      const kernel = createFakeKernel();
      void kernel.liveHandleCount();
      expect(kernel.callCount('liveHandleCount')).toBe(1);
    });
  });

  describe('asynchronous results', () => {
    it('resolves after the synchronous code following the call', async () => {
      const kernel = createFakeKernel();
      const order: string[] = [];
      const call = kernel.makeBox(BOX).then(() => order.push('result'));
      order.push('after call');
      await call;
      expect(order).toEqual(['after call', 'result']);
    });

    it('rejects after the synchronous code following the call', async () => {
      const kernel = createFakeKernel();
      const order: string[] = [];
      const call = kernel.boundingBox(UNKNOWN).catch(() => order.push('error'));
      order.push('after call');
      await call;
      expect(order).toEqual(['after call', 'error']);
    });
  });

  describe('box', () => {
    it('the bounding box is exact', async () => {
      const kernel = createFakeKernel();
      const { shape } = await kernel.makeBox(BOX);
      expect(await kernel.boundingBox(shape)).toEqual({ min: [1, -2, 3], max: [3, 1, 7] });
    });

    it('is tessellated as 6 faces of 2 triangles (24 vertices) in order -X +X -Y +Y -Z +Z', async () => {
      const kernel = createFakeKernel();
      const { shape } = await kernel.makeBox(BOX);
      const mesh = await kernel.tessellate(shape, QUALITY);
      expect(mesh.positions).toHaveLength(24 * 3);
      expect(mesh.indices).toHaveLength(12 * 3);
      expect([...mesh.faceRanges]).toEqual([0, 0, 2, 1, 2, 2, 2, 4, 2, 3, 6, 2, 4, 8, 2, 5, 10, 2]);
      const faceNormals = [0, 1, 2, 3, 4, 5].map((f) => [
        ...mesh.normals.slice(3 * 4 * f, 3 * 4 * f + 3),
      ]);
      expect(faceNormals).toEqual([
        [-1, 0, 0],
        [1, 0, 0],
        [0, -1, 0],
        [0, 1, 0],
        [0, 0, -1],
        [0, 0, 1],
      ]);
    });

    it('has 12 edges of 2 points', async () => {
      const kernel = createFakeKernel();
      const { shape } = await kernel.makeBox(BOX);
      const mesh = await kernel.tessellate(shape, QUALITY);
      expect(mesh.edgePositions).toHaveLength(12 * 2 * 3);
      expect(mesh.edgeRanges).toHaveLength(12 * 3);
      for (let e = 0; e < 12; e++) expect(mesh.edgeRanges[3 * e + 2]).toBe(2);
    });
  });
});
