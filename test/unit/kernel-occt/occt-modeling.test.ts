import { beforeAll, describe, expect, it } from 'vitest';
import { mat4, type Vec3 } from '@/core';
import { kernelErrorCode, validateMeshData, type MeshData } from '@/kernel';
import { loadOcct, type Occt } from '@/kernel-occt/occt';
import { OcctKernelImpl } from '@/kernel-occt/occt-kernel-impl';

// What the OCCT adapter does beyond the contract (spec 06, "Testy", M11): the topology and the
// volume of real modelling results, which the AABB fake cannot have.

let oc: Occt;

beforeAll(async () => {
  oc = await loadOcct();
});

const FINE = { linearDeflection: 0.01, angularDeflection: 0.1 };

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

describe('OcctKernelImpl modelling (M11)', () => {
  it('a cylinder has 3 faces and the volume πr²h within 1 %', async () => {
    const kernel = new OcctKernelImpl(oc);
    const { shape } = await kernel.makeCylinder({
      base: [1, 2, 3],
      axis: [1, 1, 1],
      radius: 2,
      height: 5,
    });
    const mesh = await kernel.tessellate(shape, FINE);
    expect(validateMeshData(mesh)).toEqual([]);
    expect(faceCount(mesh)).toBe(3);
    expectWithinPercent(volume(mesh), Math.PI * 4 * 5, 1);
  });

  it('a moved and turned box keeps 6 faces and its volume', async () => {
    const kernel = new OcctKernelImpl(oc);
    const box = await kernel.makeBox({ origin: [1, -2, 3], size: [2, 3, 4] });
    const m = mat4.multiply(mat4.translation([5, -1, 2]), mat4.rotationAxisAngle([1, 2, 3], 0.7));
    const { shape } = await kernel.transform(box.shape, m);
    const mesh = await kernel.tessellate(shape, FINE);
    expect(validateMeshData(mesh)).toEqual([]);
    expect(faceCount(mesh)).toBe(6);
    expectWithinPercent(volume(mesh), 24, 1e-4);
  });

  it('a box minus a cylinder through it has 7 faces and the volume box − πr²h within 1 %', async () => {
    const kernel = new OcctKernelImpl(oc);
    const box = await kernel.makeBox({ origin: [0, 0, 0], size: [10, 10, 10] });
    const hole = await kernel.makeCylinder({
      base: [5, 5, -1],
      axis: [0, 0, 1],
      radius: 2,
      height: 12,
    });
    const { shape } = await kernel.boolean('subtract', [box.shape], [hole.shape]);
    const mesh = await kernel.tessellate(shape, FINE);
    expect(validateMeshData(mesh)).toEqual([]);
    expect(faceCount(mesh)).toBe(7);
    expectWithinPercent(volume(mesh), 1000 - Math.PI * 4 * 10, 1);
  });

  it('subtract with a tool covering the whole target rejects with operation-failed', async () => {
    const kernel = new OcctKernelImpl(oc);
    const target = await kernel.makeBox({ origin: [1, 1, 1], size: [1, 1, 1] });
    const tool = await kernel.makeBox({ origin: [0, 0, 0], size: [3, 3, 3] });
    const e = await kernel.boolean('subtract', [target.shape], [tool.shape]).then(
      () => expect.fail('Expected boolean to reject'),
      (err: unknown) => err,
    );
    expect(kernelErrorCode(e)).toBe('operation-failed');
    expect(await kernel.liveHandleCount()).toBe(2);
  });

  it('union of two separate boxes has 12 faces', async () => {
    const kernel = new OcctKernelImpl(oc);
    const a = await kernel.makeBox({ origin: [0, 0, 0], size: [1, 1, 1] });
    const b = await kernel.makeBox({ origin: [5, 0, 0], size: [1, 1, 1] });
    const { shape } = await kernel.boolean('union', [a.shape], [b.shape]);
    const mesh = await kernel.tessellate(shape, FINE);
    expect(validateMeshData(mesh)).toEqual([]);
    expect(faceCount(mesh)).toBe(12);
  });

  it('releasing the input of a transform leaves the result valid', async () => {
    const kernel = new OcctKernelImpl(oc);
    const box = await kernel.makeBox({ origin: [0, 0, 0], size: [1, 2, 3] });
    const moved = await kernel.transform(box.shape, mat4.translation([10, 0, 0]));
    await kernel.release([box.shape]);
    const mesh = await kernel.tessellate(moved.shape, FINE);
    expect(validateMeshData(mesh)).toEqual([]);
    expectWithinPercent(volume(mesh), 6, 1e-4);
  });
});
