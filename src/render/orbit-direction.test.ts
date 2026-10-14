import { describe, expect, it } from 'vitest';
import { vec3 } from '@/core';
import { STANDARD_VIEWS, viewBasis, type StandardView } from './camera-math';
import { orbitDirection, VIEW_TILT, viewDirectionFor } from './orbit-direction';

describe('orbitDirection', () => {
  it.each<StandardView>(['iso', 'front', 'back', 'left', 'right'])(
    '%s is the standard direction unchanged',
    (view) => {
      expect(orbitDirection(view)).toEqual(STANDARD_VIEWS[view].direction);
    },
  );

  it.each<[StandardView, number]>([
    ['top', 1],
    ['bottom', -1],
  ])('%s is a unit vector tilted by VIEW_TILT off the Z axis', (view, zSign) => {
    const d = orbitDirection(view);
    expect(vec3.length(d)).toBeCloseTo(1, 12);
    expect(d[0]).toBe(0);
    expect(Math.acos(zSign * d[2])).toBeCloseTo(VIEW_TILT, 12);
  });

  it('top leans towards -Y and bottom towards +Y', () => {
    expect(orbitDirection('top')[1]).toBeLessThan(0);
    expect(orbitDirection('bottom')[1]).toBeGreaterThan(0);
  });

  it.each<StandardView>(['top', 'bottom'])(
    '%s keeps the screen orientation of the exact view (+Y up)',
    (view) => {
      const tilted = viewBasis(orbitDirection(view));
      const exact = viewBasis(STANDARD_VIEWS[view].direction);
      expect(vec3.dot(tilted.up, exact.up)).toBeCloseTo(1, 6);
      expect(vec3.dot(tilted.right, exact.right)).toBeCloseTo(1, 6);
    },
  );

  it('VIEW_TILT is 1e-4 rad', () => {
    expect(VIEW_TILT).toBe(1e-4);
  });
});

describe('viewDirectionFor', () => {
  it('+Z gives the tilted top direction', () => {
    expect(viewDirectionFor([0, 0, 1])).toEqual(orbitDirection('top'));
  });

  it('-Z gives the tilted bottom direction', () => {
    expect(viewDirectionFor([0, 0, -1])).toEqual(orbitDirection('bottom'));
  });

  it('almost +Z (within 1e-9 of the dot product) still counts as along Z', () => {
    expect(viewDirectionFor([1e-6, 0, 1])).toEqual(orbitDirection('top'));
  });

  it('-Y stays as it is', () => {
    expect(viewDirectionFor([0, -1, 0])).toEqual([0, -1, 0]);
  });

  it('normalizes the input', () => {
    const d = viewDirectionFor([3, 0, 4]);
    expect(d[0]).toBeCloseTo(0.6, 12);
    expect(d[1]).toBe(0);
    expect(d[2]).toBeCloseTo(0.8, 12);
    expect(viewDirectionFor([0, 0, 7])).toEqual(orbitDirection('top'));
  });

  it('throws on the zero vector', () => {
    expect(() => viewDirectionFor([0, 0, 0])).toThrow();
  });
});
