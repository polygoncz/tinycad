import { describe, expect, it } from 'vitest';
import { mat4 } from '@/core';
import { kernelErrorCode } from '@/kernel/errors';
import { createFakeKernel, describeGeometryKernelContract } from '@/kernel/testing';
import type { ShapeHandle } from '@/kernel/types';

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

  describe('makeFace (M12)', () => {
    const XY = { origin: [0, 0, 0], xDir: [1, 0, 0], normal: [0, 0, 1] } as const;
    const SQUARE = [
      { kind: 'line', from: [0, 0], to: [2, 0] },
      { kind: 'line', from: [2, 0], to: [2, 2] },
      { kind: 'line', from: [2, 2], to: [0, 2] },
      { kind: 'line', from: [0, 2], to: [0, 0] },
    ] as const;
    const FACE = { plane: XY, outer: SQUARE, holes: [] };

    it('a quarter arc adds only the cardinal points that lie on it', async () => {
      const kernel = createFakeKernel();
      // From (1, 0) ccw to (0, 1) about the origin: passes no other cardinal point.
      const { shape } = await kernel.makeFace({
        plane: XY,
        outer: [
          { kind: 'line', from: [0, 0], to: [1, 0] },
          { kind: 'arc', center: [0, 0], from: [1, 0], to: [0, 1], ccw: true },
          { kind: 'line', from: [0, 1], to: [0, 0] },
        ],
        holes: [],
      });
      expect(await kernel.boundingBox(shape)).toEqual({ min: [0, 0, 0], max: [1, 1, 0] });
    });

    it('the same quarter arc clockwise goes the long way round', async () => {
      const kernel = createFakeKernel();
      const { shape } = await kernel.makeFace({
        plane: XY,
        outer: [
          { kind: 'line', from: [0, 0], to: [1, 0] },
          { kind: 'arc', center: [0, 0], from: [1, 0], to: [0, 1], ccw: false },
          { kind: 'line', from: [0, 1], to: [0, 0] },
        ],
        holes: [],
      });
      expect(await kernel.boundingBox(shape)).toEqual({ min: [-1, -1, 0], max: [1, 1, 0] });
    });

    it('is tessellated as a box of zero thickness', async () => {
      const kernel = createFakeKernel();
      const { shape } = await kernel.makeFace(FACE);
      const mesh = await kernel.tessellate(shape, QUALITY);
      expect(mesh.positions).toHaveLength(24 * 3);
      expect(mesh.faceRanges).toHaveLength(6 * 3);
    });

    it('failNext works for makeFace and creates no handle', async () => {
      const kernel = createFakeKernel();
      kernel.failNext('makeFace', 'operation-failed', 'boom');
      const e = await rejection(kernel.makeFace(FACE));
      expect(kernelErrorCode(e)).toBe('operation-failed');
      expect(e).toHaveProperty('message', 'boom');
      expect(await kernel.liveHandleCount()).toBe(0);
      await expect(kernel.makeFace(FACE)).resolves.toHaveProperty('shape');
    });

    it('callCount counts makeFace, failed calls included', async () => {
      const kernel = createFakeKernel();
      await kernel.makeFace(FACE);
      await rejection(kernel.makeFace({ ...FACE, outer: [] }));
      expect(kernel.callCount('makeFace')).toBe(2);
    });
  });

  describe('extrude and revolve (M13)', () => {
    const XY = { origin: [0, 0, 0], xDir: [1, 0, 0], normal: [0, 0, 1] } as const;
    const XZ = { origin: [0, 0, 0], xDir: [1, 0, 0], normal: [0, -1, 0] } as const;
    const square = (x0: number, y0: number, x1: number, y1: number) =>
      [
        { kind: 'line', from: [x0, y0], to: [x1, y0] },
        { kind: 'line', from: [x1, y0], to: [x1, y1] },
        { kind: 'line', from: [x1, y1], to: [x0, y1] },
        { kind: 'line', from: [x0, y1], to: [x0, y0] },
      ] as const;
    const FACE = { plane: XY, outer: square(0, 0, 2, 2), holes: [] };
    const RING = { plane: XZ, outer: square(5, 0, 10, 10), holes: [] };
    const Z_AXIS = { origin: [0, 0, 0], direction: [0, 0, 1] } as const;

    async function aFace(kernel = createFakeKernel()) {
      return { kernel, profile: (await kernel.makeFace(FACE)).shape };
    }

    it('extrude along a slanted direction: the AABB of the profile and of the moved profile', async () => {
      const { kernel, profile } = await aFace();
      // d̂ · 5 = [3, 0, 4].
      const { shape } = await kernel.extrude(profile, [0.6, 0, 0.8], 5);
      expect(await kernel.boundingBox(shape)).toEqual({ min: [0, 0, 0], max: [5, 2, 4] });
    });

    it('revolve turns the AABB corners at 0, the angle and every π/2 in between', async () => {
      const kernel = createFakeKernel();
      const ring = (await kernel.makeFace(RING)).shape;
      const { shape } = await kernel.revolve(ring, Z_AXIS, (3 * Math.PI) / 4);
      const box = await kernel.boundingBox(shape);
      // Corners x ∈ {5, 10} at 0, π/2 and 3π/4: x down to 10·cos(3π/4), y up to 10.
      expect(box.min[0]).toBeCloseTo(-10 * Math.SQRT1_2, 9);
      expect(box.max[0]).toBeCloseTo(10, 9);
      expect(box.min[1]).toBeCloseTo(0, 9);
      expect(box.max[1]).toBeCloseTo(10, 9);
      expect([box.min[2], box.max[2]]).toEqual([0, 10]);
    });

    it('revolve about an axis off the origin turns about that axis', async () => {
      const kernel = createFakeKernel();
      const ring = (await kernel.makeFace(RING)).shape;
      const axis = { origin: [5, 0, 0], direction: [0, 0, 1] } as const;
      const { shape } = await kernel.revolve(ring, axis, Math.PI);
      const box = await kernel.boundingBox(shape);
      expect(box.min[0]).toBeCloseTo(0, 9);
      expect(box.max[0]).toBeCloseTo(10, 9);
      expect(box.min[1]).toBeCloseTo(0, 9);
      expect(box.max[1]).toBeCloseTo(5, 9);
    });

    it('a boolean result is not a face', async () => {
      const { kernel, profile } = await aFace();
      const other = (await kernel.makeFace(FACE)).shape;
      const united = await kernel.boolean('union', [profile], [other]);
      const e = await rejection(kernel.extrude(united.shape, [0, 0, 1], 1));
      expect(kernelErrorCode(e)).toBe('invalid-input');
    });

    it('the result is tessellated as a box', async () => {
      const { kernel, profile } = await aFace();
      const { shape } = await kernel.extrude(profile, [0, 0, 1], 1);
      const mesh = await kernel.tessellate(shape, QUALITY);
      expect(mesh.faceRanges).toHaveLength(6 * 3);
    });

    it('the profile is deleted in the history (M14); revolve returns no roles', async () => {
      const { kernel, profile } = await aFace();
      const deleted = [0, 1, 2, 3, 4, 5].map((index) => ({
        input: 0,
        sub: { type: 'face', index },
      }));
      const extruded = await kernel.extrude(profile, [0, 0, 1], 1);
      const revolved = await kernel.revolve(
        profile,
        { origin: [0, 0, 0], direction: [0, 1, 0] },
        1,
      );
      for (const result of [extruded, revolved]) {
        expect(result.history).toEqual({ modified: [], generated: [], deleted });
      }
      expect(revolved.roles).toBeUndefined();
    });

    it.each(['extrude', 'revolve'] as const)(
      'failNext works for %s and creates no handle',
      async (op) => {
        const { kernel, profile } = await aFace();
        const calls = {
          extrude: () => kernel.extrude(profile, [0, 0, 1], 1),
          revolve: () => kernel.revolve(profile, { origin: [0, 0, 0], direction: [0, 1, 0] }, 1),
        };
        kernel.failNext(op, 'operation-failed', 'boom');
        const e = await rejection(calls[op]());
        expect(kernelErrorCode(e)).toBe('operation-failed');
        expect(e).toHaveProperty('message', 'boom');
        expect(await kernel.liveHandleCount()).toBe(1);
        await expect(calls[op]()).resolves.toHaveProperty('shape');
      },
    );

    it('callCount counts extrude and revolve, failed calls included', async () => {
      const { kernel, profile } = await aFace();
      await kernel.extrude(profile, [0, 0, 1], 1);
      await rejection(kernel.extrude(profile, [0, 0, 1], 0));
      await rejection(kernel.revolve(profile, Z_AXIS, 0));
      expect(kernel.callCount('extrude')).toBe(2);
      expect(kernel.callCount('revolve')).toBe(1);
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

  describe('topology, roles and history (M14)', () => {
    const face = (index: number) => ({ type: 'face', index }) as const;
    const identity = [0, 1, 2, 3, 4, 5].map((i) => ({ input: 0, from: face(i), to: [face(i)] }));

    async function aFace(kernel = createFakeKernel()) {
      const outer = [
        { kind: 'line', from: [0, 0], to: [2, 0] },
        { kind: 'line', from: [2, 0], to: [2, 2] },
        { kind: 'line', from: [2, 2], to: [0, 0] },
      ] as const;
      const plane = { origin: [0, 0, 0], xDir: [1, 0, 0], normal: [0, 0, 1] } as const;
      return { kernel, profile: (await kernel.makeFace({ plane, outer, holes: [] })).shape };
    }

    it('the topology is the AABB box: faces in mesh order, edges with faces and corners', async () => {
      const kernel = createFakeKernel();
      const { shape } = await kernel.makeBox(BOX);
      const topology = await kernel.topology(shape);
      expect(topology.faces.map((f) => f.plane)).toEqual([
        { origin: [1, -0.5, 5], normal: [-1, 0, 0] },
        { origin: [3, -0.5, 5], normal: [1, 0, 0] },
        { origin: [2, -2, 5], normal: [0, -1, 0] },
        { origin: [2, 1, 5], normal: [0, 1, 0] },
        { origin: [2, -0.5, 3], normal: [0, 0, -1] },
        { origin: [2, -0.5, 7], normal: [0, 0, 1] },
      ]);
      // Edge 0 runs along X at y, z low: between −Y (2) and −Z (4), corners 0 and 1.
      expect(topology.edges[0]).toEqual({ faces: [2, 4], vertices: [0, 1], midpoint: [2, -2, 3] });
      // Edge 4 runs along Y at z, x low: between −X (0) and −Z (4), corners 0 and 2.
      expect(topology.edges[4]).toEqual({
        faces: [0, 4],
        vertices: [0, 2],
        midpoint: [1, -0.5, 3],
      });
      expect(topology.vertexCount).toBe(8);
    });

    it('the edges of the topology are the edges of the mesh, in the same order', async () => {
      const kernel = createFakeKernel();
      const { shape } = await kernel.makeBox(BOX);
      const topology = await kernel.topology(shape);
      const mesh = await kernel.tessellate(shape, QUALITY);
      topology.edges.forEach((edge, e) => {
        const ends = [...mesh.edgePositions.slice(6 * e, 6 * e + 6)];
        const middle = [0, 1, 2].map((k) => ((ends[k] ?? 0) + (ends[k + 3] ?? 0)) / 2);
        expect(edge.midpoint).toEqual(middle);
      });
    });

    it('box roles: left 0, right 1, front 2, back 3, bottom 4, top 5', async () => {
      const { roles } = await createFakeKernel().makeBox(BOX);
      expect(roles).toEqual({
        'face:left': [face(0)],
        'face:right': [face(1)],
        'face:front': [face(2)],
        'face:back': [face(3)],
        'face:bottom': [face(4)],
        'face:top': [face(5)],
      });
    });

    it.each([
      ['+Z', [0, 0, 2], 4, 5, [0, 1, 2, 3]],
      ['−Z', [0, 0, -1], 5, 4, [0, 1, 2, 3]],
      ['mostly +X', [3, 1, 1], 0, 1, [2, 3, 4, 5]],
    ] as const)(
      'cylinder roles about %s: bottom and top by the dominant axis component, side the rest',
      async (_, axis, bottom, top, side) => {
        const { roles } = await createFakeKernel().makeCylinder({
          base: [0, 0, 0],
          axis,
          radius: 1,
          height: 2,
        });
        expect(roles).toEqual({
          'face:bottom': [face(bottom)],
          'face:top': [face(top)],
          'face:side': side.map(face),
        });
      },
    );

    it('extrude roles: start and end by the dominant component of the direction, no side', async () => {
      const { kernel, profile } = await aFace();
      const { roles } = await kernel.extrude(profile, [0, -2, 1], 1);
      expect(roles).toEqual({ 'face:start': [face(3)], 'face:end': [face(2)] });
    });

    it('transform, fillet and chamfer: the identity of the 6 faces', async () => {
      const kernel = createFakeKernel();
      const { shape } = await kernel.makeBox(BOX);
      for (const result of [
        await kernel.transform(shape, mat4.translation([1, 2, 3])),
        await kernel.fillet(shape, [3], 0.2),
        await kernel.chamfer(shape, [3, 5], 0.2),
      ]) {
        expect(result.history).toEqual({ modified: identity, generated: [], deleted: [] });
      }
    });

    it('boolean: the first input is the identity, the other inputs are deleted', async () => {
      const kernel = createFakeKernel();
      const a = (await kernel.makeBox(BOX)).shape;
      const b = (await kernel.makeBox(BOX)).shape;
      const c = (await kernel.makeBox(BOX)).shape;
      const { history } = await kernel.boolean('union', [a, b], [c]);
      expect(history?.modified).toEqual(identity);
      expect(history?.deleted).toEqual(
        [1, 2].flatMap((input) => [0, 1, 2, 3, 4, 5].map((i) => ({ input, sub: face(i) }))),
      );
    });

    it('fillet and chamfer keep the AABB under a new handle', async () => {
      const kernel = createFakeKernel();
      const { shape } = await kernel.makeBox(BOX);
      const filleted = (await kernel.fillet(shape, [0], 0.5)).shape;
      const chamfered = (await kernel.chamfer(shape, [0], 0.5)).shape;
      expect(new Set([shape, filleted, chamfered]).size).toBe(3);
      for (const h of [filleted, chamfered]) {
        expect(await kernel.boundingBox(h)).toEqual({ min: [1, -2, 3], max: [3, 1, 7] });
      }
    });

    it('failNext and callCount work for topology, fillet and chamfer', async () => {
      const kernel = createFakeKernel();
      const { shape } = await kernel.makeBox(BOX);
      kernel.failNext('fillet', 'operation-failed', 'too big');
      kernel.failNext('topology', 'internal');
      expect(kernelErrorCode(await rejection(kernel.fillet(shape, [0], 1)))).toBe(
        'operation-failed',
      );
      expect(kernelErrorCode(await rejection(kernel.topology(shape)))).toBe('internal');
      await kernel.chamfer(shape, [0], 1);
      expect(await kernel.liveHandleCount()).toBe(2);
      expect(kernel.callCount('fillet')).toBe(1);
      expect(kernel.callCount('chamfer')).toBe(1);
      expect(kernel.callCount('topology')).toBe(1);
    });
  });
  describe('exportStep (M15)', () => {
    it('a deterministic pseudo-STEP: one FAKE_SOLID line per shape, in the order of shapes', async () => {
      const kernel = createFakeKernel();
      const a = (await kernel.makeBox(BOX)).shape;
      const b = (await kernel.makeBox({ origin: [10, 0, 0], size: [1, 1, 1] })).shape;
      const text = new TextDecoder().decode(await kernel.exportStep([b, a]));
      const lines = text.trim().split('\n');
      expect(lines[0]).toBe('ISO-10303-21;');
      expect(lines[1]).toBe('HEADER;');
      expect(lines.at(-1)).toBe('END-ISO-10303-21;');
      const data = lines.indexOf('DATA;');
      expect(lines.slice(data + 1)).toEqual([
        '#1=FAKE_SOLID((10,0,0),(11,1,1));',
        '#2=FAKE_SOLID((1,-2,3),(3,1,7));',
        'ENDSEC;',
        'END-ISO-10303-21;',
      ]);
      expect(lines.slice(1, data)).toContain('ENDSEC;');
      expect(new TextDecoder().decode(await kernel.exportStep([b, a]))).toBe(text);
    });

    it('failNext and callCount work for exportStep', async () => {
      const kernel = createFakeKernel();
      const a = (await kernel.makeBox(BOX)).shape;
      kernel.failNext('exportStep', 'operation-failed', 'disk full');
      const e = await rejection(kernel.exportStep([a]));
      expect(kernelErrorCode(e)).toBe('operation-failed');
      await kernel.exportStep([a]);
      expect(kernel.callCount('exportStep')).toBe(2);
    });

    it('rejects an unknown handle', async () => {
      const kernel = createFakeKernel();
      expect(kernelErrorCode(await rejection(kernel.exportStep([UNKNOWN])))).toBe('unknown-handle');
    });
  });
});
