// Test-only entry point of kernel: the GeometryKernel contract suite and the FakeKernel.
// dependency-cruiser allows importing it only from *.test.ts.
//
// The suite knows only the GeometryKernel interface, kernelErrorCode and validateMeshData: it
// runs for the FakeKernel (M5) and for the OCCT kernel (M7). So it assumes nothing outside the
// contract of spec 06 – no face order, no vertex counts, no exact float values. Errors are
// checked with kernelErrorCode, never instanceof, because over core/rpc a kernel error arrives
// as an RpcError carrying the same code.

import { beforeEach, describe, expect, it } from 'vitest';
import { mat4, type Mat4, type Plane, type Vec2, type Vec3 } from '@/core';
import { kernelErrorCode } from './errors';
import type { KernelErrorCode } from './errors';
import type { Axis, BooleanOp, GeometryKernel } from './kernel';
import type { ProfileCurve, ProfileLoop } from './profile';
import { validateMeshData } from './mesh';
import type {
  BoundingBox,
  MeshData,
  MeshQuality,
  ShapeHandle,
  ShapeHistory,
  ShapeResult,
  SubShapeIndex,
  TopologySummary,
} from './types';

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

// M11 fixtures. The cylinder stands on the box corner ORIGIN; its axis is not unit length.
const CYLINDER = { base: ORIGIN, axis: [0, 0, 2] as Vec3, radius: 2, height: 4 };
const CYLINDER_MIN: Vec3 = [-1, -4, 3];
const CYLINDER_MAX: Vec3 = [3, 0, 7];
// Boxes for boolean, relative to BOX = [1, -2, 3]..[3, 1, 7]:
/** [2, 0, 5]..[4, 2, 9]: overlaps BOX in [2, 0, 5]..[3, 1, 7]. */
const OVERLAPPING = { origin: [2, 0, 5] as Vec3, size: [2, 2, 4] as Vec3 };
/** [10, 0, 0]..[11, 1, 1]: no common point with BOX. */
const SEPARATE = { origin: [10, 0, 0] as Vec3, size: [1, 1, 1] as Vec3 };
/** [2.5, 0.5, 6.5]..[3.5, 1.5, 7.5]: cuts the corner BOX_MAX off BOX, no whole side. */
const CORNER = { origin: [2.5, 0.5, 6.5] as Vec3, size: [1, 1, 1] as Vec3 };

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

/** Spec 06 (M11): bounding boxes of modelling results are compared within this, per component. */
const BBOX_TOLERANCE = 1e-5;

/** The bounding box equals [min, max] within BBOX_TOLERANCE in every component. */
function expectBoxClose(actual: BoundingBox, min: Vec3, max: Vec3, what = 'bounding box'): void {
  expectVecClose(actual.min, min, BBOX_TOLERANCE, `min of ${what}`);
  expectVecClose(actual.max, max, BBOX_TOLERANCE, `max of ${what}`);
}

/**
 * The mesh passes validateMeshData and every vertex and edge point lies in [min, max], within
 * the float32 precision of the mesh relative to the extent of the box.
 */
function expectValidMeshIn(mesh: MeshData, min: Vec3, max: Vec3, what: string): void {
  expect(validateMeshData(mesh), `${what}: validateMeshData`).toEqual([]);
  const tolerance = 1e-5 * Math.max(1, ...min.map(Math.abs), ...max.map(Math.abs));
  for (const [kind, list] of [
    ['vertex', points(mesh.positions)],
    ['edge point', points(mesh.edgePositions)],
  ] as const) {
    list.forEach((p, i) => {
      for (let k = 0; k < 3; k++) {
        const c = p[k] ?? Number.NaN;
        const lo = (min[k] ?? Number.NaN) - tolerance;
        const hi = (max[k] ?? Number.NaN) + tolerance;
        if (!(c >= lo && c <= hi)) {
          expect.fail(`${what}: ${kind} ${String(i)} [${p.join(', ')}] outside the bounding box`);
        }
      }
    });
  }
}

/** A matrix written by rows; Mat4 is column-major (element r, c at index c * 4 + r). */
// prettier-ignore
function fromRows(
  a11: number, a12: number, a13: number, a14: number,
  a21: number, a22: number, a23: number, a24: number,
  a31: number, a32: number, a33: number, a34: number,
  a41: number, a42: number, a43: number, a44: number,
): Mat4 {
  return [a11, a21, a31, a41, a12, a22, a32, a42, a13, a23, a33, a43, a14, a24, a34, a44];
}

const INF = Number.POSITIVE_INFINITY;
// prettier-ignore
const NOT_RIGID: readonly (readonly [string, Mat4])[] = [
  ['a non-orthonormal matrix (shear)', fromRows(1, 0.5, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)],
  ['a mirror (det -1)', fromRows(-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)],
  ['a scale 2', fromRows(2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1)],
  ['a matrix with NaN', fromRows(1, 0, 0, Number.NaN, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)],
  ['a matrix with Infinity', fromRows(1, 0, 0, 0, 0, 1, 0, INF, 0, 0, 1, 0, 0, 0, 0, 1)],
  ['a non-affine bottom row', fromRows(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0.1, 0, 0, 1)],
];

// M12 fixtures: planes from the table in spec 12 (Roviny a počátek), loops in plane coordinates.
const PLANE_XY: Plane = { origin: [0, 0, 0], xDir: [1, 0, 0], normal: [0, 0, 1] };
/** XZ moved to y = 5: x → +X, y → normal × xDir = +Z. */
const PLANE_XZ_AT_Y5: Plane = { origin: [0, 5, 0], xDir: [1, 0, 0], normal: [0, -1, 0] };
/** YZ moved to x = 3: x → +Y, y → +Z. */
const PLANE_YZ_AT_X3: Plane = { origin: [3, 0, 0], xDir: [0, 1, 0], normal: [1, 0, 0] };

const line = (from: Vec2, to: Vec2): ProfileCurve => ({ kind: 'line', from, to });

/** Closed polygon through the points. */
function polygon(...corners: Vec2[]): ProfileLoop {
  return corners.map((p, i) => line(p, corners[(i + 1) % corners.length] ?? p));
}

