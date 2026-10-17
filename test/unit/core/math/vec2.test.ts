import { describe, expect, it } from 'vitest';
import { mod2pi, TWO_PI, vec2 } from '@/core';

describe('vec2', () => {
  it('adds, subtracts, scales and halves component-wise', () => {
    expect(vec2.add([1, 2], [4, 5])).toEqual([5, 7]);
    expect(vec2.sub([4, 5], [1, 2])).toEqual([3, 3]);
    expect(vec2.scale([1, -2], 2)).toEqual([2, -4]);
    expect(vec2.mid([0, 2], [4, 6])).toEqual([2, 4]);
  });

  it('addScaled walks t times d from the origin', () => {
    expect(vec2.addScaled([1, 1], [2, 0], 0.5)).toEqual([2, 1]);
    expect(vec2.addScaled([1, 1], [0, 3], -1)).toEqual([1, -2]);
  });

  it('dot and cross; cross is positive when b is counter-clockwise from a', () => {
    expect(vec2.dot([1, 0], [0, 1])).toBe(0);
    expect(vec2.dot([1, 2], [1, 2])).toBe(5);
    expect(vec2.cross([1, 0], [0, 1])).toBe(1);
    expect(vec2.cross([0, 1], [1, 0])).toBe(-1);
  });

  it('length, dist and normalize', () => {
    expect(vec2.length([3, 4])).toBe(5);
    expect(vec2.dist([1, 1], [4, 5])).toBe(5);
    expect(vec2.normalize([0, 7])).toEqual([0, 1]);
    expect(vec2.length(vec2.normalize([1, 2]))).toBeCloseTo(1, 12);
  });

  it('normalize of the zero vector is a programmer error', () => {
    expect(() => vec2.normalize([0, 0])).toThrow('zero vector');
  });

  it('angleOf is atan2 in (−π, π]', () => {
    expect(vec2.angleOf([1, 0])).toBe(0);
    expect(vec2.angleOf([0, 1])).toBeCloseTo(Math.PI / 2, 15);
    expect(vec2.angleOf([-1, 0])).toBe(Math.PI);
    expect(vec2.angleOf([0, -1])).toBeCloseTo(-Math.PI / 2, 15);
  });

  it('distanceToSegment clamps the foot to the segment', () => {
    expect(vec2.distanceToSegment([1, 2], [0, 0], [2, 0])).toBe(2);
    expect(vec2.distanceToSegment([-3, 4], [0, 0], [2, 0])).toBe(5);
    expect(vec2.distanceToSegment([5, 4], [0, 0], [2, 0])).toBe(5);
  });

  it('distanceToSegment of a degenerate segment is the distance to its point', () => {
    expect(vec2.distanceToSegment([3, 4], [0, 0], [0, 0])).toBe(5);
  });

  it('returns fresh arrays', () => {
    const a = [1, 2] as const;
    expect(vec2.add(a, [0, 0])).not.toBe(a);
  });
});

describe('mod2pi', () => {
  it('maps any angle into [0, 2π)', () => {
    expect(mod2pi(0)).toBe(0);
    expect(mod2pi(TWO_PI)).toBe(0);
    expect(mod2pi(-Math.PI / 2)).toBeCloseTo((3 * Math.PI) / 2, 15);
    expect(mod2pi(5 * Math.PI)).toBeCloseTo(Math.PI, 14);
  });
});
