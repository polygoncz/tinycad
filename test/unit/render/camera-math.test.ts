import { describe, expect, it } from 'vitest';
import { vec3, type Vec3 } from '@/core';
import type { BoundingBox } from '@/kernel';
import { fitOrtho, STANDARD_VIEWS, viewBasis, type StandardView } from '@/render/camera-math';

const VIEWS: readonly StandardView[] = ['iso', 'top', 'bottom', 'front', 'back', 'left', 'right'];

function corners(b: BoundingBox): Vec3[] {
  const result: Vec3[] = [];
  for (const x of [b.min[0], b.max[0]])
    for (const y of [b.min[1], b.max[1]])
      for (const z of [b.min[2], b.max[2]]) result.push([x, y, z]);
  return result;
}

/** Checks that every corner lies inside the frame of the fitted camera. */
function expectInsideView(b: BoundingBox, direction: Vec3, aspect: number, margin = 0.1) {
  const fit = fitOrtho(b, viewBasis(direction), aspect, margin);
  const basis = viewBasis(direction);
  for (const c of corners(b)) {
    const rel = vec3.sub(c, fit.target);
    const u = vec3.dot(rel, basis.right);
    const v = vec3.dot(rel, basis.up);
    // Inside the frame including the margin.
    expect(Math.abs(u) * (1 + margin)).toBeLessThanOrEqual(fit.halfHeight * aspect + 1e-9);
    expect(Math.abs(v) * (1 + margin)).toBeLessThanOrEqual(fit.halfHeight + 1e-9);
  }
  return fit;
}

const cube: BoundingBox = { min: [0, 0, 0], max: [10, 10, 10] };

describe('STANDARD_VIEWS', () => {
  it.each(VIEWS)('%s has a unit direction and a unit up that is not parallel to it', (view) => {
    const { direction, up } = STANDARD_VIEWS[view];
    expect(vec3.length(direction)).toBeCloseTo(1);
    expect(vec3.length(up)).toBeCloseTo(1);
    expect(vec3.length(vec3.cross(direction, up))).toBeGreaterThan(0.5);
  });

  it.each(VIEWS.filter((v) => v !== 'iso'))('%s has up perpendicular to direction', (view) => {
    const { direction, up } = STANDARD_VIEWS[view];
    expect(vec3.dot(direction, up)).toBeCloseTo(0);
  });

  it('uses the directions from the spec', () => {
    expect(STANDARD_VIEWS.front).toEqual({ direction: [0, -1, 0], up: [0, 0, 1] });
    expect(STANDARD_VIEWS.back).toEqual({ direction: [0, 1, 0], up: [0, 0, 1] });
    expect(STANDARD_VIEWS.right).toEqual({ direction: [1, 0, 0], up: [0, 0, 1] });
    expect(STANDARD_VIEWS.left).toEqual({ direction: [-1, 0, 0], up: [0, 0, 1] });
    expect(STANDARD_VIEWS.top).toEqual({ direction: [0, 0, 1], up: [0, 1, 0] });
    expect(STANDARD_VIEWS.bottom).toEqual({ direction: [0, 0, -1], up: [0, 1, 0] });
    const s = 1 / Math.sqrt(3);
    expect(vec3.equals(STANDARD_VIEWS.iso.direction, [s, -s, s])).toBe(true);
    expect(STANDARD_VIEWS.iso.up).toEqual([0, 0, 1]);
  });

  it.each(VIEWS)('viewBasis of %s yields up as the view-plane projection of up', (view) => {
    const { direction, up } = STANDARD_VIEWS[view];
    const projected = vec3.normalize(vec3.sub(up, vec3.scale(direction, vec3.dot(up, direction))));
    expect(vec3.equals(viewBasis(direction).up, projected, 1e-12)).toBe(true);
  });
});

