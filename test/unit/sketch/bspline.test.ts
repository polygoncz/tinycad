import { describe, expect, it } from 'vitest';
import type { Vec2 } from '@/core';
import { derivative, evaluate, interpolateSpline, tessellate } from '@/sketch/bspline';
import type { BSplineShape } from '@/sketch/bspline';

function expectVec(actual: Vec2, expected: Vec2, digits = 12): void {
  expect(actual[0]).toBeCloseTo(expected[0], digits);
  expect(actual[1]).toBeCloseTo(expected[1], digits);
}

// Degree 1 with an interior knot: two segments (0,0)–(2,0) on [0, 0.5] and (2,0)–(2,4) on [0.5, 1].
const LINEAR: BSplineShape = {
  degree: 1,
  poles: [
    [0, 0],
    [2, 0],
    [2, 4],
  ],
  knots: [0, 0, 0.5, 1, 1],
};

// Quadratic Bézier.
const QUADRATIC: BSplineShape = {
  degree: 2,
  poles: [
    [0, 0],
    [1, 2],
    [2, 0],
  ],
  knots: [0, 0, 0, 1, 1, 1],
};

// Cubic Bézier.
const CUBIC: BSplineShape = {
  degree: 3,
  poles: [
    [0, 0],
    [1, 3],
    [3, 3],
    [4, 0],
  ],
  knots: [0, 0, 0, 0, 1, 1, 1, 1],
};

// The same cubic after inserting the knot 0.5 (Boehm): Q1 = (P0+P1)/2, Q2 = (P1+P2)/2, Q3 = (P2+P3)/2.
const CUBIC_SPLIT: BSplineShape = {
  degree: 3,
  poles: [
    [0, 0],
    [0.5, 1.5],
    [2, 3],
    [3.5, 1.5],
    [4, 0],
  ],
  knots: [0, 0, 0, 0, 0.5, 1, 1, 1, 1],
};

describe('evaluate', () => {
  it('evaluates a linear spline piecewise', () => {
    expectVec(evaluate(LINEAR, 0.25), [1, 0]);
    expectVec(evaluate(LINEAR, 0.5), [2, 0]);
    expectVec(evaluate(LINEAR, 0.75), [2, 2]);
  });

  it('evaluates a quadratic Bézier', () => {
    expectVec(evaluate(QUADRATIC, 0.5), [1, 1]);
  });

  it('evaluates a cubic Bézier', () => {
    expectVec(evaluate(CUBIC, 0.5), [2, 2.25]);
    expectVec(evaluate(CUBIC, 0.25), [0.90625, 1.6875]);
  });

  it('evaluates a cubic with an interior knot like the Bézier it was split from', () => {
    expectVec(evaluate(CUBIC_SPLIT, 0.5), [2, 2.25]);
    expectVec(evaluate(CUBIC_SPLIT, 0.25), [0.90625, 1.6875]);
    for (const t of [0.1, 0.3, 0.49, 0.51, 0.7, 0.9]) {
      expectVec(evaluate(CUBIC_SPLIT, t), evaluate(CUBIC, t));
    }
  });

  it('returns exactly the end poles at the ends', () => {
    for (const c of [LINEAR, QUADRATIC, CUBIC, CUBIC_SPLIT]) {
      expect(evaluate(c, 0)).toEqual(c.poles[0]);
      expect(evaluate(c, 1)).toEqual(c.poles[c.poles.length - 1]);
    }
  });

  it('clamps t to the parameter range', () => {
    expect(evaluate(CUBIC_SPLIT, -1)).toEqual([0, 0]);
    expect(evaluate(CUBIC_SPLIT, 2)).toEqual([4, 0]);
  });
});

