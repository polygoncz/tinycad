// Test-only entry point of kernel: the GeometryKernel contract suite and the FakeKernel.
// dependency-cruiser allows importing it only from *.test.ts.
//
// The suite knows only the GeometryKernel interface, kernelErrorCode and validateMeshData: it
// runs for the FakeKernel (M5) and for the OCCT kernel (M7). So it assumes nothing outside the
// contract of spec 06 – no face order, no vertex counts, no exact float values. Errors are
// checked with kernelErrorCode, never instanceof, because over core/rpc a kernel error arrives
// as an RpcError carrying the same code.

import { beforeEach, describe, expect, it } from 'vitest';
import { bspline, mat4, type Mat4, type Plane, type Vec2, type Vec3 } from '@/core';
import { kernelErrorCode } from './errors';
import type { KernelErrorCode } from './errors';
import type { Axis, BooleanOp, GeometryKernel } from './kernel';
import type {
  CurveIntersection,
  FilletArc,
  OffsetCurve,
  ProfileCurve,
  ProfileLoop,
  ProfileRegions,
} from './profile';
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
/**
 * M29: rectangle [0, 4]×[0, 3] whose right side is a quadratic spline over (6, 1.5): it bulges
 * to x = 5 at its middle, so the bounding box is [0, 0]..[5, 3].
 */
