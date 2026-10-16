import { describe, expect, it } from 'vitest';
import type { Vec2 } from '@/core';
import { nearestParam, piecePolyline, pointAt } from '@/sketch/curve-param';
import type { Curve2 } from '@/sketch/geometry';

const LINE: Curve2 = { kind: 'line', from: [1, 1], to: [5, 4] };
const ARC: Curve2 = { kind: 'arc', center: [0, 0], from: [2, 0], to: [0, 2], ccw: true };
const CW_ARC: Curve2 = { kind: 'arc', center: [0, 0], from: [2, 0], to: [0, -2], ccw: false };
const CIRCLE: Curve2 = { kind: 'circle', center: [1, 2], radius: 3 };
/** A cubic spline with one interior knot. */
const SPLINE: Curve2 = {
  kind: 'bspline',
  degree: 3,
  poles: [
    [0, 0],
    [1, 3],
    [3, 3],
    [5, -1],
    [6, 2],
  ],
  knots: [0, 0, 0, 0, 0.5, 1, 1, 1, 1],
};

function expectPoint(actual: Vec2, expected: Vec2, digits = 9): void {
  expect(actual[0]).toBeCloseTo(expected[0], digits);
  expect(actual[1]).toBeCloseTo(expected[1], digits);
}

describe('pointAt (the parameter t of spec 12)', () => {
  it('a line: t from 0 at `from` to 1 at `to`', () => {
    expectPoint(pointAt(LINE, 0), [1, 1]);
    expectPoint(pointAt(LINE, 1), [5, 4]);
    expectPoint(pointAt(LINE, 0.5), [3, 2.5]);
  });

  it('an arc: the angle from `from` in the direction of the arc', () => {
    expectPoint(pointAt(ARC, 0), [2, 0]);
    expectPoint(pointAt(ARC, Math.PI / 2), [0, 2]);
    expectPoint(pointAt(CW_ARC, Math.PI / 2), [0, -2]);
  });

  it('a circle: the angle atan2(p − center), also past 2π', () => {
    expectPoint(pointAt(CIRCLE, 0), [4, 2]);
    expectPoint(pointAt(CIRCLE, Math.PI), [-2, 2]);
    expectPoint(pointAt(CIRCLE, 2 * Math.PI + Math.PI / 2), [1, 5]);
  });

  it('a spline: the knot parameter, ends in the end poles', () => {
    expectPoint(pointAt(SPLINE, 0), [0, 0]);
    expectPoint(pointAt(SPLINE, 1), [6, 2]);
  });
});

describe('nearestParam', () => {
  it('inverts pointAt on every kind', () => {
    const cases: readonly [Curve2, readonly number[]][] = [
      [LINE, [0, 0.25, 0.7, 1]],
      [ARC, [0, 0.3, 1.2, Math.PI / 2]],
      [CW_ARC, [0, 0.4, 1.5]],
      [CIRCLE, [0, 1, 3, 5.5]],
      [SPLINE, [0, 0.1, 0.37, 0.5, 0.81, 1]],
    ];
    for (const [curve, ts] of cases) {
      for (const t of ts) expect(nearestParam(curve, pointAt(curve, t))).toBeCloseTo(t, 7);
    }
  });

  it('projects a point off the curve and clamps to the ends', () => {
    expect(nearestParam(LINE, [3 - 3, 2.5 + 4])).toBeCloseTo(0.5, 9);
    expect(nearestParam(LINE, [-10, -10])).toBe(0);
    expect(nearestParam(LINE, [20, 20])).toBe(1);
    expect(nearestParam(ARC, [5, 5])).toBeCloseTo(Math.PI / 4, 9);
    // Outside the arc: the nearer end.
    expect(nearestParam(ARC, [1, -0.1])).toBe(0);
    expect(nearestParam(ARC, [-0.1, 1])).toBeCloseTo(Math.PI / 2, 12);
    expect(nearestParam(CIRCLE, [1, -5])).toBeCloseTo((3 * Math.PI) / 2, 9);
  });

  it('finds the nearest point of a spline to a point off it', () => {
    const p: Vec2 = [3, 4];
    const t = nearestParam(SPLINE, p);
    const at = pointAt(SPLINE, t);
    for (let s = 0; s <= 1; s += 0.001) {
      const q = pointAt(SPLINE, s);
      expect(Math.hypot(q[0] - p[0], q[1] - p[1])).toBeGreaterThanOrEqual(
        Math.hypot(at[0] - p[0], at[1] - p[1]) - 1e-9,
      );
    }
  });
});

describe('piecePolyline', () => {
  it('a line piece is its two end points', () => {
    const points = piecePolyline(LINE, 0.25, 0.75);
    expect(points).toHaveLength(2);
    expectPoint(points[0] ?? [NaN, NaN], [2, 1.75]);
    expectPoint(points[1] ?? [NaN, NaN], [4, 3.25]);
  });

  it('a circle piece runs from `from` to `to` past 2π, every point on the circle', () => {
    const points = piecePolyline(CIRCLE, 1.5 * Math.PI, 2.5 * Math.PI);
    expectPoint(points[0] ?? [NaN, NaN], pointAt(CIRCLE, 1.5 * Math.PI));
    expectPoint(points.at(-1) ?? [NaN, NaN], pointAt(CIRCLE, 2.5 * Math.PI));
    expect(points.length).toBeGreaterThan(8);
    for (const [x, y] of points) expect(Math.hypot(x - 1, y - 2)).toBeCloseTo(3, 9);
    // Through angle 0 (x = 4), not the other way round.
    expect(points.some(([x]) => x > 3.99)).toBe(true);
  });

  it('a spline piece starts and ends at the parameters and stays on the curve', () => {
    const points = piecePolyline(SPLINE, 0.2, 0.8);
    expectPoint(points[0] ?? [NaN, NaN], pointAt(SPLINE, 0.2));
    expectPoint(points.at(-1) ?? [NaN, NaN], pointAt(SPLINE, 0.8));
    for (const p of points) {
      const q = pointAt(SPLINE, nearestParam(SPLINE, p));
      expect(Math.hypot(q[0] - p[0], q[1] - p[1])).toBeLessThan(1e-9);
    }
    expect(Object.isFrozen(points)).toBe(true);
  });
});