describe('derivative', () => {
  it('gives the first derivative of a linear spline per segment and zero second derivative', () => {
    expectVec(derivative(LINEAR, 0.25), [4, 0]);
    expectVec(derivative(LINEAR, 0.75), [0, 8]);
    expect(derivative(LINEAR, 0.25, 2)).toEqual([0, 0]);
  });

  it('gives the derivatives of a quadratic Bézier', () => {
    expectVec(derivative(QUADRATIC, 0), [2, 4]);
    expectVec(derivative(QUADRATIC, 0.5), [2, 0]);
    expectVec(derivative(QUADRATIC, 1), [2, -4]);
    expectVec(derivative(QUADRATIC, 0.3, 2), [0, -8]);
  });

  it('gives the derivatives of a cubic Bézier', () => {
    expectVec(derivative(CUBIC, 0), [3, 9]);
    expectVec(derivative(CUBIC, 1), [3, -9]);
    expectVec(derivative(CUBIC, 0.25), [4.125, 4.5]);
    expectVec(derivative(CUBIC, 0, 2), [6, -18]);
    expectVec(derivative(CUBIC, 0.25, 2), [3, -18]);
    expectVec(derivative(CUBIC, 0.5, 2), [0, -18]);
  });

  it('gives the derivatives of a cubic with an interior knot like the Bézier', () => {
    expectVec(derivative(CUBIC_SPLIT, 0), [3, 9]);
    expectVec(derivative(CUBIC_SPLIT, 1), [3, -9]);
    expectVec(derivative(CUBIC_SPLIT, 0.25), [4.125, 4.5]);
    expectVec(derivative(CUBIC_SPLIT, 0.25, 2), [3, -18]);
    for (const t of [0.1, 0.5, 0.7, 0.9]) {
      expectVec(derivative(CUBIC_SPLIT, t), derivative(CUBIC, t), 10);
      expectVec(derivative(CUBIC_SPLIT, t, 2), derivative(CUBIC, t, 2), 10);
    }
  });

  it('is degree · (P1 − P0) at the start and degree · (Pn − Pn−1) at the end of a Bézier', () => {
    expectVec(derivative(QUADRATIC, 0), [2 * 1, 2 * 2]);
    expectVec(derivative(QUADRATIC, 1), [2 * 1, 2 * -2]);
    expectVec(derivative(CUBIC, 0), [3 * 1, 3 * 3]);
    expectVec(derivative(CUBIC, 1), [3 * 1, 3 * -3]);
  });

  it('is zero when the degree is lower than the order', () => {
    expect(derivative(LINEAR, 0.6, 2)).toEqual([0, 0]);
  });
});

// Cubic with x(t) = t: the poles' x are the Greville abscissae of the knots, so the curve is
// a function graph and the parameter of a point is its x.
const GRAPH: BSplineShape = {
  degree: 3,
  poles: [
    [0, 0],
    [0.1, 2],
    [1.3 / 3, -1],
    [2.3 / 3, 3],
    [1, 0],
  ],
  knots: [0, 0, 0, 0, 0.3, 1, 1, 1, 1],
};

function distanceToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const s =
    len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - a[0] - s * dx, p[1] - a[1] - s * dy);
}

describe('tessellate', () => {
  it('has all points on the curve and every segment within the tolerance of the curve', () => {
    const tolerance = 1e-3;
    const pts = tessellate(GRAPH, tolerance);
    expect(pts.length).toBeGreaterThan(4);
    for (const p of pts) expect(p[1]).toBeCloseTo(evaluate(GRAPH, p[0])[1], 12);
    for (const [a, b] of pts.slice(1).map((b, i): [Vec2, Vec2] => [pts[i] ?? b, b])) {
      expect(b[0]).toBeGreaterThan(a[0]);
      expect(distanceToSegment(evaluate(GRAPH, (a[0] + b[0]) / 2), a, b)).toBeLessThanOrEqual(
        tolerance,
      );
    }
  });

  it('starts and ends exactly at the end poles', () => {
    for (const c of [LINEAR, QUADRATIC, CUBIC, CUBIC_SPLIT, GRAPH]) {
      const pts = tessellate(c, 1e-2);
      expect(pts[0]).toEqual(c.poles[0]);
      expect(pts[pts.length - 1]).toEqual(c.poles[c.poles.length - 1]);
    }
  });

  it('keeps the interior knots of a linear spline and adds nothing else', () => {
    expect(tessellate(LINEAR, 1e-3)).toEqual([
      [0, 0],
      [2, 0],
      [2, 4],
    ]);
  });

  it('refines more for a smaller tolerance', () => {
    expect(tessellate(CUBIC, 1e-4).length).toBeGreaterThan(tessellate(CUBIC, 1e-1).length);
  });
});

