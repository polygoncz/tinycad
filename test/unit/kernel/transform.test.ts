import { describe, expect, it } from 'vitest';
import { mat4, type Mat4 } from '@/core';
import { isRigidMotion } from '@/kernel/transform';

// prettier-ignore
const MIRROR_X: Mat4 = [
  -1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];

// prettier-ignore
const SCALE_2: Mat4 = [
  2, 0, 0, 0,
  0, 2, 0, 0,
  0, 0, 2, 0,
  0, 0, 0, 1,
];

// x' = x + 0.5·y: column 1 (the image of the y axis) gets an x component.
// prettier-ignore
const SHEAR: Mat4 = [
  1, 0, 0, 0,
  0.5, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];

// A projective bottom row: element (row 3, column 0) is at index 3.
// prettier-ignore
const PROJECTIVE: Mat4 = [
  1, 0, 0, 0.1,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];

// prettier-ignore
const NAN_TRANSLATION: Mat4 = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  Number.NaN, 0, 0, 1,
];

// prettier-ignore
const INFINITE_ROTATION: Mat4 = [
  Number.POSITIVE_INFINITY, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];

describe('isRigidMotion', () => {
  it('accepts the identity', () => {
    expect(isRigidMotion(mat4.identity())).toBe(true);
  });

  it('accepts a translation', () => {
    expect(isRigidMotion(mat4.translation([10, -2, 3.5]))).toBe(true);
  });

  it('accepts a rotation about an arbitrary axis combined with a translation', () => {
    const m = mat4.multiply(
      mat4.translation([1, 2, 3]),
      mat4.rotationAxisAngle([1, -2, 0.5], 1.234),
    );
    expect(isRigidMotion(m)).toBe(true);
  });

  it.each([
    ['a mirror (det −1)', MIRROR_X],
    ['a uniform scale 2', SCALE_2],
    ['a shear', SHEAR],
    ['a non-affine bottom row', PROJECTIVE],
    ['a NaN', NAN_TRANSLATION],
    ['an Infinity', INFINITE_ROTATION],
  ])('rejects %s', (_, m) => {
    expect(isRigidMotion(m)).toBe(false);
  });

  it('rejects a point reflection (orthonormal, det −1)', () => {
    // Mirror in x after a 180° turn about x = diag(−1, −1, −1).
    const m = mat4.multiply(MIRROR_X, mat4.rotationAxisAngle([1, 0, 0], Math.PI));
    expect(isRigidMotion(m)).toBe(false);
  });

  it('compares element-wise within the tolerance', () => {
    // prettier-ignore
    const almost: Mat4 = [
      1 + 1e-7, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ];
    expect(isRigidMotion(almost)).toBe(false);
    expect(isRigidMotion(almost, 1e-6)).toBe(true);
  });
});