describe('viewBasis', () => {
  it('is orthonormal and right-handed for an arbitrary direction', () => {
    const b = viewBasis([2, 3, -1]);
    expect(vec3.length(b.direction)).toBeCloseTo(1);
    expect(vec3.length(b.right)).toBeCloseTo(1);
    expect(vec3.length(b.up)).toBeCloseTo(1);
    expect(vec3.dot(b.right, b.up)).toBeCloseTo(0);
    expect(vec3.dot(b.right, b.direction)).toBeCloseTo(0);
    expect(vec3.dot(b.up, b.direction)).toBeCloseTo(0);
    // right × up = direction (towards the camera), like a camera looking along −direction.
    expect(vec3.equals(vec3.cross(b.right, b.up), b.direction, 1e-9)).toBe(true);
  });
});

describe('fitOrtho', () => {
  it.each(VIEWS)('fits a cube in the %s view for aspect 1 and 2', (view) => {
    expectInsideView(cube, STANDARD_VIEWS[view].direction, 1);
    expectInsideView(cube, STANDARD_VIEWS[view].direction, 2);
  });

  it('fits for a narrow aspect and an arbitrary direction', () => {
    expectInsideView({ min: [-5, 20, 3], max: [100, 30, 8] }, [0.3, -0.8, 0.5], 0.5);
  });

  it('is tight: the limiting extent touches the frame with the margin', () => {
    // Front view of a wide flat box: width 100 (X), height 10 (Z).
    const flat: BoundingBox = { min: [0, 0, 0], max: [100, 5, 10] };
    expect(fitOrtho(flat, viewBasis(STANDARD_VIEWS.front.direction), 2).halfHeight).toBeCloseTo(
      27.5,
    );
    expect(fitOrtho(flat, viewBasis(STANDARD_VIEWS.front.direction), 20).halfHeight).toBeCloseTo(
      5.5,
    );
  });

  it('fits in the given basis: a basis rolled by 90° swaps the limiting extent', () => {
    // Front view of a wide flat box, rolled so that screen up is +X: width 10 (Z), height 100 (X).
    const flat: BoundingBox = { min: [0, 0, 0], max: [100, 5, 10] };
    const rolled = { right: [0, 0, -1], up: [1, 0, 0], direction: [0, -1, 0] } as const;
    expect(fitOrtho(flat, rolled, 2).halfHeight).toBeCloseTo(55);
  });

  it('centres on the bounding box', () => {
    expect(fitOrtho(cube, viewBasis(STANDARD_VIEWS.iso.direction), 1).target).toEqual([5, 5, 5]);
  });

  it('uses the margin argument', () => {
    const fit = fitOrtho(cube, viewBasis(STANDARD_VIEWS.front.direction), 1, 0);
    expect(fit.halfHeight).toBeCloseTo(5);
  });

  it('null bounds give a 200 × 200 frame around the origin', () => {
    const square = fitOrtho(null, viewBasis(STANDARD_VIEWS.iso.direction), 1);
    expect(square.target).toEqual([0, 0, 0]);
    expect(square.halfHeight).toBeCloseTo(100);

    const wide = fitOrtho(null, viewBasis(STANDARD_VIEWS.front.direction), 2);
    expect(wide.halfHeight).toBeCloseTo(100);

    const tall = fitOrtho(null, viewBasis(STANDARD_VIEWS.front.direction), 0.5);
    expect(tall.halfHeight * 0.5).toBeCloseTo(100);
  });

  it('a single point still gives a usable frame', () => {
    const fit = fitOrtho(
      { min: [1, 2, 3], max: [1, 2, 3] },
      viewBasis(STANDARD_VIEWS.top.direction),
      1,
    );
    expect(fit.halfHeight).toBeGreaterThan(0);
  });

  it('computes no depth: only target and halfHeight', () => {
    expect(Object.keys(fitOrtho(cube, viewBasis(STANDARD_VIEWS.iso.direction), 1)).sort()).toEqual([
      'halfHeight',
      'target',
    ]);
    expect(Object.keys(fitOrtho(null, viewBasis(STANDARD_VIEWS.iso.direction), 1)).sort()).toEqual([
      'halfHeight',
      'target',
    ]);
  });
});