/** [1, 2]..[4, 5] in XY: off the origin, so swapped axes show up. */
const SQUARE = polygon([1, 2], [4, 2], [4, 5], [1, 5]);
/** Square [0, 0]..[4, 4] with a circular hole of radius 1 in the middle. */
const HOLED_OUTER = polygon([0, 0], [4, 0], [4, 4], [0, 4]);
const HOLE: ProfileLoop = [{ kind: 'circle', center: [2, 2], radius: 1 }];
/** Line (0, −1)–(0, 1) and a half circle back: through (−1, 0) when ccw, through (1, 0) when not. */
const D_LOOP = (ccw: boolean): ProfileLoop => [
  line([0, -1], [0, 1]),
  { kind: 'arc', center: [0, 0], from: [0, 1], to: [0, -1], ccw },
];
type FaceParams = Parameters<GeometryKernel['makeFace']>[0];
const FACE: FaceParams = { plane: PLANE_XY, outer: SQUARE, holes: [] };

// M13 fixtures: profiles for extrude and revolve.
/** XZ through the origin: x → +X, y → normal × xDir = +Z. */
const PLANE_XZ: Plane = { origin: [0, 0, 0], xDir: [1, 0, 0], normal: [0, -1, 0] };
/** Square [0, 10]² in XY. */
const SQUARE_10: FaceParams = {
  plane: PLANE_XY,
  outer: polygon([0, 0], [10, 0], [10, 10], [0, 10]),
  holes: [],
};
/** Rectangle x ∈ [0, 2], z ∈ [0, 3] in XZ. */
const RECTANGLE_XZ: FaceParams = {
  plane: PLANE_XZ,
  outer: polygon([0, 0], [2, 0], [2, 3], [0, 3]),
  holes: [],
};
/** Rectangle x ∈ [5, 10], z ∈ [0, 10] in XZ: off the Z axis, a ring when revolved about it. */
const RING_PROFILE: FaceParams = {
  plane: PLANE_XZ,
  outer: polygon([5, 0], [10, 0], [10, 10], [5, 10]),
  holes: [],
};
const Z_AXIS = { origin: [0, 0, 0], direction: [0, 0, 1] } as const satisfies Axis;
const TURN = 2 * Math.PI;

// M14 fixtures and checks: roles, topology and history.
/** Spec 06 (R93): the box roles by world axes and the outward normal of each. */
const BOX_ROLE_NORMALS: Readonly<Record<string, Vec3>> = {
  'face:top': [0, 0, 1],
  'face:bottom': [0, 0, -1],
  'face:front': [0, -1, 0],
  'face:back': [0, 1, 0],
  'face:left': [-1, 0, 0],
  'face:right': [1, 0, 0],
};
const HISTORY_BOOLEAN_OPS: readonly BooleanOp[] = ['union', 'subtract', 'intersect'];
const KIND_ORDER = ['face', 'edge', 'vertex'] as const;
type SubShapeKind = (typeof KIND_ORDER)[number];

/** Integers in [0, count), strictly ascending (so without duplicates). */
function expectAscendingIn(indices: readonly number[], count: number, what: string): void {
  indices.forEach((i, k) => {
    if (!(Number.isInteger(i) && i >= 0 && i < count)) {
      expect.fail(`${what}: index ${String(i)} not in [0, ${String(count)})`);
    }
    if (k > 0 && !(i > (indices[k - 1] ?? Number.NaN))) {
      expect.fail(`${what}: [${indices.join(', ')}] not strictly ascending`);
    }
  });
}

/** Number of sub-shapes of the kind in the topology. */
function countOf(t: TopologySummary, kind: SubShapeKind): number {
  switch (kind) {
    case 'face':
      return t.faces.length;
    case 'edge':
      return t.edges.length;
    case 'vertex':
      return t.vertexCount;
  }
}

/**
 * Spec 06, contract "roles a history": every face of every input exactly once in modified or
 * deleted; modified and deleted only for faces, generated only to faces; indices valid and
 * ascending; entries ordered by input, kind (face, edge, vertex), index.
 */
