import { describe, expect, it } from 'vitest';
import { vec3, type Vec3 } from '@/core';
import {
  occlusionTolerance,
  projectSegments,
  segmentPoint,
  toNdc,
  triangleNormal,
} from './pick-math';

/**
 * Column-major orthographic projection (as THREE.OrthographicCamera builds it) for a camera at
 * the origin looking down −Z: x, y in [−10, 10], depth from near 1 to far 100.
 */
const ORTHO = (() => {
  const [l, r, t, b, n, f] = [-10, 10, 10, -10, 1, 100];
  // prettier-ignore
  return [
    2 / (r - l), 0, 0, 0,
    0, 2 / (t - b), 0, 0,
    0, 0, -2 / (f - n), 0,
    -(r + l) / (r - l), -(t + b) / (t - b), -(f + n) / (f - n), 1,
  ];
})();

const expectVec = (actual: Vec3, expected: Vec3) => {
  expect(vec3.equals(actual, expected, 1e-6)).toBe(true);
};

describe('toNdc', () => {
  it('maps the canvas corners and centre to NDC with y up', () => {
    expect(toNdc(100, 50, 200, 100)).toEqual({ x: 0, y: 0 });
    expect(toNdc(0, 0, 200, 100)).toEqual({ x: -1, y: 1 });
    expect(toNdc(200, 100, 200, 100)).toEqual({ x: 1, y: -1 });
  });
});

describe('triangleNormal', () => {
  const a: Vec3 = [0, 0, 0];
  const b: Vec3 = [2, 0, 0];
  const c: Vec3 = [0, 2, 0];

  it('points along +Z for a counter-clockwise triangle in the XY plane', () => {
    expectVec(triangleNormal(a, b, c, [0, 0, -1]), [0, 0, 1]);
  });

  it('does not depend on the direction of the ray', () => {
    expectVec(triangleNormal(a, b, c, [0, 0, 1]), [0, 0, 1]);
    expectVec(triangleNormal(a, b, c, [1, -2, 0.5]), [0, 0, 1]);
  });

  it('follows the winding: a clockwise triangle points along -Z', () => {
    expectVec(triangleNormal(a, c, b, [0, 0, -1]), [0, 0, -1]);
  });

  it('is a unit vector regardless of the triangle size', () => {
    const n = triangleNormal([0, 0, 0], [0, 5, 0], [0, 0, 5], [-3, 1, 1]);
    expectVec(n, [1, 0, 0]);
  });

  it('falls back to the reversed ray for a degenerate triangle', () => {
    expectVec(triangleNormal(a, b, [4, 0, 0], [0, 0, -2]), [0, 0, 1]);
  });
});

describe('projectSegments', () => {
  it('projects segments to CSS px with y down', () => {
    const screen = projectSegments(new Float32Array([0, 0, -50, 10, 10, -50]), ORTHO, 200, 100);
    expect([...screen]).toEqual([100, 50, 200, 0]);
  });

  it('marks a segment with an end in front of near or behind far as NaN', () => {
    const screen = projectSegments(
      new Float32Array([0, 0, -0.5, 1, 1, -50, 0, 0, -50, 1, 1, -150]),
      ORTHO,
      200,
      100,
    );
    expect([...screen].every(Number.isNaN)).toBe(true);
  });

  it('marks a segment wholly outside the view as NaN, but keeps one partly outside', () => {
    const screen = projectSegments(
      new Float32Array([-20, 0, -50, -11, 5, -50, -20, 0, -50, 5, 0, -50]),
      ORTHO,
      200,
      100,
    );
    expect([...screen.subarray(0, 4)].every(Number.isNaN)).toBe(true);
    expect(screen[4]).toBeCloseTo(-100);
    expect(screen[6]).toBeCloseTo(150);
  });

  it('returns four numbers per segment', () => {
    expect(projectSegments(new Float32Array(0), ORTHO, 200, 100)).toHaveLength(0);
    expect(projectSegments(new Float32Array(18), ORTHO, 200, 100)).toHaveLength(12);
  });
});

describe('segmentPoint', () => {
  it('interpolates along the segment', () => {
    const positions = new Float32Array([9, 9, 9, 9, 9, 9, 0, 0, 0, 10, 20, -4]);
    expectVec(segmentPoint(positions, 1, 0.25), [2.5, 5, -1]);
    expectVec(segmentPoint(positions, 1, 0), [0, 0, 0]);
    expectVec(segmentPoint(positions, 1, 1), [10, 20, -4]);
  });
});

describe('occlusionTolerance', () => {
  it('is 1e-4 of the scene diagonal', () => {
    expect(occlusionTolerance({ min: [0, 0, 0], max: [100, 0, 0] })).toBeCloseTo(0.01);
  });

  it('has an absolute floor for an empty or tiny scene', () => {
    expect(occlusionTolerance(null)).toBeGreaterThan(0);
    expect(occlusionTolerance({ min: [0, 0, 0], max: [0, 0, 0] })).toBe(occlusionTolerance(null));
  });
});
