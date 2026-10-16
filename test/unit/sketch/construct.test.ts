import { describe, expect, it } from 'vitest';
import type { Vec2 } from '@/core';
import {
  arcFrom3,
  circleFrom2,
  circleFrom3,
  endTangent,
  tangentArcFrom,
  tangentCircle,
} from '@/sketch/construct';
import type { CircleFit } from '@/sketch/construct';
import type { Curve2 } from '@/sketch/geometry';
import { isPattern } from '@/sketch/model';
import type { SketchCurve, SketchData, SketchEntityId } from '@/sketch/model';
import { parseSketchData } from '@/sketch/parse';

function sketch(entities: readonly unknown[]): SketchData {
  const r = parseSketchData(entities, []);
  if (!r.ok) throw new Error(`invalid test sketch: ${JSON.stringify(r.error)}`);
  return r.value;
}

const id = (s: string): SketchEntityId => s as SketchEntityId; // test-only branding of literals

const dist = (a: Vec2, b: Vec2): number => Math.hypot(a[0] - b[0], a[1] - b[1]);

const line = (from: Vec2, to: Vec2): Curve2 => ({ kind: 'line', from, to });
const circle = (center: Vec2, radius: number): Curve2 => ({ kind: 'circle', center, radius });

/** Distance of p from a curve as tangentCircle sees it (a line is its whole carrier line). */
function curveDistance(c: Curve2, p: Vec2): number {
  switch (c.kind) {
    case 'line': {
      const d: Vec2 = [c.to[0] - c.from[0], c.to[1] - c.from[1]];
      const cr = d[0] * (p[1] - c.from[1]) - d[1] * (p[0] - c.from[0]);
      return Math.abs(cr) / Math.hypot(d[0], d[1]);
    }
    case 'circle':
      return Math.abs(dist(p, c.center) - c.radius);
    case 'arc':
      return Math.abs(dist(p, c.center) - dist(c.from, c.center));
    case 'bspline':
      throw new Error('not used');
  }
}

function expectTangent(fit: CircleFit | null, curves: readonly Curve2[]): CircleFit {
  expect(fit).not.toBeNull();
  if (fit === null) throw new Error('unreachable');
  for (const c of curves) expect(curveDistance(c, fit.center)).toBeCloseTo(fit.radius, 6);
  return fit;
}

function expectVec(actual: Vec2 | null, expected: Vec2): void {
  expect(actual).not.toBeNull();
  if (actual === null) return;
  expect(actual[0]).toBeCloseTo(expected[0], 9);
  expect(actual[1]).toBeCloseTo(expected[1], 9);
}

describe('circleFrom2', () => {
  it('makes the circle with diameter a–b', () => {
    const fit = circleFrom2([1, 1], [5, 4]);
    expectVec(fit?.center ?? null, [3, 2.5]);
    expect(fit?.radius).toBeCloseTo(2.5, 12);
  });

  it.each<[string, Vec2, Vec2]>([
    ['identical', [1, 2], [1, 2]],
    ['within 1e-9', [1, 2], [1 + 5e-10, 2]],
  ])('returns null for %s points', (_, a, b) => {
    expect(circleFrom2(a, b)).toBeNull();
  });
});

describe('circleFrom3', () => {
  it.each<[string, Vec2, Vec2, Vec2, Vec2, number]>([
    ['right triangle', [0, 0], [4, 0], [0, 3], [2, 1.5], 2.5],
    ['points on the unit circle', [1, 0], [0, 1], [-1, 0], [0, 0], 1],
    ['shifted circle', [12, 7], [10, 9], [8, 7], [10, 7], 2],
  ])('makes the circumscribed circle (%s)', (_, a, b, c, center, radius) => {
    const fit = circleFrom3(a, b, c);
    expectVec(fit?.center ?? null, center);
    expect(fit?.radius).toBeCloseTo(radius, 9);
  });

  it.each<[string, Vec2, Vec2, Vec2]>([
    ['collinear', [0, 0], [1, 1], [3, 3]],
    ['collinear at a large scale', [0, 0], [1000, 1], [3000, 3]],
    ['two identical', [0, 0], [0, 0], [3, 1]],
    ['all identical', [2, 2], [2, 2], [2, 2]],
  ])('returns null for %s points', (_, a, b, c) => {
    expect(circleFrom3(a, b, c)).toBeNull();
  });
});

