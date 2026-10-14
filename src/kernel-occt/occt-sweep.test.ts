import { beforeAll, describe, expect, it } from 'vitest';
import type { Plane, Vec2, Vec3 } from '@/core';
import {
  kernelErrorCode,
  validateMeshData,
  type MeshData,
  type ProfileCurve,
  type ProfileLoop,
} from '@/kernel';
import { loadOcct, type Occt } from './occt';
import { OcctKernelImpl } from './occt-kernel-impl';
import { createInThreadOcctKernel } from './testing';

// What the OCCT adapter does beyond the contract (spec 06, "Testy", M13): the topology and the
// volume of prisms and solids of revolution, which the AABB fake cannot have.

let oc: Occt;

beforeAll(async () => {
  oc = await loadOcct();
});

const FINE = { linearDeflection: 0.01, angularDeflection: 0.05 };
const XY: Plane = { origin: [0, 0, 0], xDir: [1, 0, 0], normal: [0, 0, 1] };
/** XZ through the origin: x → +X, y → +Z. */
const XZ: Plane = { origin: [0, 0, 0], xDir: [1, 0, 0], normal: [0, -1, 0] };
const Z_AXIS = { origin: [0, 0, 0], direction: [0, 0, 1] } as const;

const line = (from: Vec2, to: Vec2): ProfileCurve => ({ kind: 'line', from, to });

function polygon(...corners: Vec2[]): ProfileLoop {
  return corners.map((p, i) => line(p, corners[(i + 1) % corners.length] ?? p));
}

function faceCount(mesh: MeshData): number {
  return mesh.faceRanges.length / 3;
}

/** Volume enclosed by the triangles (divergence theorem): Σ a · (b × c) / 6. */
function volume(mesh: MeshData): number {
  const p = (i: number): Vec3 => [
    mesh.positions[3 * i] ?? Number.NaN,
    mesh.positions[3 * i + 1] ?? Number.NaN,
    mesh.positions[3 * i + 2] ?? Number.NaN,
  ];
  let sum = 0;
  for (let t = 0; t < mesh.indices.length / 3; t++) {
    const a = p(mesh.indices[3 * t] ?? Number.NaN);
    const b = p(mesh.indices[3 * t + 1] ?? Number.NaN);
    const c = p(mesh.indices[3 * t + 2] ?? Number.NaN);
    sum +=
      a[0] * (b[1] * c[2] - b[2] * c[1]) +
      a[1] * (b[2] * c[0] - b[0] * c[2]) +
      a[2] * (b[0] * c[1] - b[1] * c[0]);
  }
  return sum / 6;
}

function expectWithinPercent(actual: number, expected: number, percent: number): void {
  expect(Math.abs(actual - expected) / Math.abs(expected)).toBeLessThanOrEqual(percent / 100);
}

/** The mesh of the shape; it must pass validateMeshData. */
async function meshOf(kernel: OcctKernelImpl, shape: Parameters<OcctKernelImpl['tessellate']>[0]) {
  const mesh = await kernel.tessellate(shape, FINE);
  expect(validateMeshData(mesh)).toEqual([]);
  return mesh;
}

describe('OcctKernelImpl.extrude (M13)', () => {
  it('a prism of a square 10 × 10 by 5 has 6 faces and the volume 500', async () => {
    const kernel = new OcctKernelImpl(oc);
    const face = await kernel.makeFace({
      plane: XY,
      outer: polygon([0, 0], [10, 0], [10, 10], [0, 10]),
      holes: [],
    });
    const { shape } = await kernel.extrude(face.shape, [0, 0, 1], 5);
    const mesh = await meshOf(kernel, shape);
    expect(faceCount(mesh)).toBe(6);
    expectWithinPercent(volume(mesh), 500, 1);
  });

  it('a prism of a square with a circular hole has 7 faces and the volume (100 − 4π) · 5', async () => {
    const kernel = new OcctKernelImpl(oc);
    const face = await kernel.makeFace({
      plane: XY,
      outer: polygon([0, 0], [10, 0], [10, 10], [0, 10]),
      holes: [[{ kind: 'circle', center: [5, 5], radius: 2 }]],
    });
    const { shape } = await kernel.extrude(face.shape, [0, 0, 1], 5);
    const mesh = await meshOf(kernel, shape);
    expect(faceCount(mesh)).toBe(7);
    expectWithinPercent(volume(mesh), (100 - 4 * Math.PI) * 5, 1);
  });

  it('releasing the profile leaves the prism valid', async () => {
    const kernel = new OcctKernelImpl(oc);
    const face = await kernel.makeFace({
      plane: XY,
      outer: polygon([0, 0], [10, 0], [10, 10], [0, 10]),
      holes: [],
    });
    const { shape } = await kernel.extrude(face.shape, [0, 0, 1], 5);
    await kernel.release([face.shape]);
    expectWithinPercent(volume(await meshOf(kernel, shape)), 500, 1);
  });
});

