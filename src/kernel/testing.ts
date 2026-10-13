// Test-only entry point of kernel: the GeometryKernel contract suite and the FakeKernel.
// dependency-cruiser allows importing it only from *.test.ts.
//
// The suite knows only the GeometryKernel interface, kernelErrorCode and validateMeshData: it
// runs for the FakeKernel (M5) and for the OCCT kernel (M7). So it assumes nothing outside the
// contract of spec 06 – no face order, no vertex counts, no exact float values. Errors are
// checked with kernelErrorCode, never instanceof, because over core/rpc a kernel error arrives
// as an RpcError carrying the same code.

import { beforeEach, describe, expect, it } from 'vitest';
import type { Vec3 } from '@/core';
import { kernelErrorCode } from './errors';
import type { KernelErrorCode } from './errors';
import type { GeometryKernel } from './kernel';
import { validateMeshData } from './mesh';
import type { BoundingBox, MeshData, MeshQuality, ShapeHandle } from './types';

export { createFakeKernel } from './fake-kernel';
export type { FakeKernel, KernelOp } from './fake-kernel';

// An asymmetric box off the origin, so that swapped axes or a lost origin show up.
const ORIGIN: Vec3 = [1, -2, 3];
const SIZE: Vec3 = [2, 3, 4];
const BOX = { origin: ORIGIN, size: SIZE };
const BOX_MAX: Vec3 = [3, 1, 7];
/** Spec 06: the bounding box may exceed the box by at most this much in each component. */
const BBOX_MAX_OVERSIZE = 1e-6;
/** Mesh coordinates are float32: relative precision about 6e-8, so allow 1e-5 of the extent. */
const MESH_TOLERANCE = 1e-5 * Math.max(1, ...ORIGIN.map(Math.abs), ...BOX_MAX.map(Math.abs));
/** The same tolerance validateMeshData uses for unit normals. */
const NORMAL_TOLERANCE = 1e-4;
const QUALITY: MeshQuality = { linearDeflection: 0.1, angularDeflection: 0.5 };

// Handles are created by a cast in tests only: numbers the kernel has never issued.
const handle = (n: number): ShapeHandle => n as ShapeHandle;
const NEVER_ISSUED: readonly ShapeHandle[] = [handle(1_000_000), handle(0), handle(-1)];
const UNKNOWN = handle(1_000_000);

/** Calls the kernel and fails the test if the call throws instead of returning a Promise. */
function callWithoutThrow<T>(call: () => Promise<T>): Promise<T> {
  try {
    return call();
  } catch (e) {
    expect.fail(`Kernel call threw synchronously instead of rejecting: ${String(e)}`);
  }
}

/** The kernel error code the call rejects with; fails the test if it throws or resolves. */
async function rejectionCode(call: () => Promise<unknown>): Promise<KernelErrorCode | undefined> {
  const p = callWithoutThrow(call);
  try {
    await p;
  } catch (e) {
    return kernelErrorCode(e);
  }
  expect.fail('Expected the kernel call to reject');
}

function expectVecClose(actual: Vec3, expected: Vec3, tolerance: number, what: string): void {
  for (let k = 0; k < 3; k++) {
    const a = actual[k] ?? Number.NaN;
    const e = expected[k] ?? Number.NaN;
    if (!(Math.abs(a - e) <= tolerance)) {
      expect.fail(
        `${what}: [${actual.join(', ')}] differs from [${expected.join(', ')}] in axis ${String(k)}`,
      );
    }
  }
}

/**
 * Spec 06: a bounding box encloses the box [min, max] – never smaller, larger by at most
 * BBOX_MAX_OVERSIZE in each component (OCCT adds the shape tolerance).
 */
function expectEnclosesBox(actual: BoundingBox, min: Vec3, max: Vec3, what = 'bounding box'): void {
  for (let k = 0; k < 3; k++) {
    const lo = actual.min[k] ?? Number.NaN;
    const hi = actual.max[k] ?? Number.NaN;
    const boxLo = min[k] ?? Number.NaN;
    const boxHi = max[k] ?? Number.NaN;
    const encloses = lo <= boxLo && hi >= boxHi;
    const tight = boxLo - lo <= BBOX_MAX_OVERSIZE && hi - boxHi <= BBOX_MAX_OVERSIZE;
    if (!(encloses && tight)) {
      expect.fail(
        `${what} [${actual.min.join(', ')}]..[${actual.max.join(', ')}] does not enclose ` +
          `[${min.join(', ')}]..[${max.join(', ')}] within ${String(BBOX_MAX_OVERSIZE)} in axis ${String(k)}`,
      );
    }
  }
}