describe('arcFrom3', () => {
  it.each<[string, Vec2, boolean]>([
    ['above (counter-clockwise from (1,0) to (−1,0))', [0, 1], true],
    ['below (clockwise)', [0, -1], false],
  ])('passes through the point %s', (_, through, ccw) => {
    const fit = arcFrom3([1, 0], through, [-1, 0]);
    expectVec(fit?.center ?? null, [0, 0]);
    expect(fit?.radius).toBeCloseTo(1, 12);
    expect(fit?.ccw).toBe(ccw);
  });

  it('returns null when the three points are on a line', () => {
    expect(arcFrom3([0, 0], [1, 0], [2, 0])).toBeNull();
    expect(arcFrom3([0, 0], [1, 1], [0, 0])).toBeNull();
  });
});

describe('tangentArcFrom', () => {
  it.each<[string, Vec2, Vec2, boolean]>([
    ['left of the direction', [2, 2], [0, 2], true],
    ['right of the direction', [2, -2], [0, -2], false],
  ])('makes the arc to an end %s', (_, end, center, ccw) => {
    const fit = tangentArcFrom([0, 0], [1, 0], end);
    expectVec(fit?.center ?? null, center);
    expect(fit?.ccw).toBe(ccw);
    if (fit === null) return;
    expect(fit.radius).toBeCloseTo(dist(fit.center, [0, 0]), 12);
    expect(fit.radius).toBeCloseTo(dist(fit.center, end), 12);
  });

  it('is tangent to the direction at the start (radius ⟂ direction)', () => {
    const d: Vec2 = [Math.SQRT1_2, Math.SQRT1_2];
    const fit = tangentArcFrom([1, 1], d, [1, 5]);
    expect(fit).not.toBeNull();
    if (fit === null) return;
    const r: Vec2 = [fit.center[0] - 1, fit.center[1] - 1];
    expect(r[0] * d[0] + r[1] * d[1]).toBeCloseTo(0, 12);
    expect(fit.radius).toBeCloseTo(dist(fit.center, [1, 5]), 12);
    expect(fit.ccw).toBe(true);
  });

  it.each<[string, Vec2]>([
    ['ahead on the direction line', [3, 0]],
    ['behind on the direction line', [-3, 0]],
    ['at the start', [0, 0]],
  ])('returns null for an end %s', (_, end) => {
    expect(tangentArcFrom([0, 0], [1, 0], end)).toBeNull();
  });
});