describe('OcctKernelImpl.revolve (M13)', () => {
  /** Rectangle x ∈ [x0, x1], z ∈ [0, 10] in XZ. */
  async function aRectangle(kernel: OcctKernelImpl, x0: number, x1: number) {
    const face = await kernel.makeFace({
      plane: XZ,
      outer: polygon([x0, 0], [x1, 0], [x1, 10], [x0, 10]),
      holes: [],
    });
    return face.shape;
  }

  it('a rectangle x ∈ [5, 10] by 2π has 4 faces and the volume 750π', async () => {
    const kernel = new OcctKernelImpl(oc);
    const { shape } = await kernel.revolve(await aRectangle(kernel, 5, 10), Z_AXIS, 2 * Math.PI);
    const mesh = await meshOf(kernel, shape);
    expect(faceCount(mesh)).toBe(4);
    expectWithinPercent(volume(mesh), 750 * Math.PI, 1);
  });

  it('the same rectangle by π/2 has 6 faces and a quarter of the volume', async () => {
    const kernel = new OcctKernelImpl(oc);
    const { shape } = await kernel.revolve(await aRectangle(kernel, 5, 10), Z_AXIS, Math.PI / 2);
    const mesh = await meshOf(kernel, shape);
    expect(faceCount(mesh)).toBe(6);
    expectWithinPercent(volume(mesh), (750 * Math.PI) / 4, 1);
  });

  it('an axis on an edge of the profile is valid: x ∈ [0, 5] by 2π has the volume 250π', async () => {
    const kernel = new OcctKernelImpl(oc);
    const { shape } = await kernel.revolve(await aRectangle(kernel, 0, 5), Z_AXIS, 2 * Math.PI);
    expectWithinPercent(volume(await meshOf(kernel, shape)), 250 * Math.PI, 1);
  });

  it('an axis through the profile rejects with operation-failed, no handle', async () => {
    const kernel = new OcctKernelImpl(oc);
    const face = await kernel.makeFace({
      plane: XZ,
      outer: polygon([-5, 0], [10, 0], [10, 10], [-5, 10]),
      holes: [],
    });
    const e = await kernel.revolve(face.shape, Z_AXIS, 2 * Math.PI).then(
      () => expect.fail('Expected revolve to reject'),
      (err: unknown) => err,
    );
    expect(kernelErrorCode(e)).toBe('operation-failed');
    expect(await kernel.liveHandleCount()).toBe(1);
  });

  it('returns no roles and no history (M14)', async () => {
    const kernel = new OcctKernelImpl(oc);
    const profile = await aRectangle(kernel, 5, 10);
    const results = [
      await kernel.revolve(profile, Z_AXIS, Math.PI),
      await kernel.extrude(profile, [0, -1, 0], 1),
    ];
    for (const result of results) {
      expect(result.roles).toBeUndefined();
      expect(result.history).toBeUndefined();
    }
  });
});

describe('createInThreadOcctKernel', () => {
  it('is an OCCT kernel in the calling thread: a real prism volume', async () => {
    const kernel = await createInThreadOcctKernel();
    const face = await kernel.makeFace({
      plane: XY,
      outer: [{ kind: 'circle', center: [0, 0], radius: 1 }],
      holes: [],
    });
    const { shape } = await kernel.extrude(face.shape, [0, 0, 1], 2);
    const mesh = await kernel.tessellate(shape, FINE);
    expect(faceCount(mesh)).toBe(3);
    expectWithinPercent(volume(mesh), 2 * Math.PI, 1);
  });
});