/** Point i of a flat xyz array; NaN for a missing coordinate, so a check fails loudly. */
function pointAt(values: Float32Array, i: number): Vec3 {
  return [
    values[3 * i] ?? Number.NaN,
    values[3 * i + 1] ?? Number.NaN,
    values[3 * i + 2] ?? Number.NaN,
  ];
}

function points(values: Float32Array): Vec3[] {
  return Array.from({ length: values.length / 3 }, (_, i) => pointAt(values, i));
}

/** Triples [key, first, count] of faceRanges / edgeRanges. */
function rangesOf(ranges: Uint32Array): { key: number; first: number; count: number }[] {
  return Array.from({ length: ranges.length / 3 }, (_, r) => ({
    key: ranges[3 * r] ?? Number.NaN,
    first: ranges[3 * r + 1] ?? Number.NaN,
    count: ranges[3 * r + 2] ?? Number.NaN,
  }));
}

/** Vertex indices of triangle t. */
function triangleAt(mesh: MeshData, t: number): readonly [number, number, number] {
  return [
    mesh.indices[3 * t] ?? Number.NaN,
    mesh.indices[3 * t + 1] ?? Number.NaN,
    mesh.indices[3 * t + 2] ?? Number.NaN,
  ];
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** Axis and sign of an axis-aligned unit vector, or undefined when it is not axis-aligned. */
function axisOf(n: Vec3): { axis: number; sign: 1 | -1 } | undefined {
  const axis = [0, 1, 2].find((k) => Math.abs(Math.abs(n[k] ?? 0) - 1) <= NORMAL_TOLERANCE);
  if (axis === undefined) return undefined;
  const others = [0, 1, 2].filter((k) => k !== axis);
  if (others.some((k) => Math.abs(n[k] ?? Number.NaN) > NORMAL_TOLERANCE)) return undefined;
  return { axis, sign: (n[axis] ?? 0) > 0 ? 1 : -1 };
}

function minMax(list: readonly Vec3[]): BoundingBox {
  const min = [0, 1, 2].map((k) => Math.min(...list.map((p) => p[k] ?? Number.NaN)));
  const max = [0, 1, 2].map((k) => Math.max(...list.map((p) => p[k] ?? Number.NaN)));
  return {
    min: [min[0] ?? Number.NaN, min[1] ?? Number.NaN, min[2] ?? Number.NaN],
    max: [max[0] ?? Number.NaN, max[1] ?? Number.NaN, max[2] ?? Number.NaN],
  };
}

function expectInsideBox(list: readonly Vec3[], what: string): void {
  list.forEach((p, i) => {
    for (let k = 0; k < 3; k++) {
      const c = p[k] ?? Number.NaN;
      const lo = (ORIGIN[k] ?? 0) - MESH_TOLERANCE;
      const hi = (BOX_MAX[k] ?? 0) + MESH_TOLERANCE;
      if (!(c >= lo && c <= hi))
        expect.fail(`${what} ${String(i)} [${p.join(', ')}] outside the box`);
    }
  });
}

/** The fields of MeshData, for checks over all its buffers. */
const MESH_FIELDS = [
  'positions',
  'normals',
  'indices',
  'faceRanges',
  'edgePositions',
  'edgeRanges',
] as const;

/** Kontraktová sada; factory vytvoří pro každý test čerstvé jádro. */
export function describeGeometryKernelContract(
  name: string,
  factory: () => Promise<GeometryKernel>,
): void {
  describe(`GeometryKernel contract: ${name}`, () => {
    let kernel: GeometryKernel;

    beforeEach(async () => {
      kernel = await factory();
    });

    async function aBox(): Promise<ShapeHandle> {
      return (await kernel.makeBox(BOX)).shape;
    }

    async function aBoxMesh(): Promise<MeshData> {
      return kernel.tessellate(await aBox(), QUALITY);
    }

    describe('errors', () => {
      it('a rejection is an Error whose code kernelErrorCode reads', async () => {
        const failed = await callWithoutThrow(() => kernel.boundingBox(UNKNOWN)).then(
          () => undefined,
          (e: unknown) => e,
        );
        expect(failed).toBeInstanceOf(Error);
        expect(kernelErrorCode(failed)).toBe('unknown-handle');
      });

      it.each([
        ['makeBox', (k: GeometryKernel) => k.makeBox({ origin: ORIGIN, size: [0, 1, 1] })],
        ['tessellate', (k: GeometryKernel) => k.tessellate(UNKNOWN, QUALITY)],
        ['boundingBox', (k: GeometryKernel) => k.boundingBox(UNKNOWN)],
        ['release', (k: GeometryKernel) => k.release([UNKNOWN])],
      ])('%s with an invalid input rejects instead of throwing', async (_, call) => {
        let p: Promise<unknown> = Promise.resolve();
        expect(() => {
          p = call(kernel);
        }).not.toThrow();
        await expect(p).rejects.toBeInstanceOf(Error);
      });

      it('every method returns a Promise', async () => {
        const created = kernel.makeBox(BOX);
        expect(created).toBeInstanceOf(Promise);
        const { shape } = await created;
        const calls = [
          kernel.tessellate(shape, QUALITY),
          kernel.boundingBox(shape),
          kernel.liveHandleCount(),
          kernel.release([]),
        ];
        for (const call of calls) expect(call).toBeInstanceOf(Promise);
        await Promise.all(calls);
      });
    });

    describe('makeBox', () => {
      it('returns a positive integer handle and adds one live handle', async () => {
        const shape = await aBox();
        expect(Number.isInteger(shape)).toBe(true);
        expect(shape).toBeGreaterThan(0);
        expect(await kernel.liveHandleCount()).toBe(1);
      });

      it('the bounding box encloses [origin, origin + size], at most 1e-6 larger', async () => {
        const box = await kernel.boundingBox(await aBox());
        expectEnclosesBox(box, ORIGIN, BOX_MAX);
      });

      it('every call returns a new handle; the boxes stay independent', async () => {
        const a = await aBox();
        const b = (await kernel.makeBox({ origin: [0, 0, 0], size: [1, 1, 1] })).shape;
        expect(b).not.toBe(a);
        expect(await kernel.liveHandleCount()).toBe(2);
        expectEnclosesBox(await kernel.boundingBox(a), ORIGIN, BOX_MAX, 'box a');
        expectEnclosesBox(await kernel.boundingBox(b), [0, 0, 0], [1, 1, 1], 'box b');
      });

      it.each([
        ['origin NaN', [Number.NaN, 0, 0], [1, 1, 1]],
        ['origin Infinity', [0, Number.POSITIVE_INFINITY, 0], [1, 1, 1]],
        ['origin -Infinity', [0, 0, Number.NEGATIVE_INFINITY], [1, 1, 1]],
        ['size 0', [0, 0, 0], [1, 0, 1]],
        ['size negative', [0, 0, 0], [1, 1, -1]],
        ['size NaN', [0, 0, 0], [Number.NaN, 1, 1]],
        ['size Infinity', [0, 0, 0], [1, Number.POSITIVE_INFINITY, 1]],
      ] satisfies [string, Vec3, Vec3][])(
        '%s rejects with invalid-input and creates no handle',
        async (_, origin, size) => {
          expect(await rejectionCode(() => kernel.makeBox({ origin, size }))).toBe('invalid-input');
          expect(await kernel.liveHandleCount()).toBe(0);
        },
      );
    });

    describe('handles', () => {
      it('a handle is never reused, not even after release', async () => {
        const issued: ShapeHandle[] = [];
        for (let round = 0; round < 3; round++) {
          const a = await aBox();
          const b = await aBox();
          expect(issued).not.toContain(a);
          expect(issued).not.toContain(b);
          issued.push(a, b);
          await kernel.release([a, b]);
        }
        expect(new Set(issued).size).toBe(issued.length);
        expect(await kernel.liveHandleCount()).toBe(0);
      });

      it('a released handle fails with unknown-handle everywhere', async () => {
        const a = await aBox();
        await kernel.release([a]);
        await aBox();
        expect(await rejectionCode(() => kernel.tessellate(a, QUALITY))).toBe('unknown-handle');
        expect(await rejectionCode(() => kernel.boundingBox(a))).toBe('unknown-handle');
        expect(await rejectionCode(() => kernel.release([a]))).toBe('unknown-handle');
        expect(await kernel.liveHandleCount()).toBe(1);
      });

      it('queries keep the input handle valid and create no handles', async () => {
        const a = await aBox();
        await kernel.tessellate(a, QUALITY);
        await kernel.boundingBox(a);
        expect(await kernel.liveHandleCount()).toBe(1);
        expectEnclosesBox(await kernel.boundingBox(a), ORIGIN, BOX_MAX);
      });
    });

    describe('tessellate', () => {
      it.each(NEVER_ISSUED)('handle %s, never issued, rejects with unknown-handle', async (h) => {
        await aBox();
        expect(await rejectionCode(() => kernel.tessellate(h, QUALITY))).toBe('unknown-handle');
      });

      it.each([
        ['linearDeflection 0', { linearDeflection: 0, angularDeflection: 0.5 }],
        ['linearDeflection negative', { linearDeflection: -0.1, angularDeflection: 0.5 }],
        ['linearDeflection NaN', { linearDeflection: Number.NaN, angularDeflection: 0.5 }],
        [
          'linearDeflection Infinity',
          { linearDeflection: Number.POSITIVE_INFINITY, angularDeflection: 0.5 },
        ],
        ['angularDeflection 0', { linearDeflection: 0.1, angularDeflection: 0 }],
        ['angularDeflection negative', { linearDeflection: 0.1, angularDeflection: -0.5 }],
        ['angularDeflection NaN', { linearDeflection: 0.1, angularDeflection: Number.NaN }],
        [
          'angularDeflection Infinity',
          { linearDeflection: 0.1, angularDeflection: Number.POSITIVE_INFINITY },
        ],
      ] satisfies [string, MeshQuality][])('%s rejects with invalid-input', async (_, q) => {
        const a = await aBox();
        expect(await rejectionCode(() => kernel.tessellate(a, q))).toBe('invalid-input');
        expect(await kernel.liveHandleCount()).toBe(1);
      });

      it('every call returns new buffers, shared with no other call', async () => {
        const a = await aBox();
        const first = await kernel.tessellate(a, QUALITY);
        const second = await kernel.tessellate(a, QUALITY);
        const buffers = (m: MeshData) => MESH_FIELDS.map((f) => m[f].buffer);
        for (const buffer of buffers(first)) expect(buffers(second)).not.toContain(buffer);
      });

      it('every array of one mesh has its own ArrayBuffer and fills it whole', async () => {
        const mesh = await aBoxMesh();
        const buffers = MESH_FIELDS.map((f) => mesh[f].buffer);
        expect(new Set(buffers).size).toBe(MESH_FIELDS.length);
        for (const field of MESH_FIELDS) {
          const array = mesh[field];
          expect(array.byteOffset, `${field}.byteOffset`).toBe(0);
          expect(array.byteLength, `${field}.byteLength`).toBe(array.buffer.byteLength);
        }
      });

      it('changing returned data does not break later results', async () => {
        // Spec 06: a repeated call need not return the same data (OCCT may refine the mesh),
        // so only its validity and its faces and edges are compared.
        const a = await aBox();
        const first = await kernel.tessellate(a, QUALITY);
        const keys = (ranges: Uint32Array) =>
          rangesOf(ranges)
            .map((r) => r.key)
            .sort((x, y) => x - y);
        const faces = keys(first.faceRanges);
        const edges = keys(first.edgeRanges);
        for (const field of MESH_FIELDS) first[field].fill(7);
        const second = await kernel.tessellate(a, QUALITY);
        expect(validateMeshData(second)).toEqual([]);
        expect(keys(second.faceRanges)).toEqual(faces);
        expect(keys(second.edgeRanges)).toEqual(edges);
      });
    });

    describe('tessellate a box', () => {
      it('passes validateMeshData', async () => {
        expect(validateMeshData(await aBoxMesh())).toEqual([]);
      });

      it('has exactly faces 0..5 and edges 0..11', async () => {
        const mesh = await aBoxMesh();
        const faces = rangesOf(mesh.faceRanges).map((r) => r.key);
        const edges = rangesOf(mesh.edgeRanges).map((r) => r.key);
        expect([...faces].sort((x, y) => x - y)).toEqual([0, 1, 2, 3, 4, 5]);
        expect([...edges].sort((x, y) => x - y)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
      });

      it('every face has at least 2 triangles', async () => {
        const mesh = await aBoxMesh();
        for (const face of rangesOf(mesh.faceRanges)) {
          expect(face.count, `face ${String(face.key)}`).toBeGreaterThanOrEqual(2);
        }
      });

      it('vertices and edge points lie in the box and span it', async () => {
        const mesh = await aBoxMesh();
        const expected: BoundingBox = { min: ORIGIN, max: BOX_MAX };
        for (const [what, list] of [
          ['vertex', points(mesh.positions)],
          ['edge point', points(mesh.edgePositions)],
        ] as const) {
          expectInsideBox(list, what);
          const span = minMax(list);
          expectVecClose(span.min, expected.min, MESH_TOLERANCE, `min of ${what}s`);
          expectVecClose(span.max, expected.max, MESH_TOLERANCE, `max of ${what}s`);
        }
      });

      it('each face has one axis-aligned normal pointing out, one face per box side', async () => {
        const mesh = await aBoxMesh();
        const sides = new Set<string>();
        for (const face of rangesOf(mesh.faceRanges)) {
          const at = `face ${String(face.key)}`;
          const vertices = new Set<number>();
          for (let t = face.first; t < face.first + face.count; t++) {
            for (const v of triangleAt(mesh, t)) vertices.add(v);
          }
          const [firstVertex = 0] = vertices;
          const normal = pointAt(mesh.normals, firstVertex);
          const side = axisOf(normal);
          if (side === undefined)
            expect.fail(`${at}: normal [${normal.join(', ')}] is not axis-aligned`);
          for (const v of vertices) {
            expectVecClose(pointAt(mesh.normals, v), normal, NORMAL_TOLERANCE, `${at}: normal`);
            // Pointing out: the face lies on the box side its normal points to.
            const coord = pointAt(mesh.positions, v)[side.axis] ?? Number.NaN;
            const plane = (side.sign > 0 ? BOX_MAX : ORIGIN)[side.axis] ?? Number.NaN;
            if (!(Math.abs(coord - plane) <= MESH_TOLERANCE)) {
              expect.fail(`${at}: vertex ${String(v)} is not on the side its normal points to`);
            }
          }
          sides.add(`${String(side.sign)}${String(side.axis)}`);
        }
        expect(sides.size).toBe(6);
      });

      it('triangle winding agrees with the normal (counter-clockwise from outside)', async () => {
        const mesh = await aBoxMesh();
        const triangleCount = mesh.indices.length / 3;
        for (let t = 0; t < triangleCount; t++) {
          const [a, b, c] = triangleAt(mesh, t);
          const pa = pointAt(mesh.positions, a);
          const winding = cross(
            sub(pointAt(mesh.positions, b), pa),
            sub(pointAt(mesh.positions, c), pa),
          );
          if (!(dot(winding, pointAt(mesh.normals, a)) > 0)) {
            expect.fail(`triangle ${String(t)}: winding disagrees with the normal`);
          }
        }
      });
    });

    describe('boundingBox', () => {
      it.each(NEVER_ISSUED)('handle %s, never issued, rejects with unknown-handle', async (h) => {
        await aBox();
        expect(await rejectionCode(() => kernel.boundingBox(h))).toBe('unknown-handle');
      });

      it('returns a new object every call; changing it changes nothing', async () => {
        const a = await aBox();
        const first = await kernel.boundingBox(a);
        const second = await kernel.boundingBox(a);
        expect(second).not.toBe(first);
        expect(second.min).not.toBe(first.min);
        // The result is readonly; the test writes into it on purpose to check isolation.
        Reflect.set(first.min, 0, 100);
        Reflect.set(first, 'max', [0, 0, 0]);
        const third = await kernel.boundingBox(a);
        expectEnclosesBox(third, ORIGIN, BOX_MAX);
      });
    });

    describe('release', () => {
      it('an empty list does nothing', async () => {
        const a = await aBox();
        await kernel.release([]);
        expect(await kernel.liveHandleCount()).toBe(1);
        await kernel.boundingBox(a);
      });

      it('releases all given handles', async () => {
        const a = await aBox();
        const b = await aBox();
        const c = await aBox();
        await kernel.release([a, c]);
        expect(await kernel.liveHandleCount()).toBe(1);
        await kernel.boundingBox(b);
      });

      it.each(NEVER_ISSUED)('handle %s, never issued, rejects with unknown-handle', async (h) => {
        await aBox();
        expect(await rejectionCode(() => kernel.release([h]))).toBe('unknown-handle');
        expect(await kernel.liveHandleCount()).toBe(1);
      });

      it.each([
        ['before', (a: ShapeHandle) => [UNKNOWN, a]],
        ['after', (a: ShapeHandle) => [a, UNKNOWN]],
      ])('an unknown handle %s a valid one releases nothing (atomic)', async (_, list) => {
        const a = await aBox();
        expect(await rejectionCode(() => kernel.release(list(a)))).toBe('unknown-handle');
        expect(await kernel.liveHandleCount()).toBe(1);
        expectEnclosesBox(await kernel.boundingBox(a), ORIGIN, BOX_MAX);
        await kernel.release([a]);
        expect(await kernel.liveHandleCount()).toBe(0);
      });

      it('the same handle twice rejects with invalid-input and releases nothing', async () => {
        const a = await aBox();
        const b = await aBox();
        expect(await rejectionCode(() => kernel.release([b, a, a]))).toBe('invalid-input');
        expect(await kernel.liveHandleCount()).toBe(2);
        await kernel.boundingBox(a);
        await kernel.boundingBox(b);
      });
    });

    describe('liveHandleCount', () => {
      it('is 0 for a fresh kernel and counts created, not released handles', async () => {
        expect(await kernel.liveHandleCount()).toBe(0);
        const a = await aBox();
        await aBox();
        await aBox();
        expect(await kernel.liveHandleCount()).toBe(3);
        await kernel.release([a]);
        expect(await kernel.liveHandleCount()).toBe(2);
      });

      it('failed operations create no handles', async () => {
        const a = await aBox();
        await rejectionCode(() => kernel.makeBox({ origin: ORIGIN, size: [-1, 1, 1] }));
        await rejectionCode(() => kernel.tessellate(UNKNOWN, QUALITY));
        await rejectionCode(() => kernel.tessellate(a, { ...QUALITY, linearDeflection: 0 }));
        await rejectionCode(() => kernel.boundingBox(UNKNOWN));
        await rejectionCode(() => kernel.release([a, a]));
        expect(await kernel.liveHandleCount()).toBe(1);
      });
    });

    describe('isolation', () => {
      it('changing makeBox inputs afterwards does not change the shape', async () => {
        const origin: Vec3 = [...ORIGIN];
        const size: Vec3 = [...SIZE];
        const a = (await kernel.makeBox({ origin, size })).shape;
        // The inputs are readonly tuples; the test writes into them on purpose.
        Reflect.set(origin, 0, 100);
        Reflect.set(size, 2, 100);
        const box = await kernel.boundingBox(a);
        expectEnclosesBox(box, ORIGIN, BOX_MAX);
        const mesh = await kernel.tessellate(a, QUALITY);
        expectVecClose(minMax(points(mesh.positions)).max, BOX_MAX, MESH_TOLERANCE, 'mesh max');
      });

      it('changing makeBox inputs right after the call, before await, does not change the shape', async () => {
        const origin: Vec3 = [...ORIGIN];
        const size: Vec3 = [...SIZE];
        const created = callWithoutThrow(() => kernel.makeBox({ origin, size }));
        // Spec 06: the kernel reads its inputs synchronously, as postMessage would clone them.
        Reflect.set(origin, 0, 100);
        Reflect.set(size, 2, 100);
        const a = (await created).shape;
        expectEnclosesBox(await kernel.boundingBox(a), ORIGIN, BOX_MAX);
      });

      it('changing the release list right after the call, before await, does not change what is released', async () => {
        const a = await aBox();
        const b = await aBox();
        const list = [a];
        const released = callWithoutThrow(() => kernel.release(list));
        list[0] = b;
        list.push(a);
        await released;
        expect(await kernel.liveHandleCount()).toBe(1);
        expect(await rejectionCode(() => kernel.boundingBox(a))).toBe('unknown-handle');
        expectEnclosesBox(await kernel.boundingBox(b), ORIGIN, BOX_MAX);
      });

      it.each([
        // Inputs outside the types – a JS caller or a bug can pass them. The casts through
        // unknown break the types on purpose.
        ['makeBox(null)', (k: GeometryKernel) => k.makeBox(null as unknown as typeof BOX)],
        [
          'tessellate(handle, null)',
          (k: GeometryKernel) => k.tessellate(UNKNOWN, null as unknown as MeshQuality),
        ],
        ['release(42)', (k: GeometryKernel) => k.release(42 as unknown as readonly ShapeHandle[])],
      ])(
        '%s: a failed read of the input rejects with internal, not synchronously',
        async (_, call) => {
          const a = await aBox();
          expect(await rejectionCode(() => call(kernel))).toBe('internal');
          expect(await kernel.liveHandleCount()).toBe(1);
          expectEnclosesBox(await kernel.boundingBox(a), ORIGIN, BOX_MAX);
        },
      );

      it('the bounding box shares no array with the makeBox input', async () => {
        const a = (await kernel.makeBox(BOX)).shape;
        const box = await kernel.boundingBox(a);
        expect(box.min).not.toBe(ORIGIN);
      });
    });
  });
}
