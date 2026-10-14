import { beforeAll, describe, expect, it } from 'vitest';
import type { Plane, Vec2 } from '@/core';
import { kernelErrorCode, validateMeshData, type ProfileCurve, type ProfileLoop } from '@/kernel';
import { faceShape, type FaceInput } from './face';
import { loadOcct, type Occt } from './occt';
import { OcctKernelImpl } from './occt-kernel-impl';

// What the OCCT adapter does beyond the contract (spec 06, "Testy", M12): the real area of a
// face, which the AABB fake cannot have, and a loop OCCT cannot build a face from.

let oc: Occt;

beforeAll(async () => {
  oc = await loadOcct();
});

const XY: Plane = { origin: [0, 0, 0], xDir: [1, 0, 0], normal: [0, 0, 1] };
const QUALITY = { linearDeflection: 0.01, angularDeflection: 0.1 };

const line = (from: Vec2, to: Vec2): ProfileCurve => ({ kind: 'line', from, to });

function polygon(...corners: Vec2[]): ProfileLoop {
  return corners.map((p, i) => line(p, corners[(i + 1) % corners.length] ?? p));
}

/** Rectangle [−2, 0]×[−1, 1] closed on the right by a half circle about the origin. */
function dLoop(ccw: boolean): ProfileLoop {
  return [
    line([-2, -1], [0, -1]),
    { kind: 'arc', center: [0, 0], from: [0, -1], to: [0, 1], ccw },
    line([0, 1], [-2, 1]),
    line([-2, 1], [-2, -1]),
  ];
}

/** Area of the face by BRepGProp.SurfaceProperties. */
function areaOf(input: FaceInput): number {
  const shape = faceShape(oc, input);
  try {
    using props = new oc.GProp_GProps();
    oc.BRepGProp.SurfaceProperties(shape, props, false, false);
    return props.Mass();
  } finally {
    shape.delete();
  }
}

function expectRelativelyClose(actual: number, expected: number, tolerance: number): void {
  expect(Math.abs(actual - expected) / Math.abs(expected)).toBeLessThanOrEqual(tolerance);
}

describe('OcctKernelImpl.makeFace (M12)', () => {
  it('a face has one face in its mesh', async () => {
    const kernel = new OcctKernelImpl(oc);
    const { shape } = await kernel.makeFace({
      plane: XY,
      outer: polygon([0, 0], [4, 0], [4, 4], [0, 4]),
      holes: [[{ kind: 'circle', center: [2, 2], radius: 1 }]],
    });
    const mesh = await kernel.tessellate(shape, QUALITY);
    expect(validateMeshData(mesh)).toEqual([]);
    expect(mesh.faceRanges.length / 3).toBe(1);
  });

  it('the area of a square with a circular hole is a² − πr²', () => {
    const area = areaOf({
      plane: XY,
      outer: polygon([0, 0], [4, 0], [4, 4], [0, 4]),
      holes: [[{ kind: 'circle', center: [2, 2], radius: 1 }]],
    });
    expectRelativelyClose(area, 16 - Math.PI, 1e-6);
  });

  it('the hole may have either orientation', () => {
    const area = areaOf({
      plane: XY,
      outer: polygon([0, 0], [4, 0], [4, 4], [0, 4]),
      holes: [polygon([1, 1], [1, 3], [3, 3], [3, 1]), polygon([3.5, 0.5], [3.8, 0.5], [3.8, 0.8])],
    });
    expectRelativelyClose(area, 16 - 4 - 0.045, 1e-6);
  });

  it('the area of a D is the rectangle plus the half circle', () => {
    expectRelativelyClose(
      areaOf({ plane: XY, outer: dLoop(true), holes: [] }),
      4 + Math.PI / 2,
      1e-6,
    );
  });

  it('a clockwise arc bulges the other way: the rectangle minus the half circle', () => {
    expectRelativelyClose(
      areaOf({ plane: XY, outer: dLoop(false), holes: [] }),
      4 - Math.PI / 2,
      1e-6,
    );
  });

  it('a face in a moved, tilted plane keeps its area', () => {
    const s = Math.SQRT1_2;
    const plane: Plane = { origin: [1, 2, 3], xDir: [s, s, 0], normal: [0, 0, 1] };
    const area = areaOf({ plane, outer: polygon([0, 0], [3, 0], [3, 2], [0, 2]), holes: [] });
    expectRelativelyClose(area, 6, 1e-6);
  });

  it('a self-intersecting loop (a bow tie) rejects with operation-failed, no handle', async () => {
    const kernel = new OcctKernelImpl(oc);
    const bowTie = polygon([0, 0], [2, 2], [2, 0], [0, 2]);
    const e = await kernel.makeFace({ plane: XY, outer: bowTie, holes: [] }).then(
      () => expect.fail('Expected makeFace to reject'),
      (err: unknown) => err,
    );
    expect(kernelErrorCode(e)).toBe('operation-failed');
    expect(await kernel.liveHandleCount()).toBe(0);
  });
});
