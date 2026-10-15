import { beforeAll, describe, expect, it } from 'vitest';
import { bspline, type Plane, type Vec2 } from '@/core';
import { kernelErrorCode, validateMeshData, type ProfileCurve, type ProfileLoop } from '@/kernel';
import { faceShape, type FaceInput } from '@/kernel-occt/face';
import { loadOcct, type Occt } from '@/kernel-occt/occt';
import { OcctKernelImpl } from '@/kernel-occt/occt-kernel-impl';

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

/**
 * Area of the face by BRepGProp.SurfaceProperties, the adaptive variant with a relative
 * precision: the fixed Gauss variant is off by about 2e-4 on a face bounded by a B-spline (M29).
 */
function areaOf(input: FaceInput): number {
  const shape = faceShape(oc, input);
  try {
    using props = new oc.GProp_GProps();
    oc.BRepGProp.SurfaceProperties(shape, props, 1e-9, false);
    return props.Mass();
  } finally {
    shape.delete();
  }
}

/**
 * M29: a cubic spline from (4, 3) to (0, 3) with an interior knot, waving above and below
 * y = 3 – the top of a rectangle [0, 4]×[0, 3].
 */
const WAVE: Extract<ProfileCurve, { kind: 'bspline' }> = {
  kind: 'bspline',
  degree: 3,
  poles: [
    [4, 3],
    [3, 5],
    [2, 1.5],
    [1, 4.5],
    [0, 3],
  ],
  knots: [0, 0, 0, 0, 0.4, 1, 1, 1, 1],
};

/** Signed area of a closed polygon (shoelace), positive counter-clockwise. */
function polygonArea(points: readonly Vec2[]): number {
  let twice = 0;
  points.forEach((p, i) => {
    const q = points[(i + 1) % points.length] ?? p;
    twice += p[0] * q[1] - q[0] * p[1];
  });
  return twice / 2;
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

  it('a rectangle with a spline side has the area of a fine tessellation (M29)', () => {
    const outer: ProfileLoop = [
      line([0, 0], [4, 0]),
      line([4, 0], [4, 3]),
      WAVE,
      line([0, 3], [0, 0]),
    ];
    // The tessellation runs from (4, 3) to (0, 3); the polygon closes over (0, 0) and (4, 0).
    const expected = polygonArea([[0, 0], [4, 0], ...bspline.tessellate(WAVE, 1e-9)]);
    expectRelativelyClose(areaOf({ plane: XY, outer, holes: [] }), expected, 1e-6);
  });

  it('a spline hole and a moved, tilted plane: the area of the tessellation too (M29)', () => {
    const s = Math.SQRT1_2;
    const plane: Plane = { origin: [1, 2, 3], xDir: [s, 0, s], normal: [-s, 0, s] };
    const hole: ProfileLoop = [
      line([0, 0], [4, 0]),
      line([4, 0], [4, 3]),
      WAVE,
      line([0, 3], [0, 0]),
    ];
    const area = areaOf({
      plane,
      outer: polygon([-1, -1], [5, -1], [5, 6], [-1, 6]),
      holes: [hole],
    });
    const holeArea = polygonArea([[0, 0], [4, 0], ...bspline.tessellate(WAVE, 1e-9)]);
    expectRelativelyClose(area, 42 - holeArea, 1e-6);
  });

  it.each([
    ['knots on [2, 7] with a double interior knot', [2, 2, 2, 2, 3, 3, 5, 7, 7, 7, 7]],
    ['an interior knot repeated degree times', [0, 0, 0, 0, 0.5, 0.5, 0.5, 1, 1, 1, 1]],
  ])('a spline with %s builds; area of its tessellation (M29)', (_, knots) => {
    const side: ProfileCurve = {
      kind: 'bspline',
      degree: 3,
      poles: [
        [4, 3],
        [3.5, 4],
        [3, 2.5],
        [2, 4],
        [1, 2.5],
        [0.5, 4],
        [0, 3],
      ],
      knots,
    };
    const outer: ProfileLoop = [
      line([0, 0], [4, 0]),
      line([4, 0], [4, 3]),
      side,
      line([0, 3], [0, 0]),
    ];
    const expected = polygonArea([[0, 0], [4, 0], ...bspline.tessellate({ ...side, knots }, 1e-9)]);
    expectRelativelyClose(areaOf({ plane: XY, outer, holes: [] }), expected, 1e-6);
  });

  it('a spline crossing another side of its loop rejects with operation-failed (M29)', async () => {
    // BRepCheck_Analyzer of the face finds the crossing; the adapter samples nothing itself.
    const kernel = new OcctKernelImpl(oc);
    const dipping: ProfileCurve = {
      ...WAVE,
      poles: [
        [4, 3],
        [3, -4],
        [2, 1.5],
        [1, 4.5],
        [0, 3],
      ],
    };
    const outer: ProfileLoop = [
      line([0, 0], [4, 0]),
      line([4, 0], [4, 3]),
      dipping,
      line([0, 3], [0, 0]),
    ];
    const e = await kernel.makeFace({ plane: XY, outer, holes: [] }).then(
      () => expect.fail('Expected makeFace to reject'),
      (err: unknown) => err,
    );
    expect(kernelErrorCode(e)).toBe('operation-failed');
    expect(await kernel.liveHandleCount()).toBe(0);
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
