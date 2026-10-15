import { describe, expect, it } from 'vitest';
import { mat4 } from '@/core/math/mat4';
import { vec3, type Vec3 } from '@/core/math/vec3';

const expectVec = (actual: Vec3, expected: Vec3) => {
  expect(vec3.equals(actual, expected), `${actual.join(',')} ≠ ${expected.join(',')}`).toBe(true);
};

describe('mat4', () => {
  it('identity leaves points unchanged', () => {
    expect(mat4.transformPoint(mat4.identity(), [1, 2, 3])).toEqual([1, 2, 3]);
  });

  it('is column-major: translation lives in elements 12, 13, 14', () => {
    const m = mat4.translation([5, 6, 7]);
    expect([m[12], m[13], m[14], m[15]]).toEqual([5, 6, 7, 1]);
  });

  it('translation moves points', () => {
    expect(mat4.transformPoint(mat4.translation([1, 0, -2]), [1, 1, 1])).toEqual([2, 1, -1]);
  });

  it('rotation by 90° about Z maps X to Y (right-hand rule)', () => {
    const r = mat4.rotationAxisAngle([0, 0, 1], Math.PI / 2);
    expectVec(mat4.transformPoint(r, [1, 0, 0]), [0, 1, 0]);
    expectVec(mat4.transformPoint(r, [0, 0, 1]), [0, 0, 1]);
  });

  it('rotation accepts a non-unit axis', () => {
    const r = mat4.rotationAxisAngle([0, 0, 10], Math.PI);
    expectVec(mat4.transformPoint(r, [1, 0, 0]), [-1, 0, 0]);
  });

  it('multiply(a, b) applies b first, then a', () => {
    const t = mat4.translation([10, 0, 0]);
    const r = mat4.rotationAxisAngle([0, 0, 1], Math.PI / 2);
    // Rotate first, then translate.
    expectVec(mat4.transformPoint(mat4.multiply(t, r), [1, 0, 0]), [10, 1, 0]);
    // Translate first, then rotate.
    expectVec(mat4.transformPoint(mat4.multiply(r, t), [1, 0, 0]), [0, 11, 0]);
  });

  it('identity is neutral for multiply', () => {
    const r = mat4.rotationAxisAngle([1, 1, 0], 0.3);
    expect(mat4.multiply(mat4.identity(), r)).toEqual(r);
    expect(mat4.multiply(r, mat4.identity())).toEqual(r);
  });

  it('rejects a zero rotation axis', () => {
    expect(() => mat4.rotationAxisAngle([0, 0, 0], 1)).toThrow('zero vector');
  });

  it('keeps float64 precision', () => {
    const m = mat4.translation([0.1, 0, 0]);
    expect(mat4.transformPoint(m, [0.2, 0, 0])[0]).toBe(0.1 + 0.2);
  });

  it('does not mutate its inputs', () => {
    const a = mat4.translation([1, 2, 3]);
    const copy = [...a];
    mat4.multiply(a, a);
    mat4.transformPoint(a, [1, 1, 1]);
    expect([...a]).toEqual(copy);
  });
});