describe('tangentCircle', () => {
  it('two crossing lines: the centre is on the angle bisector next to the cursor', () => {
    const curves = [line([0, 0], [10, 0]), line([0, 0], [0, 10])];
    const fit = expectTangent(tangentCircle(curves, [4, 6]), curves);
    // Bisector y = x of the quadrant of the hint; the nearest point to (4,6) is (5,5).
    expect(fit.center[0]).toBeCloseTo(fit.center[1], 6);
    expect(fit.center[0]).toBeCloseTo(5, 1);
    expect(fit.radius).toBeCloseTo(fit.center[0], 6);
  });

  it('two crossing lines: another quadrant of the hint gives the other bisector', () => {
    const curves = [line([0, 0], [10, 0]), line([0, 0], [0, 10])];
    const fit = expectTangent(tangentCircle(curves, [-3, 2]), curves);
    expect(fit.center[0]).toBeCloseTo(-fit.center[1], 6);
    expect(fit.center[0]).toBeLessThan(0);
    expect(dist(fit.center, [-2.5, 2.5])).toBeLessThan(0.1);
  });

  it('two parallel lines: r is half the distance, the centre is on the mid line by the cursor', () => {
    const curves = [line([0, 0], [10, 0]), line([0, 4], [10, 4])];
    const fit = expectTangent(tangentCircle(curves, [7, 3]), curves);
    expect(fit.radius).toBeCloseTo(2, 6);
    expect(fit.center[1]).toBeCloseTo(2, 6);
    expect(fit.center[0]).toBeCloseTo(7, 1);
  });

  it('a line and a circle', () => {
    const curves = [line([-10, 0], [10, 0]), circle([0, 5], 2)];
    const fit = expectTangent(tangentCircle(curves, [4, 2]), curves);
    expect(fit.radius).toBeGreaterThan(1e-9);
    expect(dist(fit.center, [4, 2])).toBeLessThan(2);
  });

  it('an arc counts as its whole circle', () => {
    const arc: Curve2 = { kind: 'arc', center: [0, 5], from: [2, 5], to: [0, 7], ccw: true };
    const curves = [line([-10, 0], [10, 0]), arc];
    // The hint is below the arc's span, the result touches its carrier circle.
    expectTangent(tangentCircle(curves, [-1, 1.2]), curves);
  });

  it('three sides of a triangle with the hint inside: the inscribed circle', () => {
    const curves = [line([0, 0], [4, 0]), line([4, 0], [0, 3]), line([0, 3], [0, 0])];
    const fit = expectTangent(tangentCircle(curves, [1.2, 0.8]), curves);
    // Incircle of the 3-4-5 triangle: r = (3 + 4 − 5) / 2 = 1, centre (1, 1).
    expect(fit.radius).toBeCloseTo(1, 9);
    expectVec(fit.center, [1, 1]);
  });

  it.each<[string, readonly Curve2[], Vec2]>([
    [
      'three parallel lines (no tangent circle, no convergence)',
      [line([0, 0], [1, 0]), line([0, 1], [1, 1]), line([0, 3], [1, 3])],
      [0, 0.5],
    ],
    [
      'three lines through one point (radius 0)',
      [line([0, 0], [1, 0]), line([0, 0], [0, 1]), line([0, 0], [1, 1])],
      [0.3, 0.1],
    ],
    ['one curve', [line([0, 0], [1, 0])], [0, 1]],
    [
      'a spline',
      [
        line([0, 0], [1, 0]),
        {
          kind: 'bspline',
          degree: 1,
          poles: [
            [0, 2],
            [1, 2],
          ],
          knots: [0, 0, 1, 1],
        },
      ],
      [0.5, 1],
    ],
  ])('returns null for %s', (_, curves, hint) => {
    expect(tangentCircle(curves, hint)).toBeNull();
  });
});

describe('endTangent', () => {
  const data = sketch([
    { kind: 'point', id: 'a', x: 0, y: 0 },
    { kind: 'point', id: 'b', x: 3, y: 4 },
    { kind: 'point', id: 'c', x: 10, y: 0 },
    { kind: 'point', id: 's', x: 12, y: 0 },
    { kind: 'point', id: 'e', x: 10, y: 2 },
    { kind: 'point', id: 'x', x: 50, y: 50 },
    { kind: 'line', id: 'ab', p1: 'a', p2: 'b' },
    { kind: 'arc', id: 'arc', center: 'c', start: 's', end: 'e' },
    { kind: 'circle', id: 'k', center: 'c', radius: 1 },
  ]);
  const curve = (cid: string): SketchCurve => {
    const e = data.entities.find((x) => x.id === cid);
    if (e === undefined || e.kind === 'point' || e.kind === 'text' || isPattern(e)) {
      throw new Error(`no curve ${cid}`);
    }
    return e;
  };

  it.each<[string, string, string, Vec2]>([
    ['line at p2 (away from p1)', 'ab', 'b', [0.6, 0.8]],
    ['line at p1 (away from p2)', 'ab', 'a', [-0.6, -0.8]],
    // CCW arc from (12,0) to (10,2) around (10,0): at the end it moves to −x and on.
    ['arc at the end (on in the counter-clockwise sense)', 'arc', 'e', [-1, 0]],
    // At the start the curve continues backwards, clockwise: −y.
    ['arc at the start (on in the clockwise sense)', 'arc', 's', [0, -1]],
  ])('%s', (_, cid, pid, expected) => {
    expectVec(endTangent(curve(cid), id(pid), data), expected);
  });

  it.each<[string, string, string]>([
    ['a point that is not an end of the line', 'ab', 'x'],
    ['the centre of an arc', 'arc', 'c'],
    ['a circle (no ends)', 'k', 'c'],
  ])('returns null for %s', (_, cid, pid) => {
    expect(endTangent(curve(cid), id(pid), data)).toBeNull();
  });
});
