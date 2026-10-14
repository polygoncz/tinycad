import { describe, expect, it } from 'vitest';
import { quat, type Quat } from './quat';
import { vec3, type Vec3 } from './vec3';

const X: Vec3 = [1, 0, 0];
const Y: Vec3 = [0, 1, 0];
const Z: Vec3 = [0, 0, 1];
const TOL = 1e-12;

function expectVec(actual: Vec3, expected: Vec3): void {
  expect(vec3.equals(actual, expected, TOL)).toBe(true);
}

/** Same rotation: q and −q rotate every vector the same way. */
function expectSameRotation(a: Quat, b: Quat): void {
  for (const v of [X, Y, Z]) expectVec(quat.rotate(a, v), quat.rotate(b, v));
}

describe('quat', () => {
  it('identity rotates nothing', () => {
    expect(quat.identity()).toEqual([0, 0, 0, 1]);
    expectVec(quat.rotate(quat.identity(), [1, 2, 3]), [1, 2, 3]);
  });

  it('fromAxisAngle is right-handed: Z by π/2 turns X to Y', () => {
    expectVec(quat.rotate(quat.fromAxisAngle(Z, Math.PI / 2), X), Y);
  });

  it('fromAxisAngle normalizes the axis', () => {
    expectVec(quat.rotate(quat.fromAxisAngle([0, 0, 5], Math.PI / 2), X), Y);
  });

  it('fromAxisAngle of the zero axis is a programmer error', () => {
    expect(() => quat.fromAxisAngle([0, 0, 0], 1)).toThrow('zero vector');
  });

  it('multiply applies the right operand first', () => {
    const aboutZ = quat.fromAxisAngle(Z, Math.PI / 2); // X → Y
    const aboutX = quat.fromAxisAngle(X, Math.PI / 2); // Y → Z
    // First about Z (X → Y), then about X (Y → Z).
    expectVec(quat.rotate(quat.multiply(aboutX, aboutZ), X), Z);
    // The other order: X stays under the X rotation, then turns to Y.
    expectVec(quat.rotate(quat.multiply(aboutZ, aboutX), X), Y);
  });

  it('fromBasis turns the axes x, y, z to the given basis', () => {
    const bases: readonly (readonly [Vec3, Vec3, Vec3])[] = [
      [X, Y, Z],
      [X, Z, [0, -1, 0]], // front view
      [[0, -1, 0], Z, [-1, 0, 0]], // left view
      [[-1, 0, 0], [0, -1, 0], Z], // rotated by π about Z (trace −1 branch)
      [Y, X, [0, 0, -1]], // bottom-like
      [
        vec3.normalize([1, 1, 0]),
        vec3.normalize([-1, 1, 1]),
        vec3.cross(vec3.normalize([1, 1, 0]), vec3.normalize([-1, 1, 1])),
      ],
    ];
    for (const [right, up, direction] of bases) {
      const q = quat.fromBasis(right, up, direction);
      expectVec(quat.rotate(q, X), right);
      expectVec(quat.rotate(q, Y), up);
      expectVec(quat.rotate(q, Z), direction);
    }
  });

  it('slerp returns the end values at t = 0 and t = 1', () => {
    const a = quat.fromAxisAngle(Z, 0.3);
    const b = quat.fromAxisAngle(X, 1.2);
    expectSameRotation(quat.slerp(a, b, 0), a);
    expectSameRotation(quat.slerp(a, b, 1), b);
  });

  it('slerp goes the shortest way for opposite signs (q and −q)', () => {
    const a = quat.identity();
    const b = quat.fromAxisAngle(Z, Math.PI / 2);
    const negB: Quat = [-b[0], -b[1], -b[2], -b[3]];
    const half = quat.slerp(a, negB, 0.5);
    // The halfway rotation is π/4 about Z, not the long way round (3π/4 the other way).
    expectSameRotation(half, quat.fromAxisAngle(Z, Math.PI / 4));
    expectSameRotation(quat.slerp(a, negB, 1), b);
  });

  it('angle of a quarter turn is π/2, of the same rotation 0, of q and −q 0', () => {
    const a = quat.fromAxisAngle(Y, 0.4);
    const b = quat.multiply(quat.fromAxisAngle(X, Math.PI / 2), a);
    expect(quat.angle(a, b)).toBeCloseTo(Math.PI / 2, 12);
    expect(quat.angle(a, a)).toBeCloseTo(0, 12);
    expect(quat.angle(a, [-a[0], -a[1], -a[2], -a[3]])).toBeCloseTo(0, 12);
    expect(quat.angle(quat.identity(), quat.fromAxisAngle(Z, Math.PI))).toBeCloseTo(Math.PI, 12);
  });

  it('normalize gives unit length; the zero quaternion is a programmer error', () => {
    const q = quat.normalize([0, 0, 2, 2]);
    expect(Math.hypot(...q)).toBeCloseTo(1, 15);
    expect(() => quat.normalize([0, 0, 0, 0])).toThrow('zero quaternion');
  });

  it('returns new plain float64 arrays and does not touch the inputs', () => {
    const a: Quat = [0, 0, 0, 1];
    const b = quat.fromAxisAngle(Z, 0.1);
    const results = [
      quat.identity(),
      quat.multiply(a, b),
      quat.slerp(a, b, 0.5),
      quat.normalize(b),
      quat.fromBasis(X, Y, Z),
    ];
    for (const r of results) {
      expect(Array.isArray(r)).toBe(true);
      expect(r).not.toBe(a);
      expect(r).not.toBe(b);
    }
    expect(Array.isArray(quat.rotate(a, X))).toBe(true);
    expect(a).toEqual([0, 0, 0, 1]);
    // float32 would round sin(0.05) to about 7 digits.
    expect(b[2]).toBe(Math.sin(0.05));
  });
});