function expectCompleteHistory(
  history: ShapeHistory,
  inputs: readonly TopologySummary[],
  output: TopologySummary,
  what: string,
): void {
  const seen = inputs.map((t) => new Array<number>(t.faces.length).fill(0));
  const count = (input: number, index: number): void => {
    const row = seen[input];
    if (row === undefined || !(index >= 0 && index < row.length)) {
      expect.fail(`${what}: face ${String(index)} of input ${String(input)} out of range`);
    }
    row[index] = (row[index] ?? 0) + 1;
  };
  for (const link of history.modified) {
    expect(link.from.type, `${what}: modified from`).toBe('face');
    count(link.input, link.from.index);
    expect(
      link.to.every((s) => s.type === 'face'),
      `${what}: modified to faces`,
    ).toBe(true);
    expectAscendingIn(
      link.to.map((s) => s.index),
      output.faces.length,
      `${what}: modified to`,
    );
  }
  for (const d of history.deleted) {
    expect(d.sub.type, `${what}: deleted`).toBe('face');
    count(d.input, d.sub.index);
  }
  seen.forEach((row, input) => {
    row.forEach((n, face) => {
      if (n !== 1) {
        expect.fail(
          `${what}: face ${String(face)} of input ${String(input)} is there ${String(n)}×`,
        );
      }
    });
  });
  for (const link of history.generated) {
    const input = inputs[link.input];
    if (input === undefined) expect.fail(`${what}: generated from a missing input`);
    expectAscendingIn([link.from.index], countOf(input, link.from.type), `${what}: generated from`);
    expect(link.to.length, `${what}: generated to`).toBeGreaterThan(0);
    expect(
      link.to.every((s) => s.type === 'face'),
      `${what}: generated to faces`,
    ).toBe(true);
    expectAscendingIn(
      link.to.map((s) => s.index),
      output.faces.length,
      `${what}: generated to`,
    );
  }
  const key = (input: number, sub: SubShapeIndex): readonly [number, number, number] => [
    input,
    KIND_ORDER.indexOf(sub.type),
    sub.index,
  ];
  for (const list of [
    history.modified.map((l) => key(l.input, l.from)),
    history.deleted.map((d) => key(d.input, d.sub)),
    history.generated.map((l) => key(l.input, l.from)),
  ]) {
    list.forEach((k, i) => {
      const prev = list[i - 1];
      if (prev === undefined) return;
      const order = prev[0] - k[0] || prev[1] - k[1] || prev[2] - k[2];
      if (!(order < 0)) expect.fail(`${what}: history entries out of order at ${String(i)}`);
    });
  }
}

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
        ['makeCylinder', (k: GeometryKernel) => k.makeCylinder({ ...CYLINDER, radius: 0 })],
        ['transform', (k: GeometryKernel) => k.transform(UNKNOWN, mat4.identity())],
        ['boolean', (k: GeometryKernel) => k.boolean('union', [], [])],
        ['makeFace', (k: GeometryKernel) => k.makeFace({ ...FACE, outer: [] })],
        ['extrude', (k: GeometryKernel) => k.extrude(UNKNOWN, [0, 0, 1], 5)],
        ['revolve', (k: GeometryKernel) => k.revolve(UNKNOWN, Z_AXIS, TURN)],
        ['fillet', (k: GeometryKernel) => k.fillet(UNKNOWN, [0], 1)],
        ['chamfer', (k: GeometryKernel) => k.chamfer(UNKNOWN, [0], 1)],
        ['topology', (k: GeometryKernel) => k.topology(UNKNOWN)],
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
        const other = (await kernel.makeBox(OVERLAPPING)).shape;
        const profile = (await kernel.makeFace(RING_PROFILE)).shape;
        const calls = [
          kernel.makeCylinder(CYLINDER),
          kernel.transform(shape, mat4.identity()),
          kernel.boolean('union', [shape], [other]),
          kernel.makeFace(FACE),
          kernel.extrude(profile, [0, 0, 1], 5),
          kernel.revolve(profile, Z_AXIS, TURN),
          kernel.fillet(shape, [0], 0.5),
          kernel.chamfer(shape, [0], 0.5),
          kernel.topology(shape),
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

    describe('makeCylinder', () => {
      it.each([
        ['x', [1, 0, 0], [1, -4, 1], [5, 0, 5]],
        ['y', [0, 1, 0], [-1, -2, 1], [3, 2, 5]],
        ['z, not unit length', [0, 0, 2], CYLINDER_MIN, CYLINDER_MAX],
      ] satisfies [string, Vec3, Vec3, Vec3][])(
        'axis %s: a new handle with the bounding box of the cylinder',
        async (_, axis, min, max) => {
          const { shape } = await kernel.makeCylinder({ ...CYLINDER, axis });
          expect(Number.isInteger(shape)).toBe(true);
          expect(shape).toBeGreaterThan(0);
          expect(await kernel.liveHandleCount()).toBe(1);
          expectBoxClose(await kernel.boundingBox(shape), min, max);
        },
      );

      it('the mesh passes validateMeshData and lies in the bounding box', async () => {
        const { shape } = await kernel.makeCylinder(CYLINDER);
        const mesh = await kernel.tessellate(shape, QUALITY);
        expectValidMeshIn(mesh, CYLINDER_MIN, CYLINDER_MAX, 'cylinder');
      });

      it.each([
        ['base NaN', { base: [Number.NaN, 0, 0] }],
        ['base Infinity', { base: [0, Number.POSITIVE_INFINITY, 0] }],
        ['axis NaN', { axis: [0, 0, Number.NaN] }],
        ['axis Infinity', { axis: [Number.NEGATIVE_INFINITY, 0, 1] }],
        ['axis zero', { axis: [0, 0, 0] }],
        ['axis of length 1e-10', { axis: [1e-10, 0, 0] }],
        ['radius 0', { radius: 0 }],
        ['radius negative', { radius: -1 }],
        ['radius NaN', { radius: Number.NaN }],
        ['radius Infinity', { radius: Number.POSITIVE_INFINITY }],
        ['height 0', { height: 0 }],
        ['height negative', { height: -1 }],
        ['height NaN', { height: Number.NaN }],
        ['height Infinity', { height: Number.POSITIVE_INFINITY }],
      ] satisfies [string, Partial<typeof CYLINDER>][])(
        '%s rejects with invalid-input and creates no handle',
        async (_, change) => {
          const p = { ...CYLINDER, ...change };
          expect(await rejectionCode(() => kernel.makeCylinder(p))).toBe('invalid-input');
          expect(await kernel.liveHandleCount()).toBe(0);
        },
      );
    });

    describe('transform', () => {
      it('a translation moves the bounding box; a new handle', async () => {
        const a = await aBox();
        const { shape } = await kernel.transform(a, mat4.translation([10, 0, -5]));
        expect(shape).not.toBe(a);
        expect(await kernel.liveHandleCount()).toBe(2);
        expectBoxClose(await kernel.boundingBox(shape), [11, -2, -2], [13, 1, 2]);
      });

      it('a rotation by 90° about Z about the origin turns the bounding box', async () => {
        const m = mat4.rotationAxisAngle([0, 0, 1], Math.PI / 2);
        const { shape } = await kernel.transform(await aBox(), m);
        // (x, y) → (−y, x): x in [1, 3], y in [−2, 1] gives x' in [−1, 2], y' in [1, 3].
        expectBoxClose(await kernel.boundingBox(shape), [-1, 1, 3], [2, 3, 7]);
      });

      it('a rotation by 45° about Z gives the bounding box of the turned corners', async () => {
        const m = mat4.rotationAxisAngle([0, 0, 1], Math.PI / 4);
        const { shape } = await kernel.transform(await aBox(), m);
        // x' = (x − y)/√2 with x − y in [0, 5]; y' = (x + y)/√2 with x + y in [−1, 4].
        const s = Math.SQRT1_2;
        expectBoxClose(await kernel.boundingBox(shape), [0, -s, 3], [5 * s, 4 * s, 7]);
      });

      it('the input stays valid with the same bounding box', async () => {
        const a = await aBox();
        await kernel.transform(a, mat4.translation([10, 0, 0]));
        expectEnclosesBox(await kernel.boundingBox(a), ORIGIN, BOX_MAX);
        expect(await kernel.liveHandleCount()).toBe(2);
      });

      it('the mesh of the result passes validateMeshData and lies in its bounding box', async () => {
        const m = mat4.multiply(
          mat4.translation([0, 0, 1]),
          mat4.rotationAxisAngle([0, 0, 1], Math.PI / 4),
        );
        const { shape } = await kernel.transform(await aBox(), m);
        const s = Math.SQRT1_2;
        const mesh = await kernel.tessellate(shape, QUALITY);
        expectValidMeshIn(mesh, [0, -s, 4], [5 * s, 4 * s, 8], 'moved box');
      });

      it.each(NOT_RIGID)('%s rejects with invalid-input and creates no handle', async (_, m) => {
        const a = await aBox();
        expect(await rejectionCode(() => kernel.transform(a, m))).toBe('invalid-input');
        expect(await kernel.liveHandleCount()).toBe(1);
      });

      it.each(NEVER_ISSUED)('handle %s, never issued, rejects with unknown-handle', async (h) => {
        await aBox();
        const code = await rejectionCode(() => kernel.transform(h, mat4.identity()));
        expect(code).toBe('unknown-handle');
        expect(await kernel.liveHandleCount()).toBe(1);
      });
    });

    describe('boolean', () => {
      async function aShape(box: { readonly origin: Vec3; readonly size: Vec3 }) {
        return (await kernel.makeBox(box)).shape;
      }

      /** One new handle with bounding box [min, max] and a valid mesh inside it. */
      async function expectResult(
        op: BooleanOp,
        targets: readonly ShapeHandle[],
        tools: readonly ShapeHandle[],
        min: Vec3,
        max: Vec3,
      ): Promise<void> {
        const before = await kernel.liveHandleCount();
        const { shape } = await kernel.boolean(op, targets, tools);
        expect([...targets, ...tools]).not.toContain(shape);
        expect(await kernel.liveHandleCount()).toBe(before + 1);
        expectBoxClose(await kernel.boundingBox(shape), min, max, `${op} result`);
        const mesh = await kernel.tessellate(shape, QUALITY);
        expectValidMeshIn(mesh, min, max, `${op} result`);
      }

      it('union of two overlapping boxes has their enclosing bounding box', async () => {
        const tool = await aShape(OVERLAPPING);
        await expectResult('union', [await aBox()], [tool], ORIGIN, [4, 2, 9]);
      });

      it('union of two separate boxes has their enclosing bounding box', async () => {
        const tool = await aShape(SEPARATE);
        await expectResult('union', [await aBox()], [tool], [1, -2, 0], [11, 1, 7]);
      });

      it('intersect of two overlapping boxes is exactly their common part', async () => {
        const tool = await aShape(OVERLAPPING);
        await expectResult('intersect', [await aBox()], [tool], [2, 0, 5], [3, 1, 7]);
      });

      it('intersect of two separate boxes rejects with operation-failed, no handle', async () => {
        const a = await aBox();
        const b = await aShape(SEPARATE);
        const code = await rejectionCode(() => kernel.boolean('intersect', [a], [b]));
        expect(code).toBe('operation-failed');
        expect(await kernel.liveHandleCount()).toBe(2);
      });

      it('subtract of a box cutting a corner keeps the bounding box of the target', async () => {
        const tool = await aShape(CORNER);
        await expectResult('subtract', [await aBox()], [tool], ORIGIN, BOX_MAX);
      });

      it('the inputs stay valid with the same bounding boxes', async () => {
        const a = await aBox();
        const b = await aShape(OVERLAPPING);
        for (const op of ['union', 'subtract', 'intersect'] as const) {
          await kernel.boolean(op, [a], [b]);
        }
        expect(await kernel.liveHandleCount()).toBe(5);
        expectEnclosesBox(await kernel.boundingBox(a), ORIGIN, BOX_MAX, 'target');
        expectEnclosesBox(await kernel.boundingBox(b), [2, 0, 5], [4, 2, 9], 'tool');
      });

      type BooleanArgs = readonly [BooleanOp, readonly ShapeHandle[], readonly ShapeHandle[]];
      it.each([
        ['empty targets', (a, b) => ['union', [], [a, b]]],
        ['empty tools', (a, b) => ['union', [a, b], []]],
        ['a repeated target', (a, b) => ['union', [a, a], [b]]],
        ['a repeated tool', (a, b) => ['subtract', [a], [b, b]]],
        ['a handle in both lists', (a) => ['intersect', [a], [a]]],
        // An op outside the type – a JS caller or a bug can pass it.
        ['an unknown op', (a, b) => ['xor' as BooleanOp, [a], [b]]],
      ] satisfies [string, (a: ShapeHandle, b: ShapeHandle) => BooleanArgs][])(
        '%s rejects with invalid-input and creates no handle',
        async (_, args) => {
          const a = await aBox();
          const b = await aShape(OVERLAPPING);
          const [op, targets, tools] = args(a, b);
          const code = await rejectionCode(() => kernel.boolean(op, targets, tools));
          expect(code).toBe('invalid-input');
          expect(await kernel.liveHandleCount()).toBe(2);
        },
      );

      it.each([
        ['in targets', (a) => [[UNKNOWN], [a]]],
        ['in tools', (a) => [[a], [UNKNOWN]]],
      ] satisfies [string, (a: ShapeHandle) => readonly [ShapeHandle[], ShapeHandle[]]][])(
        'an unknown handle %s rejects with unknown-handle',
        async (_, args) => {
          const a = await aBox();
          const [targets, tools] = args(a);
          const code = await rejectionCode(() => kernel.boolean('union', targets, tools));
          expect(code).toBe('unknown-handle');
          expect(await kernel.liveHandleCount()).toBe(1);
        },
      );
    });

    describe('makeFace', () => {
      it.each([
        ['a square in XY', { plane: PLANE_XY, outer: SQUARE, holes: [] }, [1, 2, 0], [4, 5, 0]],
        [
          'a rectangle in XZ moved to y = 5',
          { plane: PLANE_XZ_AT_Y5, outer: polygon([0, 0], [2, 0], [2, 3], [0, 3]), holes: [] },
          [0, 5, 0],
          [2, 5, 3],
        ],
        [
          'a circle in YZ moved to x = 3',
          {
            plane: PLANE_YZ_AT_X3,
            outer: [{ kind: 'circle', center: [1, 2], radius: 0.5 }],
            holes: [],
          },
          [3, 0.5, 1.5],
          [3, 1.5, 2.5],
        ],
        ['a D, ccw', { plane: PLANE_XY, outer: D_LOOP(true), holes: [] }, [-1, -1, 0], [0, 1, 0]],
        [
          'a D, clockwise',
          { plane: PLANE_XY, outer: D_LOOP(false), holes: [] },
          [0, -1, 0],
          [1, 1, 0],
        ],
        [
          'a square with a circular hole',
          { plane: PLANE_XY, outer: HOLED_OUTER, holes: [HOLE] },
          [0, 0, 0],
          [4, 4, 0],
        ],
        [
          'a square in reverse orientation',
          { plane: PLANE_XY, outer: polygon([1, 2], [1, 5], [4, 5], [4, 2]), holes: [] },
          [1, 2, 0],
          [4, 5, 0],
        ],
      ] satisfies [string, FaceParams, Vec3, Vec3][])(
        '%s: a new handle with the bounding box of the outer loop and a valid mesh',
        async (_, p, min, max) => {
          const { shape } = await kernel.makeFace(p);
          expect(Number.isInteger(shape)).toBe(true);
          expect(shape).toBeGreaterThan(0);
          expect(await kernel.liveHandleCount()).toBe(1);
          expectBoxClose(await kernel.boundingBox(shape), min, max, 'face');
          const mesh = await kernel.tessellate(shape, QUALITY);
          expectValidMeshIn(mesh, min, max, 'face');
        },
      );

      it('every call returns a new handle', async () => {
        const a = (await kernel.makeFace(FACE)).shape;
        const b = (await kernel.makeFace(FACE)).shape;
        expect(b).not.toBe(a);
        expect(await kernel.liveHandleCount()).toBe(2);
      });

      it.each([
        ['a plane that is not orthonormal', { ...FACE, plane: { ...PLANE_XY, xDir: [2, 0, 0] } }],
        ['an open loop', { ...FACE, outer: SQUARE.slice(0, 3) }],
        [
          'a circle in the middle of a loop of several curves',
          {
            ...FACE,
            outer: [
              ...SQUARE.slice(0, 2),
              { kind: 'circle', center: [2, 3], radius: 0.5 },
              ...SQUARE.slice(2),
            ],
          },
        ],
        ['a line of zero length', { ...FACE, outer: [...SQUARE, line([1, 2], [1, 2])] }],
        [
          'an arc with unequal radii',
          {
            ...FACE,
            outer: [
              line([0, -1], [0, 1.5]),
              { kind: 'arc', center: [0, 0], from: [0, 1.5], to: [0, -1], ccw: true },
            ],
          },
        ],
        ['an empty outer loop', { ...FACE, outer: [] }],
      ] satisfies [string, FaceParams][])(
        '%s rejects with invalid-input and creates no handle',
        async (_, p) => {
          expect(await rejectionCode(() => kernel.makeFace(p))).toBe('invalid-input');
          expect(await kernel.liveHandleCount()).toBe(0);
        },
      );
    });

    describe('extrude', () => {
      async function aProfile(p: FaceParams = SQUARE_10): Promise<ShapeHandle> {
        return (await kernel.makeFace(p)).shape;
      }

      it.each([
        ['a square in XY by 5 along +Z', SQUARE_10, [0, 0, 1], 5, [0, 0, 0], [10, 10, 5]],
        ['a square in XY by 5 along [0, 0, 3]', SQUARE_10, [0, 0, 3], 5, [0, 0, 0], [10, 10, 5]],
        ['a square in XY by 5 along −Z', SQUARE_10, [0, 0, -1], 5, [0, 0, -5], [10, 10, 0]],
        ['a rectangle in XZ by 4 along −Y', RECTANGLE_XZ, [0, -1, 0], 4, [0, -4, 0], [2, 0, 3]],
      ] satisfies [string, FaceParams, Vec3, number, Vec3, Vec3][])(
        '%s: a new handle with the swept bounding box and a valid mesh',
        async (_, face, direction, distance, min, max) => {
          const profile = await aProfile(face);
          const { shape } = await kernel.extrude(profile, direction, distance);
          expect(shape).not.toBe(profile);
          expect(await kernel.liveHandleCount()).toBe(2);
          expectBoxClose(await kernel.boundingBox(shape), min, max, 'prism');
          expectValidMeshIn(await kernel.tessellate(shape, QUALITY), min, max, 'prism');
        },
      );

      it('the profile stays valid; every call returns a new handle', async () => {
        const profile = await aProfile();
        const a = (await kernel.extrude(profile, [0, 0, 1], 5)).shape;
        const b = (await kernel.extrude(profile, [0, 0, 1], 5)).shape;
        expect(b).not.toBe(a);
        expect(await kernel.liveHandleCount()).toBe(3);
        expectBoxClose(await kernel.boundingBox(profile), [0, 0, 0], [10, 10, 0], 'profile');
      });

      it('a moved profile (transform of a face) is a face too', async () => {
        const moved = await kernel.transform(await aProfile(), mat4.translation([0, 0, 7]));
        const { shape } = await kernel.extrude(moved.shape, [0, 0, 1], 5);
        expectBoxClose(await kernel.boundingBox(shape), [0, 0, 7], [10, 10, 12], 'prism');
      });

      it.each([
        ['a distance of 0', [0, 0, 1], 0],
        ['a negative distance', [0, 0, 1], -5],
        ['a NaN distance', [0, 0, 1], Number.NaN],
        ['an infinite distance', [0, 0, 1], INF],
        ['a zero direction', [0, 0, 0], 5],
        ['a direction with NaN', [0, Number.NaN, 1], 5],
      ] satisfies [string, Vec3, number][])(
        '%s rejects with invalid-input and creates no handle',
        async (_, direction, distance) => {
          const profile = await aProfile();
          const code = await rejectionCode(() => kernel.extrude(profile, direction, distance));
          expect(code).toBe('invalid-input');
          expect(await kernel.liveHandleCount()).toBe(1);
        },
      );

      it('a profile that is not a face (a box) rejects with invalid-input', async () => {
        const box = await aBox();
        expect(await rejectionCode(() => kernel.extrude(box, [0, 0, 1], 5))).toBe('invalid-input');
        expect(await kernel.liveHandleCount()).toBe(1);
      });

      it('a prism is not a face either', async () => {
        const prism = (await kernel.extrude(await aProfile(), [0, 0, 1], 5)).shape;
        const code = await rejectionCode(() => kernel.extrude(prism, [0, 0, 1], 5));
        expect(code).toBe('invalid-input');
        expect(await kernel.liveHandleCount()).toBe(2);
      });

      it.each(NEVER_ISSUED)('handle %s, never issued, rejects with unknown-handle', async (h) => {
        await aProfile();
        expect(await rejectionCode(() => kernel.extrude(h, [0, 0, 1], 5))).toBe('unknown-handle');
        expect(await kernel.liveHandleCount()).toBe(1);
      });
    });

    describe('revolve', () => {
      async function aRing(): Promise<ShapeHandle> {
        return (await kernel.makeFace(RING_PROFILE)).shape;
      }

      it.each([
        ['about Z by 2π', Z_AXIS, TURN, [-10, -10, 0], [10, 10, 10]],
        ['about Z by π/2', Z_AXIS, TURN / 4, [0, 0, 0], [10, 10, 10]],
        [
          'about −Z by π/2',
          { origin: [0, 0, 0], direction: [0, 0, -1] },
          TURN / 4,
          [0, -10, 0],
          [10, 0, 10],
        ],
        [
          'about Z (a non-unit direction) by π/2',
          { origin: [0, 0, 0], direction: [0, 0, 4] },
          TURN / 4,
          [0, 0, 0],
          [10, 10, 10],
        ],
      ] satisfies [string, Axis, number, Vec3, Vec3][])(
        'a rectangle in XZ %s: a new handle with its bounding box and a valid mesh',
        async (_, axis, angle, min, max) => {
          const profile = await aRing();
          const { shape } = await kernel.revolve(profile, axis, angle);
          expect(shape).not.toBe(profile);
          expect(await kernel.liveHandleCount()).toBe(2);
          expectBoxClose(await kernel.boundingBox(shape), min, max, 'revolved');
          expectValidMeshIn(await kernel.tessellate(shape, QUALITY), min, max, 'revolved');
        },
      );

      it('the profile stays valid', async () => {
        const profile = await aRing();
        await kernel.revolve(profile, Z_AXIS, TURN);
        expectBoxClose(await kernel.boundingBox(profile), [5, 0, 0], [10, 0, 10], 'profile');
        expect(await kernel.liveHandleCount()).toBe(2);
      });

      it.each([
        ['an angle of 0', Z_AXIS, 0],
        ['a negative angle', Z_AXIS, -1],
        ['an angle over 2π', Z_AXIS, TURN + 1e-6],
        ['a NaN angle', Z_AXIS, Number.NaN],
        ['a zero axis direction', { origin: [0, 0, 0], direction: [0, 0, 0] }, TURN],
        ['an axis origin with Infinity', { origin: [INF, 0, 0], direction: [0, 0, 1] }, TURN],
      ] satisfies [string, Axis, number][])(
        '%s rejects with invalid-input and creates no handle',
        async (_, axis, angle) => {
          const profile = await aRing();
          expect(await rejectionCode(() => kernel.revolve(profile, axis, angle))).toBe(
            'invalid-input',
          );
          expect(await kernel.liveHandleCount()).toBe(1);
        },
      );

      it('a profile that is not a face (a box) rejects with invalid-input', async () => {
        const box = await aBox();
        expect(await rejectionCode(() => kernel.revolve(box, Z_AXIS, TURN))).toBe('invalid-input');
        expect(await kernel.liveHandleCount()).toBe(1);
      });

      it.each(NEVER_ISSUED)('handle %s, never issued, rejects with unknown-handle', async (h) => {
        await aRing();
        expect(await rejectionCode(() => kernel.revolve(h, Z_AXIS, TURN))).toBe('unknown-handle');
        expect(await kernel.liveHandleCount()).toBe(1);
      });
    });

    describe('topology (M14)', () => {
      it('a box: 6 planar faces with outward normals on their walls, 12 edges, 8 vertices', async () => {
        const shape = await aBox();
        const topology = await kernel.topology(shape);
        expect(topology.faces).toHaveLength(6);
        expect(topology.edges).toHaveLength(12);
        expect(topology.vertexCount).toBe(8);
        const walls = new Set<string>();
        topology.faces.forEach((face, i) => {
          expect(face.surface, `face ${String(i)}`).toBe('plane');
          const plane = face.plane;
          if (plane === undefined) return expect.fail(`face ${String(i)} has no plane`);
          expect(Math.hypot(...plane.normal)).toBeCloseTo(1, 6);
          const wall = axisOf(plane.normal);
          if (wall === undefined) return expect.fail(`face ${String(i)}: normal not axis-aligned`);
          // Outward: the plane point lies on the wall the normal points away from the box.
          const level = (wall.sign > 0 ? BOX_MAX : ORIGIN)[wall.axis] ?? Number.NaN;
          expect(Math.abs((plane.origin[wall.axis] ?? Number.NaN) - level)).toBeLessThan(1e-6);
          walls.add(`${String(wall.sign)}${String(wall.axis)}`);
        });
        expect(walls.size).toBe(6);
        topology.edges.forEach((edge, i) => {
          expect(edge.faces, `faces of edge ${String(i)}`).toHaveLength(2);
          expect(edge.vertices, `vertices of edge ${String(i)}`).toHaveLength(2);
          expectAscendingIn(edge.faces, 6, `faces of edge ${String(i)}`);
          expectAscendingIn(edge.vertices, 8, `vertices of edge ${String(i)}`);
          // The midpoint lies on the planes of both adjacent faces.
          for (const f of edge.faces) {
            const plane = topology.faces[f]?.plane;
            if (plane === undefined) return expect.fail(`face ${String(f)} has no plane`);
            const off = dot(sub(edge.midpoint, plane.origin), plane.normal);
            expect(
              Math.abs(off),
              `midpoint of edge ${String(i)} off face ${String(f)}`,
            ).toBeLessThan(1e-6);
          }
        });
      });

      it('has as many faces and edges as the mesh and creates no handle', async () => {
        const shape = await aBox();
        const topology = await kernel.topology(shape);
        const mesh = await kernel.tessellate(shape, QUALITY);
        expect(topology.faces).toHaveLength(mesh.faceRanges.length / 3);
        expect(topology.edges).toHaveLength(mesh.edgeRanges.length / 3);
        expect(await kernel.liveHandleCount()).toBe(1);
      });

      it.each(NEVER_ISSUED)('handle %s, never issued, rejects with unknown-handle', async (h) => {
        await aBox();
        expect(await rejectionCode(() => kernel.topology(h))).toBe('unknown-handle');
      });

      it('a released handle rejects with unknown-handle', async () => {
        const a = await aBox();
        await kernel.release([a]);
        expect(await rejectionCode(() => kernel.topology(a))).toBe('unknown-handle');
      });
    });

    describe('roles (M14)', () => {
      it('a box: the six world-axis roles, one face each, with the normal of the table (R93)', async () => {
        const { shape, roles } = await kernel.makeBox(BOX);
        const topology = await kernel.topology(shape);
        expect(Object.keys(roles ?? {}).sort()).toEqual(Object.keys(BOX_ROLE_NORMALS).sort());
        const faces = new Set<number>();
        for (const [role, normal] of Object.entries(BOX_ROLE_NORMALS)) {
          const subs = roles?.[role] ?? [];
          expect(subs, role).toHaveLength(1);
          const [only] = subs;
          if (only === undefined) return expect.fail(`${role} has no face`);
          expect(only.type, role).toBe('face');
          faces.add(only.index);
          const plane = topology.faces[only.index]?.plane;
          if (plane === undefined) return expect.fail(`${role}: the face has no plane`);
          expectVecClose(plane.normal, normal, NORMAL_TOLERANCE, `normal of ${role}`);
        }
        expect(faces.size).toBe(6);
      });

      it('a cylinder: top and bottom planar along ±axis, a non-empty side, disjoint', async () => {
        const { shape, roles } = await kernel.makeCylinder(CYLINDER);
        const topology = await kernel.topology(shape);
        expect(Object.keys(roles ?? {}).sort()).toEqual(['face:bottom', 'face:side', 'face:top']);
        const indices = (role: string): number[] => (roles?.[role] ?? []).map((s) => s.index);
        for (const [role, normal] of [
          ['face:bottom', [0, 0, -1]],
          ['face:top', [0, 0, 1]],
        ] satisfies [string, Vec3][]) {
          expect(indices(role), role).toHaveLength(1);
          const face = topology.faces[indices(role)[0] ?? -1];
          expect(face?.surface, role).toBe('plane');
          expectVecClose(face?.plane?.normal ?? [0, 0, 0], normal, NORMAL_TOLERANCE, role);
        }
        expect(indices('face:side').length).toBeGreaterThan(0);
        const all = [...indices('face:bottom'), ...indices('face:top'), ...indices('face:side')];
        expect(new Set(all).size).toBe(all.length);
        for (const subs of Object.values(roles ?? {})) {
          expect(subs.every((s) => s.type === 'face')).toBe(true);
          expectAscendingIn(
            subs.map((s) => s.index),
            topology.faces.length,
            'role',
          );
        }
      });

      it('an extrude: face:start against the direction and face:end along it', async () => {
        const profile = (await kernel.makeFace(SQUARE_10)).shape;
        const { shape, roles } = await kernel.extrude(profile, [0, 0, 1], 5);
        const topology = await kernel.topology(shape);
        for (const [role, normal] of [
          ['face:start', [0, 0, -1]],
          ['face:end', [0, 0, 1]],
        ] satisfies [string, Vec3][]) {
          const subs = roles?.[role] ?? [];
          expect(subs, role).toHaveLength(1);
          const plane = topology.faces[subs[0]?.index ?? -1]?.plane;
          expectVecClose(plane?.normal ?? [0, 0, 0], normal, NORMAL_TOLERANCE, role);
        }
      });

      it('transform, boolean, fillet and chamfer return no roles', async () => {
        const a = await aBox();
        const b = (await kernel.makeBox(OVERLAPPING)).shape;
        const results = [
          await kernel.transform(a, mat4.translation([1, 0, 0])),
          await kernel.boolean('union', [a], [b]),
          await kernel.fillet(a, [0], 0.5),
          await kernel.chamfer(a, [0], 0.5),
        ];
        for (const r of results) expect(r.roles).toBeUndefined();
      });
    });

    describe('history (M14)', () => {
      /** Topologies of the inputs and the output, then the completeness check of spec 06. */
      async function expectComplete(
        result: ShapeResult,
        inputs: readonly ShapeHandle[],
        what: string,
      ): Promise<void> {
        const history = result.history;
        if (history === undefined) return expect.fail(`${what}: no history`);
        const inputTopologies = await Promise.all(inputs.map((h) => kernel.topology(h)));
        const output = await kernel.topology(result.shape);
        expectCompleteHistory(history, inputTopologies, output, what);
      }

      it('primitives and makeFace return no history', async () => {
        expect((await kernel.makeBox(BOX)).history).toBeUndefined();
        expect((await kernel.makeCylinder(CYLINDER)).history).toBeUndefined();
        expect((await kernel.makeFace(FACE)).history).toBeUndefined();
      });

      it('transform: every face of the input exactly once, in range, ordered', async () => {
        const a = await aBox();
        const moved = await kernel.transform(a, mat4.rotationAxisAngle([0, 0, 1], TURN / 8));
        await expectComplete(moved, [a], 'transform');
      });

      it.each(HISTORY_BOOLEAN_OPS)(
        'boolean %s: every face of every input exactly once',
        async (op) => {
          const a = await aBox();
          const b = (await kernel.makeBox(OVERLAPPING)).shape;
          await expectComplete(await kernel.boolean(op, [a], [b]), [a, b], `boolean ${op}`);
        },
      );

      it('extrude: every face of the profile exactly once', async () => {
        const profile = (await kernel.makeFace(SQUARE_10)).shape;
        await expectComplete(await kernel.extrude(profile, [0, 0, 1], 5), [profile], 'extrude');
      });

      it.each([
        ['2π', TURN],
        ['π/2', TURN / 4],
      ])('revolve by %s: every face of the profile exactly once', async (_, angle) => {
        const profile = (await kernel.makeFace(RING_PROFILE)).shape;
        await expectComplete(await kernel.revolve(profile, Z_AXIS, angle), [profile], 'revolve');
      });

      it.each(['fillet', 'chamfer'] as const)(
        '%s: every face of the input exactly once',
        async (op) => {
          const a = await aBox();
          await expectComplete(await kernel[op](a, [0], 0.5), [a], op);
        },
      );
    });

    describe.each(['fillet', 'chamfer'] as const)('%s (M14)', (op) => {
      it('of one box edge: a new handle, the bounding box of the box, the input stays valid', async () => {
        const a = await aBox();
        const { shape } = await kernel[op](a, [0], 0.5);
        expect(shape).not.toBe(a);
        expect(await kernel.liveHandleCount()).toBe(2);
        expectBoxClose(await kernel.boundingBox(shape), ORIGIN, BOX_MAX, op);
        expectEnclosesBox(await kernel.boundingBox(a), ORIGIN, BOX_MAX, 'input');
        expect(validateMeshData(await kernel.tessellate(shape, QUALITY))).toEqual([]);
      });

      it.each([
        ['no edges', [], 0.5],
        ['a duplicate edge', [0, 0], 0.5],
        ['an edge index out of range', [12], 0.5],
        ['a negative edge index', [-1], 0.5],
        ['a non-integer edge index', [0.5], 0.5],
        ['a NaN edge index', [Number.NaN], 0.5],
        ['a size of 0', [0], 0],
        ['a negative size', [0], -1],
        ['a NaN size', [0], Number.NaN],
        ['an infinite size', [0], INF],
      ] satisfies [string, number[], number][])(
        '%s rejects with invalid-input and creates no handle',
        async (_, edges, size) => {
          const a = await aBox();
          expect(await rejectionCode(() => kernel[op](a, edges, size))).toBe('invalid-input');
          expect(await kernel.liveHandleCount()).toBe(1);
        },
      );

      it.each(NEVER_ISSUED)('handle %s, never issued, rejects with unknown-handle', async (h) => {
        await aBox();
        expect(await rejectionCode(() => kernel[op](h, [0], 0.5))).toBe('unknown-handle');
        expect(await kernel.liveHandleCount()).toBe(1);
      });

      it('changing the edge list right after the call, before await, does not change the call', async () => {
        const a = await aBox();
        const edges = [0];
        const created = callWithoutThrow(() => kernel[op](a, edges, 0.5));
        edges[0] = 99;
        edges.push(0);
        const { shape } = await created;
        expectBoxClose(await kernel.boundingBox(shape), ORIGIN, BOX_MAX, op);
      });

      it('a failed read of the edge list rejects with internal, not synchronously', async () => {
        const a = await aBox();
        // Input outside the types; the cast through unknown breaks the types on purpose.
        const edges = null as unknown as readonly number[];
        expect(await rejectionCode(() => kernel[op](a, edges, 0.5))).toBe('internal');
        expect(await kernel.liveHandleCount()).toBe(1);
      });
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

      it('changing makeCylinder inputs right after the call, before await, does not change the shape', async () => {
        const base: Vec3 = [...ORIGIN];
        const axis: Vec3 = [0, 0, 2];
        const created = callWithoutThrow(() =>
          kernel.makeCylinder({ base, axis, radius: 2, height: 4 }),
        );
        // The inputs are readonly tuples; the test writes into them on purpose.
        Reflect.set(base, 0, 100);
        Reflect.set(axis, 0, 5);
        const { shape } = await created;
        expectBoxClose(await kernel.boundingBox(shape), CYLINDER_MIN, CYLINDER_MAX);
      });

      it('changing the transform matrix right after the call, before await, does not change the result', async () => {
        const a = await aBox();
        const m: [...Mat4] = [...mat4.translation([10, 0, 0])];
        const moved = callWithoutThrow(() => kernel.transform(a, m));
        m[12] = 100;
        const { shape } = await moved;
        expectBoxClose(await kernel.boundingBox(shape), [11, -2, 3], [13, 1, 7]);
      });

      it('changing the boolean lists right after the call, before await, does not change the result', async () => {
        const a = await aBox();
        const b = (await kernel.makeBox(OVERLAPPING)).shape;
        const c = (await kernel.makeBox(SEPARATE)).shape;
        const targets = [a];
        const tools = [b];
        const united = callWithoutThrow(() => kernel.boolean('union', targets, tools));
        targets[0] = c;
        tools.push(c);
        const { shape } = await united;
        expectBoxClose(await kernel.boundingBox(shape), ORIGIN, [4, 2, 9]);
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
        [
          'makeCylinder(null)',
          (k: GeometryKernel) => k.makeCylinder(null as unknown as typeof CYLINDER),
        ],
        [
          'transform(handle, null)',
          (k: GeometryKernel) => k.transform(UNKNOWN, null as unknown as Mat4),
        ],
        [
          'boolean(union, null, [handle])',
          (k: GeometryKernel) =>
            k.boolean('union', null as unknown as readonly ShapeHandle[], [UNKNOWN]),
        ],
        [
          'extrude(handle, null, 5)',
          (k: GeometryKernel) => k.extrude(UNKNOWN, null as unknown as Vec3, 5),
        ],
        [
          'revolve(handle, null, 2π)',
          (k: GeometryKernel) => k.revolve(UNKNOWN, null as unknown as Axis, TURN),
        ],
      ])(
        '%s: a failed read of the input rejects with internal, not synchronously',
        async (_, call) => {
          const a = await aBox();
          expect(await rejectionCode(() => call(kernel))).toBe('internal');
          expect(await kernel.liveHandleCount()).toBe(1);
          expectEnclosesBox(await kernel.boundingBox(a), ORIGIN, BOX_MAX);
        },
      );

      it('changing makeFace inputs right after the call, before await, does not change the face', async () => {
        const origin: Vec3 = [0, 0, 0];
        const corner: Vec2 = [4, 2];
        const outer: ProfileCurve[] = [
          line([1, 2], corner),
          line(corner, [4, 5]),
          line([4, 5], [1, 5]),
          line([1, 5], [1, 2]),
        ];
        const holes: ProfileLoop[] = [];
        const created = callWithoutThrow(() =>
          kernel.makeFace({ plane: { ...PLANE_XY, origin }, outer, holes }),
        );
        // The inputs are readonly; the test writes into them on purpose.
        Reflect.set(origin, 2, 100);
        Reflect.set(corner, 0, 40);
        outer.push(line([1, 2], [1, 2]));
        holes.push([]);
        const { shape } = await created;
        expectBoxClose(await kernel.boundingBox(shape), [1, 2, 0], [4, 5, 0], 'face');
      });

      it('changing the extrude direction right after the call, before await, does not change the prism', async () => {
        const profile = (await kernel.makeFace(SQUARE_10)).shape;
        const direction: Vec3 = [0, 0, 1];
        const created = callWithoutThrow(() => kernel.extrude(profile, direction, 5));
        // The input is a readonly tuple; the test writes into it on purpose.
        Reflect.set(direction, 2, -1);
        const { shape } = await created;
        expectBoxClose(await kernel.boundingBox(shape), [0, 0, 0], [10, 10, 5], 'prism');
      });

      it('changing the revolve axis right after the call, before await, does not change the result', async () => {
        const profile = (await kernel.makeFace(RING_PROFILE)).shape;
        const origin: Vec3 = [0, 0, 0];
        const direction: Vec3 = [0, 0, 1];
        const created = callWithoutThrow(() =>
          kernel.revolve(profile, { origin, direction }, TURN / 4),
        );
        // The inputs are readonly tuples; the test writes into them on purpose.
        Reflect.set(direction, 2, -1);
        Reflect.set(origin, 0, 3);
        const { shape } = await created;
        expectBoxClose(await kernel.boundingBox(shape), [0, 0, 0], [10, 10, 10], 'revolved');
      });

      it('makeFace(null) rejects instead of throwing and creates no handle', async () => {
        // Input outside the types; the cast through unknown breaks the types on purpose.
        const code = await rejectionCode(() => kernel.makeFace(null as unknown as FaceParams));
        expect(code).toBe('invalid-input');
        expect(await kernel.liveHandleCount()).toBe(0);
      });

      it('the bounding box shares no array with the makeBox input', async () => {
        const a = (await kernel.makeBox(BOX)).shape;
        const box = await kernel.boundingBox(a);
        expect(box.min).not.toBe(ORIGIN);
      });
    });
  });
}
