import { describe, expect, it } from 'vitest';
import { plane, type Plane, type Vec2 } from '@/core/math/plane';
import { vec3, type Vec3 } from '@/core/math/vec3';

// Frames of the origin planes, table in spec 12 (Roviny a počátek).
const XY: Plane = { origin: [0, 0, 0], xDir: [1, 0, 0], normal: [0, 0, 1] };
const XZ: Plane = { origin: [0, 0, 0], xDir: [1, 0, 0], normal: [0, -1, 0] };
const YZ: Plane = { origin: [0, 0, 0], xDir: [0, 1, 0], normal: [1, 0, 0] };

// A general orthonormal frame with a shifted origin.
const s = Math.SQRT1_2;
const TILTED: Plane = { origin: [3, -2, 5], xDir: [s, s, 0], normal: [0, 0, 1] };
const OBLIQUE: Plane = {
  origin: [1, 2, 3],
  xDir: vec3.normalize([1, -1, 0]),
  normal: vec3.normalize([1, 1, 1]),
};

// Component-wise comparison; toEqual would tell 0 from -0.
function expectVec3(actual: Vec3 | null, expected: Vec3): void {
  expect(actual).not.toBeNull();
  if (actual === null) return;
  expected.forEach((c, i) => {
    expect(actual[i]).toBeCloseTo(c, 12);
  });
}

function expectVec2(actual: Vec2, expected: Vec2): void {
  expected.forEach((c, i) => {
    expect(actual[i]).toBeCloseTo(c, 12);
  });
}

describe('plane', () => {
  it('yDir = normal × xDir: +Y, +Z, +Z for the origin planes', () => {
    expectVec3(plane.yDir(XY), [0, 1, 0]);
    expectVec3(plane.yDir(XZ), [0, 0, 1]);
    expectVec3(plane.yDir(YZ), [0, 0, 1]);
  });

  it('toWorld maps local axes onto xDir and yDir from the origin', () => {
    expectVec3(plane.toWorld(XZ, [2, 3]), [2, 0, 3]);
    expectVec3(plane.toWorld(YZ, [2, 3]), [0, 2, 3]);
    expectVec3(plane.toWorld(TILTED, [0, 0]), [3, -2, 5]);
  });

  it('toLocal(toWorld(v)) = v for origin planes and general frames', () => {
    const points: readonly Vec2[] = [
      [0, 0],
      [1, 0],
      [0, 1],
      [-4.5, 7.25],
    ];
    for (const p of [XY, XZ, YZ, TILTED, OBLIQUE]) {
      for (const v of points) expectVec2(plane.toLocal(p, plane.toWorld(p, v)), v);
    }
  });

  it('toLocal is a perpendicular projection', () => {
    expectVec2(plane.toLocal(XY, [2, 3, 99]), [2, 3]);
    expectVec2(plane.toLocal(XZ, [2, 99, 3]), [2, 3]);
  });

  it('returns new arrays', () => {
    const v: Vec2 = [1, 2];
    const w = plane.toWorld(XY, v);
    expect(plane.toLocal(XY, w)).not.toBe(v);
    expect(plane.yDir(XY)).not.toBe(XY.normal);
  });

  describe('intersectRay', () => {
    it('perpendicular ray hits the foot point', () => {
      const hit = plane.intersectRay(TILTED, { origin: [1, 1, 10], direction: [0, 0, -1] });
      expectVec3(hit, [1, 1, 5]);
    });

    it('oblique ray, direction need not be unit', () => {
      const hit = plane.intersectRay(XY, { origin: [0, 0, 4], direction: [2, 0, -4] });
      expectVec3(hit, [2, 0, 0]);
    });

    it('intersection behind the ray origin is returned too', () => {
      const hit = plane.intersectRay(XY, { origin: [1, 2, 3], direction: [0, 0, 1] });
      expectVec3(hit, [1, 2, 0]);
    });

    it('parallel ray → null', () => {
      expect(plane.intersectRay(XY, { origin: [0, 0, 1], direction: [1, 1, 0] })).toBeNull();
      expect(plane.intersectRay(XY, { origin: [0, 0, 0], direction: [1, 0, 0] })).toBeNull();
    });
  });

  describe('isOrthonormal', () => {
    it('valid frames', () => {
      for (const p of [XY, XZ, YZ, TILTED, OBLIQUE]) expect(plane.isOrthonormal(p)).toBe(true);
    });

    it('non-unit xDir or normal', () => {
      expect(plane.isOrthonormal({ ...XY, xDir: [2, 0, 0] })).toBe(false);
      expect(plane.isOrthonormal({ ...XY, normal: [0, 0, 0.5] })).toBe(false);
    });

    it('non-perpendicular axes', () => {
      expect(plane.isOrthonormal({ ...XY, xDir: [s, 0, s] })).toBe(false);
    });

    it('NaN or infinity anywhere → false', () => {
      expect(plane.isOrthonormal({ ...XY, xDir: [NaN, 0, 0] })).toBe(false);
      expect(plane.isOrthonormal({ ...XY, normal: [0, 0, NaN] })).toBe(false);
      expect(plane.isOrthonormal({ ...XY, origin: [0, NaN, 0] })).toBe(false);
      expect(plane.isOrthonormal({ ...XY, origin: [Infinity, 0, 0] })).toBe(false);
    });

    it('custom tolerance', () => {
      const almost: Plane = { ...XY, xDir: [1 + 1e-6, 0, 0] };
      expect(plane.isOrthonormal(almost)).toBe(false);
      expect(plane.isOrthonormal(almost, 1e-5)).toBe(true);
    });
  });
});