const SPLINE_LOOP: ProfileLoop = [
  line([0, 0], [4, 0]),
  {
    kind: 'bspline',
    degree: 2,
    poles: [
      [4, 0],
      [6, 1.5],
      [4, 3],
    ],
    knots: [0, 0, 0, 1, 1, 1],
  },
  line([4, 3], [0, 3]),
  line([0, 3], [0, 0]),
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
/**
 * The bytes of a STEP file as text, one character per byte: enough to check the ASCII frame
 * (spec 06, exportStep). Without TextDecoder, which the domain build has no type for.
 */
function stepText(bytes: Uint8Array): string {
  let text = '';
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    text += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return text;
}

/** Spec 06: the text, trimmed, starts with ISO-10303-21; and ends with END-ISO-10303-21;. */
function expectStepFrame(bytes: Uint8Array): void {
  expect(bytes).toBeInstanceOf(Uint8Array);
  expect(bytes.length).toBeGreaterThan(0);
  const text = stepText(bytes).trim();
  expect(text.startsWith('ISO-10303-21;'), 'starts with ISO-10303-21;').toBe(true);
  expect(text.endsWith('END-ISO-10303-21;'), 'ends with END-ISO-10303-21;').toBe(true);
}

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
        [
          'curveIntersections',
          (k: GeometryKernel) => k.curveIntersections({ curves: [line([0, 0], [1, 0])] }),
        ],
        [
          'curveSegment',
          (k: GeometryKernel) => k.curveSegment({ curve: line([0, 0], [1, 0]), from: 1, to: 0 }),
        ],
        [
          'filletArc',
          (k: GeometryKernel) =>
            k.filletArc({
              a: line([0, 0], [1, 0]),
              b: line([0, 0], [0, 1]),
              radius: 0,
              near: [0, 0],
            }),
        ],
        [
          'offsetCurves',
          (k: GeometryKernel) =>
            k.offsetCurves({ curves: [seg('p', [0, 0], [1, 0])], closed: false, distance: 0 }),
        ],
        ['extrude', (k: GeometryKernel) => k.extrude(UNKNOWN, [0, 0, 1], 5)],
        ['revolve', (k: GeometryKernel) => k.revolve(UNKNOWN, Z_AXIS, TURN)],
        ['fillet', (k: GeometryKernel) => k.fillet(UNKNOWN, [0], 1)],
        ['chamfer', (k: GeometryKernel) => k.chamfer(UNKNOWN, [0], 1)],
        ['topology', (k: GeometryKernel) => k.topology(UNKNOWN)],
        ['exportStep', (k: GeometryKernel) => k.exportStep([])],
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
          kernel.curveIntersections({ curves: [] }),
          kernel.curveSegment({ curve: line([0, 0], [1, 0]), from: 0, to: 1 }),
          kernel.filletArc({
            a: line([0, 0], [1, 0]),
            b: line([0, 0], [0, 1]),
            radius: 0.1,
            near: [0.1, 0.1],
          }),
          kernel.offsetCurves({ curves: [seg('p', [0, 0], [1, 0])], closed: false, distance: 1 }),
          kernel.extrude(profile, [0, 0, 1], 5),
          kernel.revolve(profile, Z_AXIS, TURN),
          kernel.fillet(shape, [0], 0.5),
          kernel.chamfer(shape, [0], 0.5),
          kernel.topology(shape),
          kernel.exportStep([shape]),
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
        [
          'a rectangle with a spline side (M29)',
          { plane: PLANE_XY, outer: SPLINE_LOOP, holes: [] },
          [0, 0, 0],
          [5, 3, 0],
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
        [
          'a spline with too few knots (M29)',
          {
            ...FACE,
            outer: SPLINE_LOOP.map((c) =>
              c.kind === 'bspline' ? { ...c, knots: c.knots.slice(1) } : c,
            ),
          },
        ],
      ] satisfies [string, FaceParams][])(
        '%s rejects with invalid-input and creates no handle',
        async (_, p) => {
          expect(await rejectionCode(() => kernel.makeFace(p))).toBe('invalid-input');
          expect(await kernel.liveHandleCount()).toBe(0);
        },
      );
    });

    describe('profileRegions (M30)', () => {
      describeProfileRegions(() => kernel);
    });

    describe('curveIntersections (M33)', () => {
      describeCurveIntersections(() => kernel);
    });

    describe('curveSegment (M33)', () => {
      describeCurveSegment(() => kernel);
    });

    describe('filletArc (M34)', () => {
      describeFilletArc(() => kernel);
    });

    describe('offsetCurves (M35)', () => {
      describeOffsetCurves(() => kernel);
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

    describe('exportStep (M15)', () => {
      it('a box: a STEP text from ISO-10303-21; to END-ISO-10303-21;', async () => {
        const a = await aBox();
        expectStepFrame(await kernel.exportStep([a]));
      });

      it('two boxes in one file', async () => {
        const a = await aBox();
        const b = (await kernel.makeBox(SEPARATE)).shape;
        expectStepFrame(await kernel.exportStep([a, b]));
      });

      it('the result is a whole buffer of its own, new on every call', async () => {
        const a = await aBox();
        const first = await kernel.exportStep([a]);
        const second = await kernel.exportStep([a]);
        for (const bytes of [first, second]) {
          expect(bytes.byteOffset).toBe(0);
          expect(bytes.byteLength).toBe(bytes.buffer.byteLength);
        }
        expect(second.buffer).not.toBe(first.buffer);
      });

      it('the inputs stay valid and no handle is created', async () => {
        const a = await aBox();
        const b = (await kernel.makeBox(SEPARATE)).shape;
        await kernel.exportStep([a, b]);
        expect(await kernel.liveHandleCount()).toBe(2);
        expectEnclosesBox(await kernel.boundingBox(a), ORIGIN, BOX_MAX);
        await kernel.boundingBox(b);
      });

      it('an empty list rejects with invalid-input', async () => {
        await aBox();
        expect(await rejectionCode(() => kernel.exportStep([]))).toBe('invalid-input');
        expect(await kernel.liveHandleCount()).toBe(1);
      });

      it('the same handle twice rejects with invalid-input', async () => {
        const a = await aBox();
        const b = (await kernel.makeBox(SEPARATE)).shape;
        expect(await rejectionCode(() => kernel.exportStep([a, b, a]))).toBe('invalid-input');
        expect(await kernel.liveHandleCount()).toBe(2);
      });

      it.each(NEVER_ISSUED)('handle %s, never issued, rejects with unknown-handle', async (h) => {
        const a = await aBox();
        expect(await rejectionCode(() => kernel.exportStep([a, h]))).toBe('unknown-handle');
        expect(await kernel.liveHandleCount()).toBe(1);
        await kernel.boundingBox(a);
      });

      it('a released handle rejects with unknown-handle', async () => {
        const a = await aBox();
        const b = await aBox();
        await kernel.release([a]);
        expect(await rejectionCode(() => kernel.exportStep([b, a]))).toBe('unknown-handle');
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

      it('changing the exportStep list right after the call, before await, does not change the call', async () => {
        const a = await aBox();
        const list = [a];
        const exported = callWithoutThrow(() => kernel.exportStep(list));
        // A duplicate or an unknown handle added now would make the call reject.
        list.push(a, UNKNOWN);
        expectStepFrame(await exported);
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
          'exportStep(null)',
          (k: GeometryKernel) => k.exportStep(null as unknown as readonly ShapeHandle[]),
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

// --- profileRegions (M30) ------------------------------------------------------------------
// The cases of the sketcher's region tests of M12–M29 (sketch/regions.test.ts), with the input
// as regionCurves gives it: the non-construction curves of a sketch, each with its entity id.
// Compared as spec 06 says: name, crossing, the number and names of holes exactly, the area
// relatively (REGION_AREA_TOLERANCE, splines SPLINE_AREA_TOLERANCE) and the points of the loops
// within POINT_TOLERANCE · max(1, |coordinate|). The start of a loop is not part of the contract,
// so curves are found by their id.

/** Spec 06: the area of a region agrees relatively within this… */
const REGION_AREA_TOLERANCE = 1e-6;
/** …and within this when a spline bounds it (FakeKernel tessellates splines, spec 06). */
const SPLINE_AREA_TOLERANCE = 1e-3;
/** Spec 06: a point of a loop agrees within this · max(1, |coordinate|). */
const LOOP_POINT_TOLERANCE = 1e-7;

type RegionsParams = Parameters<GeometryKernel['profileRegions']>[0];
type Spline = Extract<ProfileCurve, { kind: 'bspline' }>;

const seg = (id: string, from: Vec2, to: Vec2): ProfileCurve => ({ kind: 'line', from, to, id });
const ccwArc = (id: string, center: Vec2, from: Vec2, to: Vec2): ProfileCurve => ({
  kind: 'arc',
  center,
  from,
  to,
  ccw: true,
  id,
});
const ring = (id: string, center: Vec2, radius: number): ProfileCurve => ({
  kind: 'circle',
  center,
  radius,
  id,
});
const spline = (id: string, poles: readonly Vec2[], degree = 3): Spline => ({
  kind: 'bspline',
  degree,
  poles,
  knots: clampedKnots(poles.length, degree),
  id,
});

/** A clamped knot vector with uniform inner knots for `count` poles. */
function clampedKnots(count: number, degree: number): number[] {
  const inner = count - degree - 1;
  return [
    ...Array<number>(degree + 1).fill(0),
    ...Array.from({ length: inner }, (_, i) => (i + 1) / (inner + 1)),
    ...Array<number>(degree + 1).fill(1),
  ];
}

/**
 * A counter-clockwise rectangle with corners a b c d from (x, y), lines ab bc cd da with the id
 * prefix (rectangleData of sketch/testing.ts).
 */
function rectangle(prefix = '', x = 0, y = 0, width = 10, height = 5): ProfileCurve[] {
  const a: Vec2 = [x, y];
  const b: Vec2 = [x + width, y];
  const c: Vec2 = [x + width, y + height];
  const d: Vec2 = [x, y + height];
  return [
    seg(`${prefix}ab`, a, b),
    seg(`${prefix}bc`, b, c),
    seg(`${prefix}cd`, c, d),
    seg(`${prefix}da`, d, a),
  ];
}

/** Rectangle 10 × 5: a (0, 0), b (10, 0), c (10, 5), d (0, 5). */
const RECT = rectangle();
/** Triangle p (2, 1), q (4, 1), r (4, 3) inside RECT. */
const TRIANGLE = [seg('pq', [2, 1], [4, 1]), seg('qr', [4, 1], [4, 3]), seg('rp', [4, 3], [2, 1])];
/** Slot of lines l1 l2 and tangent arcs a1 a2 around [0, 10]×[0, 10]. */
const SLOT = [
  seg('l1', [0, 0], [10, 0]),
  ccwArc('a1', [10, 5], [10, 0], [10, 10]),
  seg('l2', [10, 10], [0, 10]),
  ccwArc('a2', [0, 5], [0, 10], [0, 0]),
];
/** The right side of SPLINE_RECT: a cubic spline from b (10, 0) to c (10, 5) bulging to x = 13. */
const SPLINE_BC = spline('bc', [
  [10, 0],
  [13, 1],
  [13, 4],
  [10, 5],
]);
/** Rectangle 10 × 5 whose right side bc is a cubic spline. */
const SPLINE_RECT = [
  seg('ab', [0, 0], [10, 0]),
  SPLINE_BC,
  seg('cd', [10, 5], [0, 5]),
  seg('da', [0, 5], [0, 0]),
];
/** A closed cubic spline around the square [0, 10]², from (0, 0) back to (0, 0). */
const closedSpline = (poles: readonly Vec2[], knots = [0, 0, 0, 0, 0.5, 1, 1, 1, 1]): Spline => ({
  kind: 'bspline',
  degree: 3,
  poles,
  knots,
  id: 'sp',
});
const SQUARE_POLES: readonly Vec2[] = [
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10],
  [0, 0],
];

function startPoint(c: ProfileCurve): Vec2 | undefined {
  if (c.kind === 'circle') return undefined;
  return c.kind === 'bspline' ? c.poles[0] : c.from;
}

function endPoint(c: ProfileCurve): Vec2 | undefined {
  if (c.kind === 'circle') return undefined;
  return c.kind === 'bspline' ? c.poles[c.poles.length - 1] : c.to;
}

function nearCoordinate(a: number, b: number): boolean {
  return Math.abs(a - b) <= LOOP_POINT_TOLERANCE * Math.max(1, Math.abs(a), Math.abs(b));
}

function expectPoint2Close(
  actual: Vec2 | undefined,
  expected: Vec2 | undefined,
  what: string,
): void {
  const ok =
    actual !== undefined &&
    expected !== undefined &&
    nearCoordinate(actual[0], expected[0]) &&
    nearCoordinate(actual[1], expected[1]);
  if (!ok) {
    expect.fail(`${what}: ${JSON.stringify(actual)} differs from ${JSON.stringify(expected)}`);
  }
}

function expectNumbersClose(
  actual: readonly number[],
  expected: readonly number[],
  what: string,
): void {
  expect(actual.length, `${what}: count`).toBe(expected.length);
  expected.forEach((e, i) => {
    const a = actual[i] ?? Number.NaN;
    if (!nearCoordinate(a, e))
      expect.fail(`${what}[${String(i)}]: ${String(a)} differs from ${String(e)}`);
  });
}

/** The same curve within the contract tolerance: kind, id, orientation and every point. */
function expectCurveClose(actual: ProfileCurve | undefined, expected: ProfileCurve): void {
  const what = `curve ${expected.id ?? '?'}`;
  expect(actual?.kind, `${what}: kind`).toBe(expected.kind);
  expect(actual?.id, `${what}: id`).toBe(expected.id);
  if (actual === undefined) return;
  if (expected.kind === 'circle' && actual.kind === 'circle') {
    expectPoint2Close(actual.center, expected.center, `${what}: center`);
    expectNumbersClose([actual.radius], [expected.radius], `${what}: radius`);
  } else if (expected.kind === 'line' && actual.kind === 'line') {
    expectPoint2Close(actual.from, expected.from, `${what}: from`);
    expectPoint2Close(actual.to, expected.to, `${what}: to`);
  } else if (expected.kind === 'arc' && actual.kind === 'arc') {
    expect(actual.ccw, `${what}: ccw`).toBe(expected.ccw);
    expectPoint2Close(actual.center, expected.center, `${what}: center`);
    expectPoint2Close(actual.from, expected.from, `${what}: from`);
    expectPoint2Close(actual.to, expected.to, `${what}: to`);
  } else if (expected.kind === 'bspline' && actual.kind === 'bspline') {
    expect(actual.degree, `${what}: degree`).toBe(expected.degree);
    expect(actual.poles.length, `${what}: pole count`).toBe(expected.poles.length);
    expected.poles.forEach((p, i) => {
      expectPoint2Close(actual.poles[i], p, `${what}: pole ${String(i)}`);
    });
    expectNumbersClose(actual.knots, expected.knots, `${what}: knots`);
  }
}

/** The loop has exactly the expected curves (found by id, in any order and from any start). */
function expectLoopCurves(loop: ProfileLoop | undefined, expected: readonly ProfileCurve[]): void {
  expect(idsOf(loop ?? []).sort(compareText)).toEqual(idsOf(expected).sort(compareText));
  for (const e of expected)
    expectCurveClose(
      loop?.find((c) => c.id === e.id),
      e,
    );
}

function idsOf(loop: ProfileLoop): string[] {
  return loop.map((c) => c.id ?? '');
}

/** Plain string comparison by UTF-16 code units, as spec 12 sorts names. */
function compareText(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** Every curve ends where the next one starts (a lone circle is closed by itself). */
function expectLoopClosed(loop: ProfileLoop): void {
  if (loop.length === 1 && loop[0]?.kind === 'circle') return;
  expect(loop.length).toBeGreaterThan(0);
  loop.forEach((c, i) => {
    const next = loop[(i + 1) % loop.length];
    expectPoint2Close(
      endPoint(c),
      next === undefined ? undefined : startPoint(next),
      `end of ${String(i)}`,
    );
  });
}

/**
 * Signed area of a closed loop: shoelace plus circular segments of arcs, a spline by a fine
 * tessellation (1e-6), a circle +πr² (a lone circle has no orientation).
 */
function loopArea(loop: ProfileLoop): number {
  let sum = 0;
  for (const c of loop) {
    if (c.kind === 'circle') return Math.PI * c.radius ** 2;
    const points = c.kind === 'bspline' ? bspline.tessellate(c, 1e-6) : [c.from, c.to];
    for (let i = 1; i < points.length; i++) {
      const p = points[i - 1] ?? [0, 0];
      const q = points[i] ?? [0, 0];
      sum += (p[0] * q[1] - q[0] * p[1]) / 2;
    }
    if (c.kind === 'arc') {
      const r = Math.hypot(c.from[0] - c.center[0], c.from[1] - c.center[1]);
      const a0 = Math.atan2(c.from[1] - c.center[1], c.from[0] - c.center[0]);
      const a1 = Math.atan2(c.to[1] - c.center[1], c.to[0] - c.center[0]);
      const turn = (x: number) => ((x % TURN) + TURN) % TURN;
      const sweep = c.ccw ? turn(a1 - a0) : turn(a0 - a1);
      const segment = (r * r * (sweep - Math.sin(sweep))) / 2;
      sum += c.ccw ? segment : -segment;
    }
  }
  return sum;
}

/** What a region is compared by (spec 06): name, hole names and area. */
interface ExpectedRegion {
  readonly name: string;
  /** Names of the holes (their curve ids sorted, joined by ','), in any order. */
  readonly holes?: readonly string[];
  readonly area: number;
  /** Relative tolerance of the area; REGION_AREA_TOLERANCE when absent. */
  readonly areaTolerance?: number;
}

function holeName(loop: ProfileLoop): string {
  return [...new Set(idsOf(loop))].sort(compareText).join(',');
}

function expectAreaClose(
  actual: number | undefined,
  expected: number,
  tolerance: number,
  what: string,
): void {
  const a = actual ?? Number.NaN;
  if (!(Math.abs(a - expected) <= tolerance * Math.abs(expected))) {
    expect.fail(
      `${what}: area ${String(a)} differs from ${String(expected)} by more than ${String(tolerance)} relatively`,
    );
  }
}

/**
 * The regions are exactly the expected ones in this order, without a crossing; every outer loop
 * is closed and counter-clockwise, every hole closed and clockwise (a circle has no orientation).
 */
function expectRegions(actual: ProfileRegions, expected: readonly ExpectedRegion[]): void {
  expect(actual.crossing).toBe(false);
  expect(actual.regions.map((r) => r.name)).toEqual(expected.map((r) => r.name));
  actual.regions.forEach((r, i) => {
    const e = expected[i];
    if (e === undefined) return;
    expect(r.holes.map(holeName).sort(compareText), `holes of ${r.name}`).toEqual(
      [...(e.holes ?? [])].sort(compareText),
    );
    expectAreaClose(r.area, e.area, e.areaTolerance ?? REGION_AREA_TOLERANCE, r.name);
    expectLoopClosed(r.outer);
    expect(loopArea(r.outer), `outer of ${r.name} counter-clockwise`).toBeGreaterThan(0);
    for (const hole of r.holes) {
      expectLoopClosed(hole);
      if (hole.length > 1 || hole[0]?.kind !== 'circle') {
        expect(loopArea(hole), `hole ${holeName(hole)} clockwise`).toBeLessThan(0);
      }
    }
  });
}

/** Area of a closed polygon of points and splines, the splines finely tessellated. */
function areaWith(...parts: readonly (Vec2 | Spline)[]): number {
  const points = parts.flatMap((p) =>
    'kind' in p ? bspline.tessellate(p, 1e-6).slice(0, -1) : [p],
  );
  let sum = 0;
  points.forEach((p, i) => {
    const q = points[(i + 1) % points.length] ?? p;
    sum += p[0] * q[1] - q[0] * p[1];
  });
  return sum / 2;
}

const NO_REGIONS: ProfileRegions = { regions: [], crossing: false };
const CROSSING: ProfileRegions = { regions: [], crossing: true };

function describeProfileRegions(kernelOf: () => GeometryKernel): void {
  const regionsOf = (curves: readonly ProfileCurve[]): Promise<ProfileRegions> =>
    callWithoutThrow(() => kernelOf().profileRegions({ curves }));
  const namesOf = async (curves: readonly ProfileCurve[]): Promise<string[]> =>
    (await regionsOf(curves)).regions.map((r) => r.name);

  describe('regions (spec 12 Oblasti)', () => {
    it('a rectangle is one counter-clockwise region named after its four lines', async () => {
      const result = await regionsOf(RECT);
      expectRegions(result, [{ name: 'ab,bc,cd,da', area: 50 }]);
      const [r] = result.regions;
      expect(r?.outer).toHaveLength(4);
      expectLoopCurves(r?.outer, RECT);
    });

    it('two rectangles sharing an edge are two regions', async () => {
      const curves = [
        ...RECT,
        seg('be', [10, 0], [20, 0]),
        seg('ef', [20, 0], [20, 5]),
        seg('fc', [20, 5], [10, 5]),
      ];
      expectRegions(await regionsOf(curves), [
        { name: 'ab,bc,cd,da', area: 50 },
        { name: 'bc,be,ef,fc', area: 50 },
      ]);
    });

    it('a circle inside a rectangle is a hole and a region of its own', async () => {
      const k = ring('k', [5, 2.5], 2);
      const { regions } = await regionsOf([...RECT, k]);
      expectRegions({ regions, crossing: false }, [
        { name: 'ab,bc,cd,da,k', holes: ['k'], area: 50 - 4 * Math.PI },
        { name: 'k', area: 4 * Math.PI },
      ]);
      const [outer, disc] = regions;
      expectLoopCurves(outer?.holes[0], [k]);
      expectLoopCurves(disc?.outer, [k]);
    });

    it('a polygon hole is clockwise', async () => {
      const { regions } = await regionsOf([...RECT, ...TRIANGLE]);
      expectRegions({ regions, crossing: false }, [
        { name: 'ab,bc,cd,da,pq,qr,rp', holes: ['pq,qr,rp'], area: 48 },
        { name: 'pq,qr,rp', area: 2 },
      ]);
      expect(loopArea(regions[0]?.holes[0] ?? [])).toBeCloseTo(-2, 9);
    });

    it('circle in circle in circle: each ring has the next circle as its hole', async () => {
      const curves = [ring('k1', [1, 1], 10), ring('k2', [1, 1], 5), ring('k3', [1, 1], 2)];
      expectRegions(await regionsOf(curves), [
        { name: 'k1,k2', holes: ['k2'], area: 75 * Math.PI },
        { name: 'k2,k3', holes: ['k3'], area: 21 * Math.PI },
        { name: 'k3', area: 4 * Math.PI },
      ]);
    });

    it('a slot of lines and tangent arcs is one region', async () => {
      const result = await regionsOf(SLOT);
      expectRegions(result, [{ name: 'a1,a2,l1,l2', area: 100 + 25 * Math.PI }]);
      expectLoopCurves(result.regions[0]?.outer, SLOT);
    });

    it('orders a line and a tangent arc leaving a node in the same direction by curvature', async () => {
      // At a, line ab and arc q both leave along +x; q turns left, so it is further
      // counter-clockwise. The upper region is triangle a b c minus the arc's circular segment;
      // triangle a e b below makes a the third edge's node, so the order matters.
      const curves = [
        seg('ab', [0, 0], [10, 0]),
        seg('bc', [10, 0], [5, 5]),
        ccwArc('q', [0, 5], [0, 0], [5, 5]),
        seg('ae', [0, 0], [0, -5]),
        seg('eb', [0, -5], [10, 0]),
      ];
      const result = await regionsOf(curves);
      expectRegions(result, [
        { name: 'ab,ae,eb', area: 25 },
        { name: 'ab,bc,q', area: 25 - 12.5 * (Math.PI / 2 - 1) },
      ]);
      // Traversed counter-clockwise, the arc runs backwards (clockwise).
      expectCurveClose(
        result.regions[1]?.outer.find((c) => c.id === 'q'),
        { kind: 'arc', center: [0, 5], from: [5, 5], to: [0, 0], ccw: false, id: 'q' },
      );
    });

    it('an open polyline bounds nothing', async () => {
      const curves = [seg('ab', [0, 0], [10, 0]), seg('bc', [10, 0], [10, 5])];
      expect(await regionsOf(curves)).toEqual(NO_REGIONS);
    });

    it('no curves: no regions', async () => {
      expect(await regionsOf([])).toEqual(NO_REGIONS);
    });

    it('prunes a dangling tail', async () => {
      const curves = [...RECT, seg('t', [10, 5], [15, 8]), seg('u', [15, 8], [20, 8])];
      expectRegions(await regionsOf(curves), [{ name: 'ab,bc,cd,da', area: 50 }]);
    });

    it.each([
      ['crossing lines', [seg('pq', [0, 0], [10, 10]), seg('rs', [0, 10], [10, 0])]],
      ['a line across a rectangle', [...RECT, seg('pq', [-5, 2], [15, 2])]],
      ['an end touching the inside of a line', [...RECT, seg('pq', [5, 0], [5, -5])]],
      ['overlapping collinear lines', [...RECT, seg('pq', [2, 0], [6, 0])]],
      ['a circle through a rectangle edge', [...RECT, ring('k', [10, 2.5], 1)]],
      ['a circle touching a rectangle edge', [...RECT, ring('k', [5, 4], 1)]],
      ['two overlapping circles', [ring('k1', [0, 0], 2), ring('k2', [1, 0], 2)]],
      ['equal concentric circles', [ring('k1', [0, 0], 2), ring('k2', [0, 0], 2)]],
    ])('%s cross: no regions', async (_name, curves) => {
      expect(await regionsOf(curves)).toEqual(CROSSING);
    });

    it('curves whose ends lie at the same coordinates share a node', async () => {
      // In the sketch: separate points joined by coincident (regionCurves gives their coordinates).
      const curves = [
        seg('ab', [0, 0], [10, 0]),
        seg('bc', [10, 0], [10, 5]),
        seg('ca', [10, 5], [0, 0]),
      ];
      expectRegions(await regionsOf(curves), [{ name: 'ab,bc,ca', area: 25 }]);
    });

    it('keeps the name when coordinates, curve order and orientation change', async () => {
      const a: Vec2 = [3, -4];
      const b: Vec2 = [47, -4];
      const c: Vec2 = [47, 12];
      const d: Vec2 = [3, 12];
      const moved = [seg('cd', d, c), seg('ab', a, b), seg('da', d, a), seg('bc', c, b)];
      expectRegions(await regionsOf(moved), [{ name: 'ab,bc,cd,da', area: 44 * 16 }]);
    });

    it('a clockwise arc in the input is the same arc (orientation is arbitrary)', async () => {
      const reversed = SLOT.map((c) =>
        c.kind === 'arc' && c.id === 'a1' ? { ...c, from: c.to, to: c.from, ccw: false } : c,
      );
      const result = await regionsOf(reversed);
      expectRegions(result, [{ name: 'a1,a2,l1,l2', area: 100 + 25 * Math.PI }]);
      expectLoopCurves(result.regions[0]?.outer, SLOT);
    });

    it('every outer curve of a rectangle carries the id of its line (M14)', async () => {
      const [r] = (await regionsOf(RECT)).regions;
      expect(idsOf(r?.outer ?? []).sort(compareText)).toEqual(['ab', 'bc', 'cd', 'da']);
    });

    it('a clockwise polygon hole carries the ids of its lines (M14)', async () => {
      const [outer, inner] = (await regionsOf([...RECT, ...TRIANGLE])).regions;
      expect(outer?.holes.map((h) => idsOf(h).sort(compareText))).toEqual([['pq', 'qr', 'rp']]);
      expect(idsOf(inner?.outer ?? []).sort(compareText)).toEqual(['pq', 'qr', 'rp']);
    });

    it('a slot as a hole is clockwise, so its arcs are reversed (M14)', async () => {
      const big = rectangle('', -20, -20, 50, 50).map(upperId);
      const result = await regionsOf([...SLOT, ...big]);
      expectRegions(result, [
        {
          name: 'AB,BC,CD,DA,a1,a2,l1,l2',
          holes: ['a1,a2,l1,l2'],
          area: 2500 - 100 - 25 * Math.PI,
        },
        { name: 'a1,a2,l1,l2', area: 100 + 25 * Math.PI },
      ]);
      const hole = result.regions[0]?.holes[0] ?? [];
      expectLoopCurves(hole, [
        seg('l1', [10, 0], [0, 0]),
        { kind: 'arc', center: [10, 5], from: [10, 10], to: [10, 0], ccw: false, id: 'a1' },
        seg('l2', [0, 10], [10, 10]),
        { kind: 'arc', center: [0, 5], from: [0, 0], to: [0, 10], ccw: false, id: 'a2' },
      ]);
    });

    it('sorts names by string comparison', async () => {
      const curves = [...rectangle('B'), ...rectangle('A', 20)];
      expect(await namesOf(curves)).toEqual(['Aab,Abc,Acd,Ada', 'Bab,Bbc,Bcd,Bda']);
    });
  });

  describe('regions with splines (M29)', () => {
    const SPLINE_RECT_AREA = areaWith([0, 0], SPLINE_BC, [10, 5], [0, 5]);

    it('a rectangle with a bspline side is one region carrying the exact spline', async () => {
      expect(SPLINE_RECT_AREA).toBeGreaterThan(50);
      const result = await regionsOf(SPLINE_RECT);
      expectRegions(result, [
        { name: 'ab,bc,cd,da', area: SPLINE_RECT_AREA, areaTolerance: SPLINE_AREA_TOLERANCE },
      ]);
      expect(result.regions[0]?.outer).toHaveLength(4);
      // Traversed counter-clockwise, the spline runs forward (b → c).
      expectLoopCurves(result.regions[0]?.outer, SPLINE_RECT);
    });

    it('a rectangle with a fit spline side is one region', async () => {
      const { degree, poles, knots } = bspline.interpolate([
        [10, 0],
        [12, 2.5],
        [10, 5],
      ]);
      const side: Spline = { kind: 'bspline', degree, poles, knots, id: 'bc' };
      const curves = [
        seg('ab', [0, 0], [10, 0]),
        side,
        seg('cd', [10, 5], [0, 5]),
        seg('da', [0, 5], [0, 0]),
      ];
      const result = await regionsOf(curves);
      expectRegions(result, [
        {
          name: 'ab,bc,cd,da',
          area: areaWith([0, 0], side, [10, 5], [0, 5]),
          areaTolerance: SPLINE_AREA_TOLERANCE,
        },
      ]);
      expectLoopCurves(result.regions[0]?.outer, curves);
    });

    it('a closed spline is a loop with one node', async () => {
      const sp = closedSpline(SQUARE_POLES);
      const result = await regionsOf([sp]);
      expectRegions(result, [
        { name: 'sp', area: areaWith(sp), areaTolerance: SPLINE_AREA_TOLERANCE },
      ]);
      expect(result.regions[0]?.outer).toHaveLength(1);
      expectLoopCurves(result.regions[0]?.outer, [sp]);
    });

    it('a clockwise closed spline is reversed in the counter-clockwise outer loop', async () => {
      const sp = closedSpline([...SQUARE_POLES].reverse(), [0, 0, 0, 0, 0.25, 1, 1, 1, 1]);
      const result = await regionsOf([sp]);
      expect(result.regions.map((r) => r.name)).toEqual(['sp']);
      // Reversed: poles in the opposite order, knots mirrored (k → 1 − k, reversed).
      expectLoopCurves(result.regions[0]?.outer, [
        closedSpline(SQUARE_POLES, [0, 0, 0, 0, 0.75, 1, 1, 1, 1]),
      ]);
      expectAreaClose(result.regions[0]?.area, -areaWith(sp), SPLINE_AREA_TOLERANCE, 'sp');
    });

    it('a closed spline inside a rectangle is a clockwise hole and a region of its own', async () => {
      const sp = spline('sp', [
        [5, 5],
        [15, 5],
        [15, 15],
        [5, 15],
        [5, 5],
      ]);
      const splineArea = areaWith(sp);
      const result = await regionsOf([...rectangle('', 0, 0, 20, 20).map(upperId), sp]);
      expectRegions(result, [
        {
          name: 'AB,BC,CD,DA,sp',
          holes: ['sp'],
          area: 400 - splineArea,
          areaTolerance: SPLINE_AREA_TOLERANCE,
        },
        { name: 'sp', area: splineArea, areaTolerance: SPLINE_AREA_TOLERANCE },
      ]);
    });

    it.each([
      [
        'a spline across a rectangle',
        [
          ...RECT,
          spline(
            'sp',
            [
              [5, -3],
              [6, 2],
              [7, 8],
            ],
            2,
          ),
        ],
      ],
      [
        'a spline end touching the inside of a line',
        [
          ...RECT,
          spline(
            'sp',
            [
              [5, 0],
              [7, -2],
              [5, -5],
            ],
            2,
          ),
        ],
      ],
      [
        'a spline through a circle',
        [
          ring('k', [0, 0], 2),
          spline(
            'sp',
            [
              [-5, 0],
              [0, 1],
              [5, 0],
            ],
            2,
          ),
        ],
      ],
      [
        'two crossing splines',
        [
          spline(
            'sp',
            [
              [0, 0],
              [5, 10],
              [10, 0],
            ],
            2,
          ),
          spline(
            'tq',
            [
              [0, 5],
              [5, -5],
              [10, 5],
            ],
            2,
          ),
        ],
      ],
      [
        'a closed cubic figure eight',
        [
          spline('sp', [
            [10, 5],
            [20, 10],
            [20, 0],
            [0, 10],
            [0, 0],
            [10, 5],
          ]),
        ],
      ],
      [
        // A quadratic a b a: a straight there-and-back curve whose tessellation overlaps itself.
        'a closed spline a b a running back over itself',
        [
          spline(
            'sp',
            [
              [0, 0],
              [10, 0],
              [0, 0],
            ],
            2,
          ),
        ],
      ],
      [
        'an open spline turning back onto itself',
        [
          spline(
            'sp',
            [
              [0, 0],
              [10, 0],
              [5, 0],
            ],
            2,
          ),
        ],
      ],
    ])('%s cross: no regions', async (_name, curves) => {
      expect(await regionsOf(curves)).toEqual(CROSSING);
    });

    it('keeps the name when coordinates and curve order change', async () => {
      const moved = [
        seg('da', [-3, 12], [-3, -4]),
        seg('cd', [30, 12], [-3, 12]),
        spline('bc', [
          [30, -4],
          [40, 2],
          [35, 9],
          [30, 12],
        ]),
        seg('ab', [-3, -4], [30, -4]),
      ];
      expect(await namesOf(SPLINE_RECT)).toEqual(['ab,bc,cd,da']);
      expect(await namesOf(moved)).toEqual(['ab,bc,cd,da']);
    });

    it('orders a line and a spline leaving a node in the same direction by curvature', async () => {
      // At a, line ab and spline q both leave along +x; q turns left, so it is further
      // counter-clockwise. The quadratic spline a p c cuts 2/3 of triangle a p c (25/3) off
      // triangle a b c (25); triangle a e b below makes a the third edge's node.
      const q = spline(
        'q',
        [
          [0, 0],
          [5, 0],
          [5, 5],
        ],
        2,
      );
      const curves = [
        seg('ab', [0, 0], [10, 0]),
        seg('bc', [10, 0], [5, 5]),
        q,
        seg('ae', [0, 0], [0, -5]),
        seg('eb', [0, -5], [10, 0]),
      ];
      const result = await regionsOf(curves);
      expectRegions(result, [
        { name: 'ab,ae,eb', area: 25 },
        { name: 'ab,bc,q', area: 50 / 3, areaTolerance: SPLINE_AREA_TOLERANCE },
      ]);
      // Traversed counter-clockwise, the spline runs backwards (c → a).
      expectCurveClose(
        result.regions[1]?.outer.find((c) => c.id === 'q'),
        spline(
          'q',
          [
            [5, 5],
            [5, 0],
            [0, 0],
          ],
          2,
        ),
      );
    });
  });

  describe('input (spec 06 profileRegions)', () => {
    it.each([
      ['a curve without id', [...RECT, { kind: 'line', from: [0, 0], to: [1, 1] }]],
      ['an empty id', [...RECT, seg('', [20, 0], [21, 1])]],
      ['a duplicate id', [...RECT, seg('ab', [20, 0], [21, 1])]],
      ['a duplicate id of a zero-length line', [...RECT, seg('ab', [20, 0], [20, 0])]],
      ['an infinite coordinate', [...RECT, seg('x', [20, 0], [Number.POSITIVE_INFINITY, 1])]],
      ['a NaN radius', [...RECT, ring('k', [5, 2], Number.NaN)]],
      ['a zero radius', [...RECT, ring('k', [5, 2], 0)]],
      ['an arc with unequal radii', [...RECT, ccwArc('q', [20, 0], [21, 0], [20, 2])]],
      [
        'a spline with unclamped knots',
        [
          ...RECT,
          {
            ...spline(
              'sp',
              [
                [20, 0],
                [21, 1],
                [22, 0],
              ],
              2,
            ),
            knots: [0, 0.5, 0.5, 0.5, 1, 1],
          },
        ],
      ],
      ['an unknown curve kind', [...RECT, { kind: 'ellipse', id: 'e' }]],
    ])('%s rejects with invalid-input', async (_name, curves) => {
      // Some curves break the types on purpose; the cast through unknown lets them in.
      const params = { curves } as unknown as RegionsParams;
      expect(await rejectionCode(() => kernelOf().profileRegions(params))).toBe('invalid-input');
    });

    it('curves that are not an array reject', async () => {
      // Outside the types on purpose.
      const params = { curves: 42 } as unknown as RegionsParams;
      expect(await rejectionCode(() => kernelOf().profileRegions(params))).toBe('invalid-input');
    });

    it('profileRegions(null) rejects instead of throwing', async () => {
      // Outside the types on purpose.
      expect(
        await rejectionCode(() => kernelOf().profileRegions(null as unknown as RegionsParams)),
      ).toBeDefined();
    });

    it.each([
      ['line', seg('z', [10, 5], [10, 5])],
      ['arc', ccwArc('z', [8, 5], [10, 5], [10, 5])],
      [
        'spline',
        spline(
          'z',
          [
            [10, 5],
            [10, 5],
            [10, 5],
          ],
          2,
        ),
      ],
    ])('a %s of zero length is left out', async (_name, zero) => {
      expectRegions(await regionsOf([...RECT, zero]), [{ name: 'ab,bc,cd,da', area: 50 }]);
    });

    it('creates no handle', async () => {
      await regionsOf([...RECT, ring('k', [5, 2.5], 2)]);
      expect(await kernelOf().liveHandleCount()).toBe(0);
    });

    it('changing the curves right after the call, before await, does not change the regions', async () => {
      const corner: Vec2 = [10, 5];
      const curves: ProfileCurve[] = [
        seg('ab', [0, 0], [10, 0]),
        seg('bc', [10, 0], corner),
        seg('cd', corner, [0, 5]),
        seg('da', [0, 5], [0, 0]),
      ];
      const params = { curves };
      const found = callWithoutThrow(() => kernelOf().profileRegions(params));
      // The inputs are readonly; the test writes into them on purpose.
      Reflect.set(corner, 0, 40);
      curves.push(seg('x', [-5, 2], [15, 2]));
      Reflect.set(params, 'curves', []);
      expectRegions(await found, [{ name: 'ab,bc,cd,da', area: 50 }]);
    });
  });
}

/** A curve with its id in upper case (rectangles with ids AB BC CD DA). */
function upperId(c: ProfileCurve): ProfileCurve {
  return c.id === undefined ? c : { ...c, id: c.id.toUpperCase() };
}

// --- curveIntersections, curveSegment (M33) --------------------------------------------------
// Spec 06 "Stav po M33", spec 12 "Port a parametr křivky": points within LOOP_POINT_TOLERANCE ·
// max(1, |coordinate|), parameters t by their definition (spec 12) within PARAM_TOLERANCE.

/** A parameter of an intersection agrees within this (absolute). */
const PARAM_TOLERANCE = 1e-6;

type IntersectionsParams = Parameters<GeometryKernel['curveIntersections']>[0];
type SegmentParams = Parameters<GeometryKernel['curveSegment']>[0];

/** What an intersection is compared by; `overlap` absent = a plain point. */
interface ExpectedHit {
  readonly a: string;
  readonly b: string;
  readonly point: Vec2;
  readonly ta: number;
  readonly tb: number;
  readonly overlap?: true;
}

/** The point at the parameter t of spec 12 on a curve. */
function paramPoint(c: ProfileCurve, t: number): Vec2 {
  switch (c.kind) {
    case 'line':
      return [c.from[0] + (c.to[0] - c.from[0]) * t, c.from[1] + (c.to[1] - c.from[1]) * t];
    case 'circle':
      return [c.center[0] + c.radius * Math.cos(t), c.center[1] + c.radius * Math.sin(t)];
    case 'arc': {
      const r = Math.hypot(c.from[0] - c.center[0], c.from[1] - c.center[1]);
      const a = Math.atan2(c.from[1] - c.center[1], c.from[0] - c.center[0]) + (c.ccw ? t : -t);
      return [c.center[0] + r * Math.cos(a), c.center[1] + r * Math.sin(a)];
    }
    case 'bspline':
      return bspline.evaluate(c, t);
  }
}

function expectParamClose(actual: number | undefined, expected: number, what: string): void {
  const a = actual ?? Number.NaN;
  if (!(Math.abs(a - expected) <= PARAM_TOLERANCE)) {
    expect.fail(`${what}: ${String(a)} differs from ${String(expected)}`);
  }
}

/** Exactly the expected intersections in this order (a, b, ta), each within the tolerances. */
function expectHits(actual: readonly CurveIntersection[], expected: readonly ExpectedHit[]): void {
  expect(
    actual.map((h) => `${h.a}×${h.b}`),
    'pairs',
  ).toEqual(expected.map((h) => `${h.a}×${h.b}`));
  expected.forEach((e, i) => {
    const h = actual[i];
    const what = `hit ${String(i)} ${e.a}×${e.b}`;
    expectPoint2Close(h?.point, e.point, `${what}: point`);
    expectParamClose(h?.ta, e.ta, `${what}: ta`);
    expectParamClose(h?.tb, e.tb, `${what}: tb`);
    expect(h?.overlap, `${what}: overlap`).toBe(e.overlap);
  });
}

/** Every hit lies on both curves at its parameters (within the point tolerance). */
function expectHitsOnCurves(
  hits: readonly CurveIntersection[],
  curves: readonly ProfileCurve[],
): void {
  for (const h of hits) {
    const a = curves.find((c) => c.id === h.a);
    const b = curves.find((c) => c.id === h.b);
    if (a === undefined || b === undefined) {
      expect.fail(`hit ${h.a}×${h.b} of an unknown curve`);
    }
    expectPoint2Close(paramPoint(a, h.ta), h.point, `${h.a} at ta`);
    expectPoint2Close(paramPoint(b, h.tb), h.point, `${h.b} at tb`);
  }
}

/** Upper half of the circle r = 5 around the origin, from (5, 0) counter-clockwise to (−5, 0). */
const UPPER_ARC = ccwArc('k', [0, 0], [5, 0], [-5, 0]);
/** The same half circle clockwise from (−5, 0) to (5, 0). */
const UPPER_ARC_CW: ProfileCurve = {
  kind: 'arc',
  center: [0, 0],
  from: [-5, 0],
  to: [5, 0],
  ccw: false,
  id: 'k',
};
/** The angle of (4, 3) on a circle around the origin. */
const ANGLE_43 = Math.atan2(3, 4);
/**
 * An open cubic Bézier with a loop: x = 45t − 105t² + 70t³, y = 30t(1 − t) crosses itself at
 * t = 1/2 ± √(3/28) (y is symmetric about 1/2, x(1/2 + u) − x(1/2 − u) = 2u(70u² − 7.5)).
 */
const LOOP = spline('sp', [
  [0, 0],
  [15, 10],
  [-5, 10],
  [10, 0],
]);
const LOOP_U = Math.sqrt(3 / 28);
/**
 * A quadratic spline from (0, −4) to (10, −4): x = 10t, y = −4 + 24t − 24t², so it crosses
 * y = 0 at t = (1 ∓ 1/√3) / 2.
 */
const ARCH = spline(
  'sp',
  [
    [0, -4],
    [5, 8],
    [10, -4],
  ],
  2,
);
const ARCH_T = (1 - 1 / Math.sqrt(3)) / 2;

function describeCurveIntersections(kernelOf: () => GeometryKernel): void {
  const hitsOf = (curves: readonly ProfileCurve[]): Promise<readonly CurveIntersection[]> =>
    callWithoutThrow(() => kernelOf().curveIntersections({ curves }));

  describe('intersections (spec 06 Stav po M33)', () => {
    it('crossing lines meet once, with t of both lines', async () => {
      const curves = [seg('p', [0, 0], [10, 0]), seg('q', [4, -2], [4, 8])];
      expectHits(await hitsOf(curves), [{ a: 'p', b: 'q', point: [4, 0], ta: 0.4, tb: 0.2 }]);
    });

    it('a line across an arc meets it twice, ordered by ta; t of the arc from its from', async () => {
      const curves = [seg('l', [-10, 3], [10, 3]), UPPER_ARC];
      expectHits(await hitsOf(curves), [
        { a: 'l', b: 'k', point: [-4, 3], ta: 0.3, tb: Math.PI - ANGLE_43 },
        { a: 'l', b: 'k', point: [4, 3], ta: 0.7, tb: ANGLE_43 },
      ]);
    });

    it('a clockwise arc measures t from its from in its own direction', async () => {
      const curves = [seg('l', [-10, 3], [10, 3]), UPPER_ARC_CW];
      expectHits(await hitsOf(curves), [
        { a: 'l', b: 'k', point: [-4, 3], ta: 0.3, tb: ANGLE_43 },
        { a: 'l', b: 'k', point: [4, 3], ta: 0.7, tb: Math.PI - ANGLE_43 },
      ]);
    });

    it('a circle has t = atan2(p − center) in [0, 2π)', async () => {
      const curves = [seg('l', [4, -10], [4, 10]), ring('c', [1, 0], 5)];
      expectHits(await hitsOf(curves), [
        { a: 'l', b: 'c', point: [4, -4], ta: 0.3, tb: 2 * Math.PI - Math.atan2(4, 3) },
        { a: 'l', b: 'c', point: [4, 4], ta: 0.7, tb: Math.atan2(4, 3) },
      ]);
    });

    it('a line tangent to a circle touches it once', async () => {
      const curves = [ring('c', [0, 0], 5), seg('l', [-10, 5], [10, 5])];
      expectHits(await hitsOf(curves), [
        { a: 'c', b: 'l', point: [0, 5], ta: Math.PI / 2, tb: 0.5 },
      ]);
    });

    it('tangent circles touch once', async () => {
      const curves = [ring('c1', [0, 0], 2), ring('c2', [0, 5], 3)];
      expectHits(await hitsOf(curves), [
        { a: 'c1', b: 'c2', point: [0, 2], ta: Math.PI / 2, tb: (3 * Math.PI) / 2 },
      ]);
    });

    it('lines sharing an end meet in it', async () => {
      const curves = [seg('ab', [0, 0], [10, 0]), seg('bc', [10, 0], [10, 5])];
      expectHits(await hitsOf(curves), [{ a: 'ab', b: 'bc', point: [10, 0], ta: 1, tb: 0 }]);
    });

    it('overlapping lines give both ends of the shared piece as overlap', async () => {
      const curves = [seg('ab', [0, 0], [10, 0]), seg('pq', [4, 0], [14, 0])];
      expectHits(await hitsOf(curves), [
        { a: 'ab', b: 'pq', point: [4, 0], ta: 0.4, tb: 0, overlap: true },
        { a: 'ab', b: 'pq', point: [10, 0], ta: 1, tb: 0.6, overlap: true },
      ]);
    });

    it('a spline across a line: t of the spline is its knot parameter', async () => {
      const curves = [ARCH, seg('l', [-2, 0], [18, 0])];
      const hits = await hitsOf(curves);
      expectHits(hits, [
        { a: 'sp', b: 'l', point: [10 * ARCH_T, 0], ta: ARCH_T, tb: (10 * ARCH_T + 2) / 20 },
        {
          a: 'sp',
          b: 'l',
          point: [10 * (1 - ARCH_T), 0],
          ta: 1 - ARCH_T,
          tb: (10 * (1 - ARCH_T) + 2) / 20,
        },
      ]);
      expectHitsOnCurves(hits, curves);
    });

    it('a spline crossing itself is a hit of the spline with itself, ta < tb', async () => {
      const ta = 0.5 - LOOP_U;
      const hits = await hitsOf([LOOP]);
      expectHits(hits, [
        { a: 'sp', b: 'sp', point: bspline.evaluate(LOOP, ta), ta, tb: 0.5 + LOOP_U },
      ]);
      expectHitsOnCurves(hits, [LOOP]);
    });

    it('a spline across an arc lies on both at its parameters', async () => {
      const curves = [
        UPPER_ARC_CW,
        spline('sp', [
          [-6, 0],
          [-2, 9],
          [2, -3],
          [6, 6],
        ]),
      ];
      const hits = await hitsOf(curves);
      expect(hits.length).toBeGreaterThan(0);
      expectHitsOnCurves(hits, curves);
    });

    it('pairs follow the input order (a before b), then ta', async () => {
      const curves = [
        seg('h', [0, 0], [10, 0]),
        seg('v8', [8, -1], [8, 1]),
        seg('v2', [2, -1], [2, 1]),
        seg('w', [-1, 0.5], [11, 0.5]),
      ];
      expectHits(await hitsOf(curves), [
        { a: 'h', b: 'v8', point: [8, 0], ta: 0.8, tb: 0.5 },
        { a: 'h', b: 'v2', point: [2, 0], ta: 0.2, tb: 0.5 },
        { a: 'v8', b: 'w', point: [8, 0.5], ta: 0.75, tb: 0.75 },
        { a: 'v2', b: 'w', point: [2, 0.5], ta: 0.75, tb: 0.25 },
      ]);
    });

    it('curves apart, no curves, a curve alone: no intersections', async () => {
      expect(await hitsOf([seg('p', [0, 0], [1, 0]), ring('c', [5, 5], 1)])).toEqual([]);
      expect(await hitsOf([])).toEqual([]);
      expect(await hitsOf([UPPER_ARC])).toEqual([]);
    });

    it('a curve of zero length is left out', async () => {
      const curves = [seg('p', [0, 0], [10, 0]), seg('z', [5, 0], [5, 0])];
      expect(await hitsOf(curves)).toEqual([]);
    });
  });

  describe('input (spec 06 curveIntersections)', () => {
    it.each([
      [
        'a curve without id',
        [seg('p', [0, 0], [1, 0]), { kind: 'line', from: [0, 0], to: [1, 1] }],
      ],
      ['a duplicate id', [seg('p', [0, 0], [1, 0]), seg('p', [0, 1], [1, 1])]],
      ['a NaN radius', [ring('c', [0, 0], Number.NaN)]],
    ])('%s rejects with invalid-input', async (_name, curves) => {
      // Some curves break the types on purpose; the cast through unknown lets them in.
      const params = { curves } as unknown as IntersectionsParams;
      expect(await rejectionCode(() => kernelOf().curveIntersections(params))).toBe(
        'invalid-input',
      );
    });

    it('curveIntersections(null) rejects instead of throwing', async () => {
      // Outside the types on purpose.
      const params = null as unknown as IntersectionsParams;
      expect(await rejectionCode(() => kernelOf().curveIntersections(params))).toBe(
        'invalid-input',
      );
    });

    it('creates no handle', async () => {
      await hitsOf([seg('l', [-10, 3], [10, 3]), UPPER_ARC, LOOP]);
      expect(await kernelOf().liveHandleCount()).toBe(0);
    });

    it('changing the curves right after the call, before await, does not change the result', async () => {
      const end: Vec2 = [4, 8];
      const curves: ProfileCurve[] = [seg('p', [0, 0], [10, 0]), seg('q', [4, -2], end)];
      const params = { curves };
      const found = callWithoutThrow(() => kernelOf().curveIntersections(params));
      // The inputs are readonly; the test writes into them on purpose.
      Reflect.set(end, 0, 40);
      curves.push(seg('x', [5, -5], [5, 5]));
      Reflect.set(params, 'curves', []);
      expectHits(await found, [{ a: 'p', b: 'q', point: [4, 0], ta: 0.4, tb: 0.2 }]);
    });
  });
}

/** A cubic spline with two inner knots over the knot range [0, 1]. */
const WAVY = spline('w', [
  [0, 0],
  [2, 5],
  [4, -3],
  [6, 4],
  [8, -2],
  [10, 1],
]);

/** The piece lies on the original: its point at s is the original's at from + s · (to − from). */
function expectPieceOnSpline(
  piece: ProfileCurve,
  original: Spline,
  from: number,
  to: number,
): void {
  if (piece.kind !== 'bspline') {
    expect.fail(`the piece of a spline is a ${piece.kind}`);
  }
  expect(piece.id).toBe(original.id);
  expect(piece.degree).toBe(original.degree);
  expect(piece.knots[0]).toBe(0);
  expect(piece.knots[piece.knots.length - 1]).toBe(1);
  expect(piece.knots.length).toBe(piece.poles.length + piece.degree + 1);
  for (let i = 0; i <= 40; i++) {
    const s = i / 40;
    expectPoint2Close(
      bspline.evaluate(piece, s),
      bspline.evaluate(original, from + s * (to - from)),
      `piece at ${String(s)}`,
    );
  }
}

function describeCurveSegment(kernelOf: () => GeometryKernel): void {
  const pieceOf = (curve: ProfileCurve, from: number, to: number): Promise<ProfileCurve> =>
    callWithoutThrow(() => kernelOf().curveSegment({ curve, from, to }));

  describe('pieces (spec 06 Stav po M33)', () => {
    it('a piece of a line, with the id of the input', async () => {
      expectCurveClose(
        await pieceOf(seg('p', [0, 0], [10, 20]), 0.2, 0.7),
        seg('p', [2, 4], [7, 14]),
      );
    });

    it('a piece of a counter-clockwise arc', async () => {
      const arc = ccwArc('k', [1, 1], [6, 1], [1, 6]);
      const c = Math.cos(Math.PI / 8);
      const s = Math.sin(Math.PI / 8);
      const r = 5 * Math.SQRT1_2;
      expectCurveClose(
        await pieceOf(arc, Math.PI / 8, Math.PI / 4),
        ccwArc('k', [1, 1], [1 + 5 * c, 1 + 5 * s], [1 + r, 1 + r]),
      );
    });

    it('a piece of a clockwise arc runs clockwise from its from', async () => {
      const arc: ProfileCurve = {
        kind: 'arc',
        center: [0, 0],
        from: [0, 5],
        to: [5, 0],
        ccw: false,
        id: 'k',
      };
      const r = 5 * Math.SQRT1_2;
      expectCurveClose(await pieceOf(arc, 0, Math.PI / 4), { ...arc, to: [r, r] });
    });

    it('a piece of a circle is a counter-clockwise arc, also across 2π', async () => {
      const circle = ring('c', [1, 2], 5);
      expectCurveClose(
        await pieceOf(circle, (3 * Math.PI) / 2, (5 * Math.PI) / 2),
        ccwArc('c', [1, 2], [1, -3], [1, 7]),
      );
      expectCurveClose(await pieceOf(circle, 0, Math.PI), ccwArc('c', [1, 2], [6, 2], [-4, 2]));
    });

    it('a piece of a spline lies on it and has its knots in [0, 1]', async () => {
      expectPieceOnSpline(await pieceOf(WAVY, 0.2, 0.9), WAVY, 0.2, 0.9);
    });

    it('a piece of a spline from an inner knot, and from the start', async () => {
      expectPieceOnSpline(await pieceOf(WAVY, 1 / 3, 1), WAVY, 1 / 3, 1);
      expectPieceOnSpline(await pieceOf(WAVY, 0, 0.5), WAVY, 0, 0.5);
    });

    it('a piece of a spline over the knot range [2, 6]', async () => {
      const shifted: Spline = { ...WAVY, knots: WAVY.knots.map((k) => 2 + 4 * k) };
      expectPieceOnSpline(await pieceOf(shifted, 3, 5), shifted, 3, 5);
    });

    it('the whole spline is the same spline', async () => {
      expectCurveClose(await pieceOf(WAVY, 0, 1), WAVY);
    });
  });

  describe('input (spec 06 curveSegment)', () => {
    it.each([
      ['from = to', seg('p', [0, 0], [1, 0]), 0.5, 0.5],
      ['from > to', seg('p', [0, 0], [1, 0]), 0.6, 0.5],
      ['a line from below 0', seg('p', [0, 0], [1, 0]), -0.1, 0.5],
      ['a line to above 1', seg('p', [0, 0], [1, 0]), 0.5, 1.1],
      ['an arc past its sweep', UPPER_ARC, 0, Math.PI + 0.1],
      ['a circle from 2π', ring('c', [0, 0], 1), 2 * Math.PI, 3 * Math.PI],
      ['a circle over more than one turn', ring('c', [0, 0], 1), 1, 1.1 + 2 * Math.PI],
      ['a circle over exactly one turn', ring('c', [0, 0], 1), 1, 1 + 2 * Math.PI],
      ['a spline outside its knots', WAVY, 0.5, 1.5],
      ['a NaN parameter', seg('p', [0, 0], [1, 0]), Number.NaN, 0.5],
      ['a line of zero length', seg('p', [1, 0], [1, 0]), 0, 1],
    ])('%s rejects with invalid-input', async (_name, curve, from, to) => {
      expect(await rejectionCode(() => kernelOf().curveSegment({ curve, from, to }))).toBe(
        'invalid-input',
      );
    });

    it('curveSegment(null) rejects instead of throwing', async () => {
      // Outside the types on purpose.
      const params = null as unknown as SegmentParams;
      expect(await rejectionCode(() => kernelOf().curveSegment(params))).toBe('invalid-input');
    });

    it('creates no handle', async () => {
      await pieceOf(WAVY, 0.2, 0.9);
      expect(await kernelOf().liveHandleCount()).toBe(0);
    });

    it('changing the curve right after the call, before await, does not change the piece', async () => {
      const end: Vec2 = [10, 20];
      const params = { curve: seg('p', [0, 0], end), from: 0.2, to: 0.7 };
      const found = callWithoutThrow(() => kernelOf().curveSegment(params));
      // The inputs are readonly; the test writes into them on purpose.
      Reflect.set(end, 0, 40);
      Reflect.set(params, 'from', 0);
      expectCurveClose(await found, seg('p', [2, 4], [7, 14]));
    });
  });
}

// --- filletArc (M34) ---------------------------------------------------------------------------
// Spec 06 "Stav po M34", spec 12 "Zaoblení a sražení ve skice (M34)": points within
// LOOP_POINT_TOLERANCE · max(1, |coordinate|), parameters t (spec 12) within PARAM_TOLERANCE.

type FilletParams = Parameters<GeometryKernel['filletArc']>[0];

function expectFillet(actual: FilletArc, expected: FilletArc): void {
  expectPoint2Close(actual.center, expected.center, 'center');
  expectPoint2Close(actual.pointA, expected.pointA, 'pointA');
  expectPoint2Close(actual.pointB, expected.pointB, 'pointB');
  expectParamClose(actual.ta, expected.ta, 'ta');
  expectParamClose(actual.tb, expected.tb, 'tb');
}

/** The point at `distance` from `p` in the direction of `to`. */
function toward(p: Vec2, to: Vec2, distance: number): Vec2 {
  const d = Math.hypot(to[0] - p[0], to[1] - p[1]);
  return [p[0] + ((to[0] - p[0]) / d) * distance, p[1] + ((to[1] - p[1]) / d) * distance];
}

/** The angle of `p` around `center`, in [0, 2π). */
function angleIn(center: Vec2, p: Vec2): number {
  const a = Math.atan2(p[1] - center[1], p[0] - center[0]);
  return a < 0 ? a + TURN : a;
}

/** The x axis from −10 to 10. */
const X_AXIS_LINE = seg('x', [-10, 0], [10, 0]);

function describeFilletArc(kernelOf: () => GeometryKernel): void {
  const filletOf = (p: FilletParams): Promise<FilletArc> =>
    callWithoutThrow(() => kernelOf().filletArc(p));

  describe('centers (spec 06 Stav po M34)', () => {
    it('two perpendicular lines meeting in a corner', async () => {
      const a = seg('a', [0, 0], [10, 0]);
      const b = seg('b', [10, 0], [10, 10]);
      expectFillet(await filletOf({ a, b, radius: 2, near: [9, 1] }), {
        center: [8, 2],
        pointA: [8, 0],
        pointB: [10, 2],
        ta: 0.8,
        tb: 0.2,
      });
    });

    it('lines at 60°: the center on the bisector', async () => {
      const a = seg('a', [0, 0], [10, 0]);
      const b = seg('b', [0, 0], [5, 5 * Math.sqrt(3)]);
      const s3 = Math.sqrt(3);
      expectFillet(await filletOf({ a, b, radius: 1, near: [2, 0.5] }), {
        center: [s3, 1],
        pointA: [s3, 0],
        pointB: [s3 / 2, 1.5],
        ta: s3 / 10,
        tb: s3 / 10,
      });
    });

    it('a line and an arc, the fillet outside the arc', async () => {
      // The lower half of the circle r = 3 around (0, 5), counter-clockwise from (−3, 5).
      const b = ccwArc('k', [0, 5], [-3, 5], [3, 5]);
      const pointB = toward([0, 5], [4, 2], 3);
      expectFillet(await filletOf({ a: X_AXIS_LINE, b, radius: 2, near: [4, 1.5] }), {
        center: [4, 2],
        pointA: [4, 0],
        pointB,
        ta: 0.7,
        tb: angleIn([0, 5], pointB) - Math.PI,
      });
    });

    it('a line and an arc, the fillet inside the arc; a clockwise arc counts from its from', async () => {
      const center: Vec2 = [Math.sqrt(5), 2];
      const expected: FilletArc = {
        center,
        pointA: [Math.sqrt(5), 0],
        pointB: toward([0, 0], center, 5),
        ta: (Math.sqrt(5) + 10) / 20,
        tb: Math.atan2(2, Math.sqrt(5)),
      };
      expectFillet(
        await filletOf({ a: X_AXIS_LINE, b: UPPER_ARC, radius: 2, near: [2.2, 1.8] }),
        expected,
      );
      expectFillet(
        await filletOf({ a: X_AXIS_LINE, b: UPPER_ARC_CW, radius: 2, near: [2.2, 1.8] }),
        { ...expected, tb: Math.PI - expected.tb },
      );
    });

    it('two arcs, the fillet outside both', async () => {
      const a = ccwArc('a', [0, 0], [5, 0], [0, 5]);
      const b = ccwArc('b', [8, 0], [12, 0], [4, 0]);
      // 7 from (0, 0) and 6 from (8, 0).
      const x = 77 / 16;
      const center: Vec2 = [x, Math.sqrt(49 - x * x)];
      const pointA = toward([0, 0], center, 5);
      const pointB = toward([8, 0], center, 4);
      expectFillet(await filletOf({ a, b, radius: 2, near: [5, 5] }), {
        center,
        pointA,
        pointB,
        ta: angleIn([0, 0], pointA),
        tb: angleIn([8, 0], pointB),
      });
    });

    it('lines that do not meet: the touching points on their extensions', async () => {
      const a = seg('a', [0, 0], [4, 0]);
      const b = seg('b', [10, 4], [10, 10]);
      expectFillet(await filletOf({ a, b, radius: 2, near: [9, 1] }), {
        center: [8, 2],
        pointA: [8, 0],
        pointB: [10, 2],
        ta: 2,
        tb: -1 / 3,
      });
    });

    it('near chooses among the possible centers', async () => {
      const a = seg('a', [0, 0], [10, 0]);
      const b = seg('b', [10, 0], [10, 10]);
      expectFillet(await filletOf({ a, b, radius: 2, near: [11, -1] }), {
        center: [12, -2],
        pointA: [12, 0],
        pointB: [10, -2],
        ta: 1.2,
        tb: -0.2,
      });
      expectFillet(await filletOf({ a, b, radius: 2, near: [11, 1] }), {
        center: [12, 2],
        pointA: [12, 0],
        pointB: [10, 2],
        ta: 1.2,
        tb: 0.2,
      });
    });

    it('a touching point beyond the end of an arc: t is the angle from its from in its direction, in [0, 2π)', async () => {
      // A quarter of the circle r = 5 around the origin, from (0, 5) counter-clockwise to (−5, 0);
      // the fillet with the x axis on the right touches the circle at the angle atan2(2, √5).
      const b = ccwArc('k', [0, 0], [0, 5], [-5, 0]);
      const center: Vec2 = [Math.sqrt(5), 2];
      expectFillet(await filletOf({ a: X_AXIS_LINE, b, radius: 2, near: [2.2, 1.8] }), {
        center,
        pointA: [Math.sqrt(5), 0],
        pointB: toward([0, 0], center, 5),
        ta: (Math.sqrt(5) + 10) / 20,
        tb: Math.atan2(2, Math.sqrt(5)) - Math.PI / 2 + TURN,
      });
    });
  });

  describe('no solution (spec 06 Stav po M34)', () => {
    it.each([
      [
        'parallel lines farther apart than 2r',
        seg('a', [0, 0], [10, 0]),
        seg('b', [0, 5], [10, 5]),
        2,
      ],
      [
        'a line and an arc too far for the radius',
        X_AXIS_LINE,
        ccwArc('k', [0, 20], [1, 20], [-1, 20]),
        2,
      ],
      [
        'concentric arcs whose gap does not fit the radius',
        ccwArc('a', [0, 0], [3, 0], [0, 3]),
        ccwArc('b', [0, 0], [7, 0], [0, 7]),
        1,
      ],
    ] satisfies [string, ProfileCurve, ProfileCurve, number][])(
      '%s rejects with operation-failed',
      async (_name, a, b, radius) => {
        expect(
          await rejectionCode(() => kernelOf().filletArc({ a, b, radius, near: [1, 1] })),
        ).toBe('operation-failed');
      },
    );
  });

  describe('input (spec 06 filletArc)', () => {
    const a = seg('a', [0, 0], [10, 0]);
    const b = seg('b', [10, 0], [10, 10]);

    it.each([
      ['a circle', { a: ring('c', [0, 0], 1), b, radius: 1, near: [1, 1] }],
      ['a spline', { a, b: WAVY, radius: 1, near: [1, 1] }],
      ['a line of zero length', { a: seg('a', [1, 0], [1, 0]), b, radius: 1, near: [1, 1] }],
      [
        'an arc with two radii',
        { a, b: ccwArc('k', [0, 0], [1, 0], [0, 2]), radius: 1, near: [1, 1] },
      ],
      ['radius 0', { a, b, radius: 0, near: [9, 1] }],
      ['a negative radius', { a, b, radius: -1, near: [9, 1] }],
      ['an infinite radius', { a, b, radius: Number.POSITIVE_INFINITY, near: [9, 1] }],
      ['a NaN near', { a, b, radius: 1, near: [Number.NaN, 1] }],
    ] satisfies [string, FilletParams][])(
      '%s rejects with invalid-input',
      async (_name, params) => {
        expect(await rejectionCode(() => kernelOf().filletArc(params))).toBe('invalid-input');
      },
    );

    it('filletArc(null) rejects instead of throwing', async () => {
      // Outside the types on purpose.
      const params = null as unknown as FilletParams;
      expect(await rejectionCode(() => kernelOf().filletArc(params))).toBe('invalid-input');
    });

    it('the ids are optional', async () => {
      const fillet = await filletOf({
        a: line([0, 0], [10, 0]),
        b: line([10, 0], [10, 10]),
        radius: 2,
        near: [9, 1],
      });
      expectPoint2Close(fillet.center, [8, 2], 'center');
    });

    it('creates no handle', async () => {
      await filletOf({ a, b, radius: 2, near: [9, 1] });
      expect(await kernelOf().liveHandleCount()).toBe(0);
    });

    it('changing the input right after the call, before await, does not change the result', async () => {
      const near: Vec2 = [9, 1];
      const params = { a, b, radius: 2, near };
      const found = callWithoutThrow(() => kernelOf().filletArc(params));
      // The inputs are readonly; the test writes into them on purpose.
      Reflect.set(near, 0, 11);
      Reflect.set(near, 1, -1);
      Reflect.set(params, 'radius', 1);
      expectPoint2Close((await found).center, [8, 2], 'center');
    });
  });
}

// --- offsetCurves (M35) ------------------------------------------------------------------------
// Spec 06 "Stav po M35", spec 12 "Offset (M35)": the curves in order, with their source, points
// within LOOP_POINT_TOLERANCE · max(1, |coordinate|). Only lines, arcs and circles without
// vanishing curves: the FakeKernel neither offsets splines nor drops curves (the OCCT adapter
// test covers both).

type OffsetParams = Parameters<GeometryKernel['offsetCurves']>[0];

const offsetLine = (source: string, from: Vec2, to: Vec2): OffsetCurve => ({
  kind: 'line',
  from,
  to,
  source,
});
const offsetArc = (
  source: string,
  center: Vec2,
  from: Vec2,
  to: Vec2,
  ccw = true,
): OffsetCurve => ({ kind: 'arc', center, from, to, ccw, source });

/** The same curves in the same order: kind, source and every point. */
function expectOffsetClose(actual: readonly OffsetCurve[], expected: readonly OffsetCurve[]): void {
  const labels = (curves: readonly OffsetCurve[]): string[] =>
    curves.map((c) => `${c.kind}:${c.source ?? '-'}`);
  expect(labels(actual), 'kinds and sources in order').toEqual(labels(expected));
  expected.forEach((e, i) => {
    // The sources are compared above; expectCurveClose compares the geometry (and no id).
    expectCurveClose(actual[i], e);
  });
}

/** Rounded rectangle 10 × 6 with corner radius 2, counter-clockwise from (2, 0). */
const ROUNDED = [
  seg('b', [2, 0], [8, 0]),
  ccwArc('br', [8, 2], [8, 0], [10, 2]),
  seg('r', [10, 2], [10, 4]),
  ccwArc('tr', [8, 4], [10, 4], [8, 6]),
  seg('t', [8, 6], [2, 6]),
  ccwArc('tl', [2, 4], [2, 6], [0, 4]),
  seg('l', [0, 4], [0, 2]),
  ccwArc('bl', [2, 2], [0, 2], [2, 0]),
];

/** ROUNDED offset by d (> −2): the lines moved, the arcs of radius 2 + d around the same centers. */
function roundedOffset(d: number): OffsetCurve[] {
  return [
    offsetLine('b', [2, -d], [8, -d]),
    offsetArc('br', [8, 2], [8, -d], [10 + d, 2]),
    offsetLine('r', [10 + d, 2], [10 + d, 4]),
    offsetArc('tr', [8, 4], [10 + d, 4], [8, 6 + d]),
    offsetLine('t', [8, 6 + d], [2, 6 + d]),
    offsetArc('tl', [2, 4], [2, 6 + d], [-d, 4]),
    offsetLine('l', [-d, 4], [-d, 2]),
    offsetArc('bl', [2, 2], [-d, 2], [2, -d]),
  ];
}

/** The same chain run the other way: every curve reversed, in reverse order. */
function reversedChain<C extends ProfileCurve>(curves: readonly C[]): C[] {
  return [...curves].reverse().map((c): C => {
    if (c.kind === 'line') return { ...c, from: c.to, to: c.from };
    if (c.kind === 'arc') return { ...c, from: c.to, to: c.from, ccw: !c.ccw };
    return c;
  });
}

function describeOffsetCurves(kernelOf: () => GeometryKernel): void {
  const offsetOf = (p: OffsetParams): Promise<readonly OffsetCurve[]> =>
    callWithoutThrow(() => kernelOf().offsetCurves(p));

  describe('closed chains (spec 06 Stav po M35)', () => {
    it('a rectangle outwards: sharp corners, the curves in the order of the chain', async () => {
      expectOffsetClose(await offsetOf({ curves: RECT, closed: true, distance: 1 }), [
        offsetLine('ab', [-1, -1], [11, -1]),
        offsetLine('bc', [11, -1], [11, 6]),
        offsetLine('cd', [11, 6], [-1, 6]),
        offsetLine('da', [-1, 6], [-1, -1]),
      ]);
    });

    it('a rectangle inwards', async () => {
      expectOffsetClose(await offsetOf({ curves: RECT, closed: true, distance: -1 }), [
        offsetLine('ab', [1, 1], [9, 1]),
        offsetLine('bc', [9, 1], [9, 4]),
        offsetLine('cd', [9, 4], [1, 4]),
        offsetLine('da', [1, 4], [1, 1]),
      ]);
    });

    it('a clockwise rectangle: > 0 is still outwards, the result runs clockwise', async () => {
      expectOffsetClose(
        await offsetOf({ curves: reversedChain(RECT), closed: true, distance: 1 }),
        [
          offsetLine('da', [-1, -1], [-1, 6]),
          offsetLine('cd', [-1, 6], [11, 6]),
          offsetLine('bc', [11, 6], [11, -1]),
          offsetLine('ab', [11, -1], [-1, -1]),
        ],
      );
    });

    it('a rounded rectangle outwards: arcs around the same centers, tangent joins', async () => {
      expectOffsetClose(
        await offsetOf({ curves: ROUNDED, closed: true, distance: 1 }),
        roundedOffset(1),
      );
    });

    it('a rounded rectangle inwards', async () => {
      expectOffsetClose(
        await offsetOf({ curves: ROUNDED, closed: true, distance: -1 }),
        roundedOffset(-1),
      );
    });

    it('a clockwise rounded rectangle outwards', async () => {
      expectOffsetClose(
        await offsetOf({ curves: reversedChain(ROUNDED), closed: true, distance: 1 }),
        reversedChain(roundedOffset(1)),
      );
    });

    it('a circle outwards and inwards', async () => {
      const circle = ring('k', [1, 2], 5);
      expectOffsetClose(await offsetOf({ curves: [circle], closed: true, distance: 1 }), [
        { kind: 'circle', center: [1, 2], radius: 6, source: 'k' },
      ]);
      expectOffsetClose(await offsetOf({ curves: [circle], closed: true, distance: -2 }), [
        { kind: 'circle', center: [1, 2], radius: 3, source: 'k' },
      ]);
    });

    it.each([5, 6])(
      'a circle inwards by %d (its radius or more) rejects with operation-failed',
      async (d) => {
        const p = { curves: [ring('k', [0, 0], 5)], closed: true, distance: -d };
        expect(await rejectionCode(() => kernelOf().offsetCurves(p))).toBe('operation-failed');
      },
    );
  });

  describe('open chains (spec 06 Stav po M35)', () => {
    const L = [seg('h', [0, 0], [10, 0]), seg('v', [10, 0], [10, 5])];

    it('an L to the right of its direction: the outer corner sharp', async () => {
      expectOffsetClose(await offsetOf({ curves: L, closed: false, distance: 1 }), [
        offsetLine('h', [0, -1], [11, -1]),
        offsetLine('v', [11, -1], [11, 5]),
      ]);
    });

    it('an L to the left of its direction: the inner corner cut', async () => {
      expectOffsetClose(await offsetOf({ curves: L, closed: false, distance: -1 }), [
        offsetLine('h', [0, 1], [9, 1]),
        offsetLine('v', [9, 1], [9, 5]),
      ]);
    });

    it('a single line', async () => {
      expectOffsetClose(
        await offsetOf({ curves: [seg('p', [0, 0], [10, 0])], closed: false, distance: 2 }),
        [offsetLine('p', [0, -2], [10, -2])],
      );
    });

    it('a single counter-clockwise arc: to the right is outwards', async () => {
      const arc = ccwArc('k', [0, 0], [5, 0], [0, 5]);
      expectOffsetClose(await offsetOf({ curves: [arc], closed: false, distance: 1 }), [
        offsetArc('k', [0, 0], [6, 0], [0, 6]),
      ]);
      expectOffsetClose(await offsetOf({ curves: [arc], closed: false, distance: -1 }), [
        offsetArc('k', [0, 0], [4, 0], [0, 4]),
      ]);
    });

    it('a single clockwise arc: to the right is inwards', async () => {
      const arc = { ...ccwArc('k', [0, 0], [0, 5], [5, 0]), ccw: false };
      expectOffsetClose(await offsetOf({ curves: [arc], closed: false, distance: 1 }), [
        offsetArc('k', [0, 0], [0, 4], [4, 0], false),
      ]);
    });

    it('an L turning right: to the right is its inner side', async () => {
      const curves = [seg('h', [0, 0], [10, 0]), seg('v', [10, 0], [10, -5])];
      expectOffsetClose(await offsetOf({ curves, closed: false, distance: 1 }), [
        offsetLine('h', [0, -1], [9, -1]),
        offsetLine('v', [9, -1], [9, -5]),
      ]);
    });

    it('a chain starting with a clockwise arc keeps its side', async () => {
      const arc = { ...ccwArc('k', [0, 0], [0, 5], [5, 0]), ccw: false };
      const curves = [arc, seg('p', [5, 0], [5, -5])];
      expectOffsetClose(await offsetOf({ curves, closed: false, distance: 1 }), [
        offsetArc('k', [0, 0], [0, 4], [4, 0], false),
        offsetLine('p', [4, 0], [4, -5]),
      ]);
    });

    it('a line and a tangent arc: the join is the common point of both offsets', async () => {
      const curves = [seg('p', [0, 0], [5, 0]), ccwArc('k', [5, 3], [5, 0], [8, 3])];
      expectOffsetClose(await offsetOf({ curves, closed: false, distance: 1 }), [
        offsetLine('p', [0, -1], [5, -1]),
        offsetArc('k', [5, 3], [5, -1], [9, 3]),
      ]);
      expectOffsetClose(await offsetOf({ curves, closed: false, distance: -1 }), [
        offsetLine('p', [0, 1], [5, 1]),
        offsetArc('k', [5, 3], [5, 1], [7, 3]),
      ]);
    });
  });

  describe('input (spec 06 offsetCurves)', () => {
    const p = seg('p', [0, 0], [10, 0]);
    const q = seg('q', [10, 0], [10, 5]);
    const apart = seg('q', [11, 0], [11, 5]);

    it.each([
      ['no curves', { curves: [], closed: false, distance: 1 }],
      ['distance 0', { curves: [p], closed: false, distance: 0 }],
      ['an infinite distance', { curves: [p], closed: false, distance: Number.POSITIVE_INFINITY }],
      ['a NaN distance', { curves: [p], closed: false, distance: Number.NaN }],
      ['a curve without id', { curves: [line([0, 0], [10, 0])], closed: false, distance: 1 }],
      ['a line of zero length', { curves: [seg('p', [1, 0], [1, 0])], closed: false, distance: 1 }],
      ['curves that do not join', { curves: [p, apart], closed: false, distance: 1 }],
      ['a closed chain that does not close', { curves: [p, q], closed: true, distance: 1 }],
      [
        'a circle with another curve',
        { curves: [ring('k', [0, 0], 1), p], closed: true, distance: 1 },
      ],
      ['an open circle', { curves: [ring('k', [0, 0], 1)], closed: false, distance: 1 }],
    ] satisfies [string, OffsetParams][])(
      '%s rejects with invalid-input',
      async (_name, params) => {
        expect(await rejectionCode(() => kernelOf().offsetCurves(params))).toBe('invalid-input');
      },
    );

    it('offsetCurves(null) and a closed that is not a boolean reject instead of throwing', async () => {
      // Outside the types on purpose.
      const params = null as unknown as OffsetParams;
      expect(await rejectionCode(() => kernelOf().offsetCurves(params))).toBe('invalid-input');
      const notBoolean = { curves: [p], closed: 'no', distance: 1 } as unknown as OffsetParams;
      expect(await rejectionCode(() => kernelOf().offsetCurves(notBoolean))).toBe('invalid-input');
    });

    it('creates no handle', async () => {
      await offsetOf({ curves: [p, q], closed: false, distance: 1 });
      expect(await kernelOf().liveHandleCount()).toBe(0);
    });

    it('changing the input right after the call, before await, does not change the result', async () => {
      const curves = [seg('p', [0, 0], [10, 0])];
      const params = { curves, closed: false, distance: 2 };
      const found = callWithoutThrow(() => kernelOf().offsetCurves(params));
      // The inputs are readonly; the test writes into them on purpose.
      Reflect.set(params, 'distance', 5);
      curves.push(seg('q', [10, 0], [10, 5]));
      expectOffsetClose(await found, [offsetLine('p', [0, -2], [10, -2])]);
    });
  });
}