describe('interpolateSpline', () => {
  function expectThrough(points: readonly Vec2[]): void {
    const r = interpolateSpline(points);
    expect(r.params).toHaveLength(points.length);
    expect(r.poles).toHaveLength(points.length);
    expect(r.knots).toHaveLength(points.length + r.degree + 1);
    points.forEach((p, i) => {
      expectVec(evaluate(r, r.params[i] ?? Number.NaN), p, 9);
    });
  }

  it('uses degree 1 for two points: the poles are the points', () => {
    const r = interpolateSpline([
      [1, 1],
      [4, 5],
    ]);
    expect(r).toEqual({
      degree: 1,
      params: [0, 1],
      knots: [0, 0, 1, 1],
      poles: [
        [1, 1],
        [4, 5],
      ],
    });
  });

  it('uses degree 2 for three points with chord-length params', () => {
    const r = interpolateSpline([
      [0, 0],
      [3, 4],
      [3, 10],
    ]);
    expect(r.degree).toBe(2);
    expect(r.params[0]).toBe(0);
    expect(r.params[1]).toBeCloseTo(5 / 11, 15);
    expect(r.params[2]).toBe(1);
    expect(r.knots).toEqual([0, 0, 0, 1, 1, 1]);
  });

  it('uses degree 3 for four or more points with averaged knots', () => {
    expect(
      interpolateSpline([
        [0, 0],
        [1, 1],
        [2, 0],
        [3, 1],
      ]).degree,
    ).toBe(3);
    const pts: Vec2[] = [0, 1, 2, 3, 4, 5, 6].map((i): Vec2 => [i, 0]);
    const r = interpolateSpline(pts);
    expect(r.degree).toBe(3);
    const expected = [0, 0, 0, 0, 1 / 3, 1 / 2, 2 / 3, 1, 1, 1, 1];
    r.knots.forEach((k, i) => {
      expect(k).toBeCloseTo(expected[i] ?? Number.NaN, 15);
    });
  });

  it('passes through the points at their params', () => {
    expectThrough([
      [0, 0],
      [5, 2],
    ]);
    expectThrough([
      [0, 0],
      [3, 4],
      [3, 10],
    ]);
    expectThrough([
      [0, 0],
      [1, 3],
      [4, 3],
      [6, -1],
    ]);
    expectThrough([
      [0, 0],
      [1, 2],
      [2.5, 2.2],
      [4, 0],
      [5, -3],
      [7, -1],
      [8, 4],
    ]);
  });

  it('passes through a closed loop whose first and last points coincide', () => {
    expectThrough([
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
      [0, 0],
    ]);
  });

  it('rejects fewer than two points', () => {
    expect(() => interpolateSpline([])).toThrow(RangeError);
    expect(() => interpolateSpline([[1, 2]])).toThrow(RangeError);
  });

  it('rejects non-finite coordinates', () => {
    expect(() =>
      interpolateSpline([
        [0, 0],
        [Infinity, 1],
      ]),
    ).toThrow(RangeError);
    expect(() =>
      interpolateSpline([
        [0, Number.NaN],
        [1, 1],
      ]),
    ).toThrow(RangeError);
  });

  it('rejects two consecutive equal points', () => {
    expect(() =>
      interpolateSpline([
        [0, 0],
        [1, 1],
        [1, 1],
        [2, 0],
      ]),
    ).toThrow(RangeError);
  });
});
