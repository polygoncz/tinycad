import { describe, expect, it } from 'vitest';
import { vec3, type Vec3 } from '@/core/math/vec3';

const X: Vec3 = [1, 0, 0];
const Y: Vec3 = [0, 1, 0];
const Z: Vec3 = [0, 0, 1];

describe('vec3', () => {
  it('adds, subtracts and scales component-wise', () => {
    expect(vec3.add([1, 2, 3], [4, 5, 6])).toEqual([5, 7, 9]);
    expect(vec3.sub([4, 5, 6], [1, 2, 3])).toEqual([3, 3, 3]);
    expect(vec3.scale([1, -2, 3], 2)).toEqual([2, -4, 6]);
  });

  it('dot of orthogonal axes is zero, of a vector with itself its squared length', () => {
    expect(vec3.dot(X, Y)).toBe(0);
    expect(vec3.dot([1, 2, 3], [1, 2, 3])).toBe(14);
  });

  it('cross follows the right-hand rule', () => {
    expect(vec3.cross(X, Y)).toEqual(Z);
    expect(vec3.cross(Y, Z)).toEqual(X);
    expect(vec3.cross(Y, X)).toEqual([0, 0, -1]);
  });

  it('length and normalize', () => {
    expect(vec3.length([3, 4, 0])).toBe(5);
    expect(vec3.normalize([0, 0, 7])).toEqual(Z);
    expect(vec3.length(vec3.normalize([1, 2, 3]))).toBeCloseTo(1, 12);
  });

  it('normalize of the zero vector is a programmer error', () => {
    expect(() => vec3.normalize([0, 0, 0])).toThrow('zero vector');
  });

  it('equals uses a tolerance', () => {
    expect(vec3.equals([0.1 + 0.2, 0, 0], [0.3, 0, 0])).toBe(true);
    expect(vec3.equals([1, 0, 0], [1.001, 0, 0])).toBe(false);
    expect(vec3.equals([1, 0, 0], [1.001, 0, 0], 0.01)).toBe(true);
  });

  it('computes in float64, not float32', () => {
    // A Float32Array result would give 0.30000001192092896.
    expect(vec3.add([0.1, 0, 0], [0.2, 0, 0])[0]).toBe(0.1 + 0.2);
  });

  it('returns plain arrays, not typed arrays', () => {
    expect(Array.isArray(vec3.cross([1, 0, 0], [0, 1, 0]))).toBe(true);
  });

  it('does not mutate its inputs', () => {
    const a: Vec3 = [1, 2, 3];
    vec3.add(a, a);
    vec3.normalize(a);
    expect(a).toEqual([1, 2, 3]);
  });
});
