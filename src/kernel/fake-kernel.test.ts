import { describe, expect, it } from 'vitest';
import { mat4 } from '@/core';
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

    it('wins over a failed read of input outside the types, and is used up', async () => {
      const kernel = createFakeKernel();
      kernel.failNext('release', 'operation-failed');
      // 42 is not an array of handles: a value outside the types on purpose.
      const notAList = 42 as unknown as readonly ShapeHandle[];
      expect(kernelErrorCode(await rejection(kernel.release(notAList)))).toBe('operation-failed');
      expect(kernelErrorCode(await rejection(kernel.release(notAList)))).toBe('internal');
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

    it('counts a call whose input cannot be read', async () => {
      const kernel = createFakeKernel();
      // null is not a box: a value outside the types on purpose.
      await rejection(kernel.makeBox(null as unknown as typeof BOX));
      expect(kernel.callCount('makeBox')).toBe(1);
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

  describe('M11 operations', () => {
    it('the bounding box of an oblique cylinder is the AABB of the cylinder', async () => {
      const kernel = createFakeKernel();
      // Unit axis a = (1, 1, 0)/√2: extent r·sqrt(1 − a_k²) = √½ in x and y, r = 1 in z.
      const { shape } = await kernel.makeCylinder({
        base: [0, 0, 0],
        axis: [1, 1, 0],
        radius: 1,
        height: 2,
      });
      const box = await kernel.boundingBox(shape);
      const s = Math.SQRT1_2;
      const top = 2 * s;
      const min = [-s, -s, -1];
      const max = [top + s, top + s, 1];
      for (let k = 0; k < 3; k++) {
        expect(box.min[k]).toBeCloseTo(min[k] ?? Number.NaN, 12);
        expect(box.max[k]).toBeCloseTo(max[k] ?? Number.NaN, 12);
      }
    });

    it('subtract with a tool covering the whole target keeps the target box (nothing is cut)', async () => {
      const kernel = createFakeKernel();
      const target = await kernel.makeBox(BOX);
      const tool = await kernel.makeBox({ origin: [0, -3, 2], size: [4, 5, 6] });
      const { shape } = await kernel.boolean('subtract', [target.shape], [tool.shape]);
      expect(await kernel.boundingBox(shape)).toEqual({ min: [1, -2, 3], max: [3, 1, 7] });
    });

    it('subtract of several targets gives their enclosing box', async () => {
      const kernel = createFakeKernel();
      const a = await kernel.makeBox(BOX);
      const b = await kernel.makeBox({ origin: [10, 0, 0], size: [1, 1, 1] });
      const tool = await kernel.makeBox({ origin: [0, 0, 0], size: [1, 1, 1] });
      const { shape } = await kernel.boolean('subtract', [a.shape, b.shape], [tool.shape]);
      expect(await kernel.boundingBox(shape)).toEqual({ min: [1, -2, 0], max: [11, 1, 7] });
    });

    it('intersect of boxes that only touch fails with operation-failed (zero thickness)', async () => {
      const kernel = createFakeKernel();
      const a = await kernel.makeBox(BOX);
      const b = await kernel.makeBox({ origin: [3, -2, 3], size: [1, 1, 1] });
      const e = await rejection(kernel.boolean('intersect', [a.shape], [b.shape]));
      expect(kernelErrorCode(e)).toBe('operation-failed');
    });

    it.each(['makeCylinder', 'transform', 'boolean'] as const)(
      'failNext works for %s and creates no handle',
      async (op) => {
        const kernel = createFakeKernel();
        const a = await kernel.makeBox(BOX);
        const b = await kernel.makeBox({ origin: [0, 0, 0], size: [1, 1, 1] });
        const calls = {
          makeCylinder: () =>
            kernel.makeCylinder({ base: [0, 0, 0], axis: [0, 0, 1], radius: 1, height: 1 }),
          transform: () => kernel.transform(a.shape, mat4.identity()),
          boolean: () => kernel.boolean('union', [a.shape], [b.shape]),
        };
        kernel.failNext(op, 'operation-failed', 'boom');
        const e = await rejection(calls[op]());
        expect(kernelErrorCode(e)).toBe('operation-failed');
        expect(e).toHaveProperty('message', 'boom');
        expect(await kernel.liveHandleCount()).toBe(2);
        await expect(calls[op]()).resolves.toHaveProperty('shape');
      },
    );

    it('callCount counts the new methods', async () => {
      const kernel = createFakeKernel();
      const cylinder = { base: [0, 0, 0], axis: [0, 0, 1], radius: 1, height: 1 } as const;
      await kernel.makeCylinder(cylinder);
      await rejection(kernel.makeCylinder({ ...cylinder, radius: 0 }));
      expect(kernel.callCount('makeCylinder')).toBe(2);
      expect(kernel.callCount('transform')).toBe(0);
      expect(kernel.callCount('boolean')).toBe(0);
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
