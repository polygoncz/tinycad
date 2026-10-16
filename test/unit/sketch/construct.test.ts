import { describe, expect, it } from 'vitest';
import type { Vec2 } from '@/core';
import {
  arcFrom3,
  arcSlotFrom,
  arcSlotShape,
  circleFrom2,
  circleFrom3,
  endTangent,
  rectangle3Shape,
  rectangleCenterShape,
  rectangleFrom3,
  rectangleFromCenter,
  slotFromCenters,
  slotFromEnds,
  slotOverallShape,
  slotShape,
  tangentArcFrom,
  tangentCircle,
} from '@/sketch/construct';
import type { CircleFit, ShapeDraft, ShapeIds } from '@/sketch/construct';
import { curve2, pointsById } from '@/sketch/geometry';
import type { Curve2 } from '@/sketch/geometry';
import type {
  SketchConstraintId,
  SketchCurve,
  SketchData,
  SketchEntityId,
  SketchPoint,
} from '@/sketch/model';
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
    if (e === undefined || e.kind === 'point') throw new Error(`no curve ${cid}`);
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

// Rectangles and slots (spec 12 "Nové kreslicí nástroje (M31)").

function expectPoints(actual: readonly Vec2[] | null, expected: readonly Vec2[]): void {
  expect(actual).not.toBeNull();
  if (actual === null) return;
  expect(actual).toHaveLength(expected.length);
  actual.forEach((p, i) => {
    const e = expected[i];
    if (e === undefined) throw new Error('unreachable');
    expect(p[0]).toBeCloseTo(e[0], 9);
    expect(p[1]).toBeCloseTo(e[1], 9);
  });
}

describe('rectangleFromCenter', () => {
  it('mirrors the corner through the centre: a = 2·center − corner, c = corner', () => {
    expectPoints(rectangleFromCenter([1, 2], [4, 4]), [
      [-2, 0],
      [4, 0],
      [4, 4],
      [-2, 4],
    ]);
  });

  it('keeps b = [c.x, a.y] and d = [a.x, c.y] for a corner below left of the centre', () => {
    expectPoints(rectangleFromCenter([0, 0], [-3, -1]), [
      [3, 1],
      [-3, 1],
      [-3, -1],
      [3, -1],
    ]);
  });

  it.each<[string, Vec2]>([
    ['zero width', [1, 5]],
    ['zero height', [5, 2]],
    ['the corner at the centre', [1, 2]],
    ['a side of 1e-10', [1 + 0.5e-10, 5]],
  ])('returns null for %s', (_, corner) => {
    expect(rectangleFromCenter([1, 2], corner)).toBeNull();
  });
});

describe('rectangleFrom3', () => {
  it('raises the first side by the signed height of p3 along its left normal', () => {
    // ab along +x, left normal +y; p3 above → h = 3.
    expectPoints(rectangleFrom3([0, 0], [4, 0], [10, 3]), [
      [0, 0],
      [4, 0],
      [4, 3],
      [0, 3],
    ]);
  });

  it('takes a negative height for p3 on the right of ab', () => {
    expectPoints(rectangleFrom3([0, 0], [4, 0], [1, -2]), [
      [0, 0],
      [4, 0],
      [4, -2],
      [0, -2],
    ]);
  });

  it('turns with the first side', () => {
    // ab from (1,1) to (4,5): length 5, n̂ = (−0.8, 0.6); p3 = b + 2·n̂ + 1 along ab.
    expectPoints(rectangleFrom3([1, 1], [4, 5], [4 - 1.6 + 0.6, 5 + 1.2 + 0.8]), [
      [1, 1],
      [4, 5],
      [2.4, 6.2],
      [-0.6, 2.2],
    ]);
  });

  it.each<[string, Vec2, Vec2, Vec2]>([
    ['a zero first side', [1, 1], [1, 1], [3, 3]],
    ['p3 on the line of the first side', [0, 0], [4, 0], [7, 0]],
    ['a height of 1e-10', [0, 0], [4, 0], [2, 1e-10]],
  ])('returns null for %s', (_, p1, p2, p3) => {
    expect(rectangleFrom3(p1, p2, p3)).toBeNull();
  });
});

describe('slotFromCenters', () => {
  it('takes the radius from the distance of width to the axis line', () => {
    const fit = slotFromCenters([0, 0], [10, 0], [25, -2]);
    expect(fit?.radius).toBeCloseTo(2, 9);
    expectPoints(fit === null ? null : [fit.c1, fit.c2, fit.l1, fit.l2, fit.r2, fit.r1], [
      [0, 0],
      [10, 0],
      [0, 2],
      [10, 2],
      [10, -2],
      [0, -2],
    ]);
  });

  it('puts l on the left of c1 → c2', () => {
    // Axis along +y: the left normal is −x.
    const fit = slotFromCenters([0, 0], [0, 5], [3, 1]);
    expectPoints(fit === null ? null : [fit.l1, fit.l2, fit.r2, fit.r1], [
      [-3, 0],
      [-3, 5],
      [3, 5],
      [3, 0],
    ]);
  });

  it.each<[string, Vec2, Vec2, Vec2]>([
    ['coincident centres', [2, 2], [2, 2], [5, 5]],
    ['width on the axis line', [0, 0], [10, 0], [4, 0]],
    ['a radius of 1e-10', [0, 0], [10, 0], [4, 1e-10]],
  ])('returns null for %s', (_, c1, c2, width) => {
    expect(slotFromCenters(c1, c2, width)).toBeNull();
  });
});

describe('slotFromEnds', () => {
  it('moves the centres inwards from the ends by the radius', () => {
    const fit = slotFromEnds([0, 0], [10, 0], [3, 2]);
    expect(fit?.radius).toBeCloseTo(2, 9);
    expectPoints(fit === null ? null : [fit.c1, fit.c2, fit.l1, fit.l2, fit.r2, fit.r1], [
      [2, 0],
      [8, 0],
      [2, 2],
      [8, 2],
      [8, -2],
      [2, -2],
    ]);
  });

  it.each<[string, Vec2, Vec2, Vec2]>([
    ['coincident ends', [1, 1], [1, 1], [3, 3]],
    ['width on the axis line', [0, 0], [10, 0], [4, 0]],
    ['a radius of 1e-10', [0, 0], [10, 0], [4, 1e-10]],
    ['a length of exactly two radii', [0, 0], [10, 0], [4, 5]],
    ['a length below two radii', [0, 0], [10, 0], [4, -6]],
  ])('returns null for %s', (_, e1, e2, width) => {
    expect(slotFromEnds(e1, e2, width)).toBeNull();
  });
});

describe('arcSlotFrom', () => {
  it('projects end onto the axis circle and offsets both ends by the half width', () => {
    const fit = arcSlotFrom([0, 0], [10, 0], [0, 20], [0, 9]);
    expect(fit?.radius).toBeCloseTo(10, 9);
    expect(fit?.half).toBeCloseTo(1, 9);
    expectPoints(
      fit === null
        ? null
        : [
            fit.center,
            fit.start,
            fit.end,
            fit.innerStart,
            fit.innerEnd,
            fit.outerStart,
            fit.outerEnd,
          ],
      [
        [0, 0],
        [10, 0],
        [0, 10],
        [9, 0],
        [0, 9],
        [11, 0],
        [0, 11],
      ],
    );
  });

  it('takes the half width from a point outside the axis circle too', () => {
    expect(arcSlotFrom([0, 0], [10, 0], [-5, 5], [0, -12])?.half).toBeCloseTo(2, 9);
  });

  it.each<[string, Vec2, Vec2, Vec2]>([
    ['start at the centre', [0, 0], [0, 5], [3, 3]],
    ['end in the direction of start', [20, 0], [5, 0], [11, 0]],
    ['end at the centre', [10, 0], [0, 0], [11, 0]],
    ['width on the axis circle', [10, 0], [0, 10], [0, -10]],
    ['a half width of the radius', [10, 0], [0, 10], [0, 0]],
    ['a half width over the radius', [10, 0], [0, 10], [0, 25]],
  ])('returns null for %s', (_, start, end, width) => {
    expect(arcSlotFrom([0, 0], start, end, width)).toBeNull();
  });
});

/** Sequential ids: entities e1, e2…, constraints k1, k2… */
function sequentialIds(): ShapeIds {
  let e = 0;
  let k = 0;
  return {
    entity: () => id(`e${String(++e)}`),
    constraint: () => `k${String(++k)}` as SketchConstraintId, // test-only branding of literals
  };
}

const pt = (pid: string, [x, y]: Vec2): SketchPoint => ({ kind: 'point', id: id(pid), x, y });

/** The draft with its points through the parser: the topology refers to valid entities. */
function withPoints(draft: ShapeDraft, points: readonly SketchPoint[]): SketchData {
  const r = parseSketchData([...points, ...draft.curves], draft.constraints);
  if (!r.ok) throw new Error(`invalid shape: ${JSON.stringify(r.error)}`);
  return r.value;
}

function expectRequiresAll(draft: ShapeDraft): void {
  expect(draft.required).toEqual(draft.constraints.map((c) => c.id));
}

/** The middle of an arc (counter-clockwise from start to end around the centre). */
function arcMiddle(arc: SketchCurve | undefined, data: SketchData): Vec2 {
  if (arc === undefined) throw new Error('no arc');
  const c = curve2(arc, pointsById(data));
  if (c.kind !== 'arc') throw new Error('not an arc');
  const a0 = Math.atan2(c.from[1] - c.center[1], c.from[0] - c.center[0]);
  let a1 = Math.atan2(c.to[1] - c.center[1], c.to[0] - c.center[0]);
  if (a1 <= a0) a1 += 2 * Math.PI;
  const r = dist(c.from, c.center);
  const m = (a0 + a1) / 2;
  return [c.center[0] + r * Math.cos(m), c.center[1] + r * Math.sin(m)];
}

describe('rectangleCenterShape', () => {
  const corners = [id('a'), id('b'), id('c'), id('d')] as const;
  const draft = rectangleCenterShape(corners, id('m'), sequentialIds());

  it('draws ab, bc, cd, da and the construction diagonal ac', () => {
    expect(draft.curves).toEqual([
      { kind: 'line', id: 'e1', p1: 'a', p2: 'b' },
      { kind: 'line', id: 'e2', p1: 'b', p2: 'c' },
      { kind: 'line', id: 'e3', p1: 'c', p2: 'd' },
      { kind: 'line', id: 'e4', p1: 'd', p2: 'a' },
      { kind: 'line', id: 'e5', p1: 'a', p2: 'c', construction: true },
    ]);
  });

  it('has no axis for the tool: its sides are horizontal and vertical already', () => {
    expect(draft.axis).toBeNull();
  });

  it('holds it by horizontal ab, cd, vertical bc, da and the centre in the middle of ac, all required', () => {
    expect(draft.constraints).toEqual([
      { kind: 'horizontal', id: 'k1', line: 'e1' },
      { kind: 'horizontal', id: 'k2', line: 'e3' },
      { kind: 'vertical', id: 'k3', line: 'e2' },
      { kind: 'vertical', id: 'k4', line: 'e4' },
      { kind: 'midpoint', id: 'k5', point: 'm', line: 'e5' },
    ]);
    expectRequiresAll(draft);
  });

  it('is valid sketch data with the points of rectangleFromCenter', () => {
    const fit = rectangleFromCenter([0, 0], [3, 2]);
    if (fit === null) throw new Error('no rectangle');
    const points = [
      pt('a', fit[0]),
      pt('b', fit[1]),
      pt('c', fit[2]),
      pt('d', fit[3]),
      pt('m', [0, 0]),
    ];
    expect(() => withPoints(draft, points)).not.toThrow();
  });
});

describe('rectangle3Shape', () => {
  const draft = rectangle3Shape([id('a'), id('b'), id('c'), id('d')], sequentialIds());

  it('draws ab, bc, cd, da without a diagonal', () => {
    expect(draft.curves).toEqual([
      { kind: 'line', id: 'e1', p1: 'a', p2: 'b' },
      { kind: 'line', id: 'e2', p1: 'b', p2: 'c' },
      { kind: 'line', id: 'e3', p1: 'c', p2: 'd' },
      { kind: 'line', id: 'e4', p1: 'd', p2: 'a' },
    ]);
  });

  it('gives the tool the first side ab for its axis', () => {
    expect(draft.axis).toBe('e1');
  });

  it('holds it by perpendicular(ab, bc), parallel(cd, ab), parallel(da, bc), all required', () => {
    expect(draft.constraints).toEqual([
      { kind: 'perpendicular', id: 'k1', a: 'e1', b: 'e2' },
      { kind: 'parallel', id: 'k2', a: 'e3', b: 'e1' },
      { kind: 'parallel', id: 'k3', a: 'e4', b: 'e2' },
    ]);
    expectRequiresAll(draft);
  });
});

describe('slotShape', () => {
  const ids = { c1: 'c1', c2: 'c2', l1: 'l1', l2: 'l2', r2: 'r2', r1: 'r1' } as const;
  const draft = slotShape(
    { c1: id('c1'), c2: id('c2'), l1: id('l1'), l2: id('l2'), r2: id('r2'), r1: id('r1') },
    sequentialIds(),
  );

  it('draws l1→l2, r2→r1, the arcs around c2 and c1 and the construction axis c1c2', () => {
    expect(draft.curves).toEqual([
      { kind: 'line', id: 'e1', p1: 'l1', p2: 'l2' },
      { kind: 'line', id: 'e2', p1: 'r2', p2: 'r1' },
      { kind: 'arc', id: 'e3', center: 'c2', start: 'r2', end: 'l2' },
      { kind: 'arc', id: 'e4', center: 'c1', start: 'l1', end: 'r1' },
      { kind: 'line', id: 'e5', p1: 'c1', p2: 'c2', construction: true },
    ]);
  });

  it('gives the tool the construction axis c1c2 for its axis', () => {
    expect(draft.axis).toBe('e5');
  });

  it('holds it by four tangencies in l1, l2, r2, r1 and equal arcs, all required', () => {
    expect(draft.constraints).toEqual([
      { kind: 'tangent', id: 'k1', a: 'e1', b: 'e4' },
      { kind: 'tangent', id: 'k2', a: 'e1', b: 'e3' },
      { kind: 'tangent', id: 'k3', a: 'e2', b: 'e3' },
      { kind: 'tangent', id: 'k4', a: 'e2', b: 'e4' },
      { kind: 'equal', id: 'k5', a: 'e3', b: 'e4' },
    ]);
    expectRequiresAll(draft);
  });

  it('bulges both end arcs out of the slot', () => {
    const fit = slotFromCenters([0, 0], [10, 0], [5, 2]);
    if (fit === null) throw new Error('no slot');
    const data = withPoints(draft, [
      pt(ids.c1, fit.c1),
      pt(ids.c2, fit.c2),
      pt(ids.l1, fit.l1),
      pt(ids.l2, fit.l2),
      pt(ids.r2, fit.r2),
      pt(ids.r1, fit.r1),
    ]);
    expectVec(arcMiddle(draft.curves[2], data), [12, 0]);
    expectVec(arcMiddle(draft.curves[3], data), [-2, 0]);
  });
});

describe('slotOverallShape', () => {
  const draft = slotOverallShape(
    {
      e1: id('p1'),
      e2: id('p2'),
      c1: id('c1'),
      c2: id('c2'),
      l1: id('l1'),
      l2: id('l2'),
      r2: id('r2'),
      r1: id('r1'),
    },
    sequentialIds(),
  );

  it('draws the slot with the construction axis between the ends', () => {
    expect(draft.curves).toEqual([
      { kind: 'line', id: 'e1', p1: 'l1', p2: 'l2' },
      { kind: 'line', id: 'e2', p1: 'r2', p2: 'r1' },
      { kind: 'arc', id: 'e3', center: 'c2', start: 'r2', end: 'l2' },
      { kind: 'arc', id: 'e4', center: 'c1', start: 'l1', end: 'r1' },
      { kind: 'line', id: 'e5', p1: 'p1', p2: 'p2', construction: true },
    ]);
  });

  it('gives the tool the construction axis e1e2 for its axis', () => {
    expect(draft.axis).toBe('e5');
  });

  it('adds the ends on the arcs and the centres on the axis, all required', () => {
    expect(draft.constraints).toEqual([
      { kind: 'tangent', id: 'k1', a: 'e1', b: 'e4' },
      { kind: 'tangent', id: 'k2', a: 'e1', b: 'e3' },
      { kind: 'tangent', id: 'k3', a: 'e2', b: 'e3' },
      { kind: 'tangent', id: 'k4', a: 'e2', b: 'e4' },
      { kind: 'equal', id: 'k5', a: 'e3', b: 'e4' },
      { kind: 'pointOnCurve', id: 'k6', point: 'p1', curve: 'e4' },
      { kind: 'pointOnCurve', id: 'k7', point: 'p2', curve: 'e3' },
      { kind: 'pointOnCurve', id: 'k8', point: 'c1', curve: 'e5' },
      { kind: 'pointOnCurve', id: 'k9', point: 'c2', curve: 'e5' },
    ]);
    expectRequiresAll(draft);
  });

  it('is valid sketch data with the points of slotFromEnds', () => {
    const fit = slotFromEnds([0, 0], [10, 0], [3, 2]);
    if (fit === null) throw new Error('no slot');
    const points = [
      pt('p1', [0, 0]),
      pt('p2', [10, 0]),
      pt('c1', fit.c1),
      pt('c2', fit.c2),
      pt('l1', fit.l1),
      pt('l2', fit.l2),
      pt('r2', fit.r2),
      pt('r1', fit.r1),
    ];
    expect(() => withPoints(draft, points)).not.toThrow();
  });
});

describe('arcSlotShape', () => {
  const draft = arcSlotShape(
    {
      center: id('o'),
      start: id('s'),
      end: id('e'),
      innerStart: id('is'),
      innerEnd: id('ie'),
      outerStart: id('os'),
      outerEnd: id('oe'),
    },
    sequentialIds(),
  );

  it('draws the inner, the outer and the two end arcs, no axis', () => {
    expect(draft.curves).toEqual([
      { kind: 'arc', id: 'e1', center: 'o', start: 'is', end: 'ie' },
      { kind: 'arc', id: 'e2', center: 'o', start: 'os', end: 'oe' },
      { kind: 'arc', id: 'e3', center: 's', start: 'is', end: 'os' },
      { kind: 'arc', id: 'e4', center: 'e', start: 'oe', end: 'ie' },
    ]);
  });

  it('has no axis for the tool', () => {
    expect(draft.axis).toBeNull();
  });

  it('holds it by four tangencies only (no equal), all required', () => {
    expect(draft.constraints).toEqual([
      { kind: 'tangent', id: 'k1', a: 'e3', b: 'e1' },
      { kind: 'tangent', id: 'k2', a: 'e3', b: 'e2' },
      { kind: 'tangent', id: 'k3', a: 'e4', b: 'e2' },
      { kind: 'tangent', id: 'k4', a: 'e4', b: 'e1' },
    ]);
    expectRequiresAll(draft);
  });

  it.each<[string, Vec2]>([
    ['a quarter turn', [0, 20]],
    ['more than a half turn', [5, -5]],
  ])('bulges the end arcs out of the slot (%s)', (_, end) => {
    const fit = arcSlotFrom([0, 0], [10, 0], end, [0, 9]);
    if (fit === null) throw new Error('no slot');
    const data = withPoints(draft, [
      pt('o', fit.center),
      pt('s', fit.start),
      pt('e', fit.end),
      pt('is', fit.innerStart),
      pt('ie', fit.innerEnd),
      pt('os', fit.outerStart),
      pt('oe', fit.outerEnd),
    ]);
    // The axis runs counter-clockwise from start to end, so its direction at a point at angle t is
    // (−sin t, cos t). The start arc bulges against it at the start, the end arc along it at the end.
    const along = (arc: SketchCurve | undefined, at: Vec2): number => {
      const m = arcMiddle(arc, data);
      const t = Math.atan2(at[1], at[0]);
      return (m[0] - at[0]) * -Math.sin(t) + (m[1] - at[1]) * Math.cos(t);
    };
    expect(along(draft.curves[2], fit.start)).toBeCloseTo(-1, 9);
    expect(along(draft.curves[3], fit.end)).toBeCloseTo(1, 9);
    // The inner and outer arcs run with the axis (their middles on the same ray).
    const inner = arcMiddle(draft.curves[0], data);
    const outer = arcMiddle(draft.curves[1], data);
    expect(dist(inner, [0, 0])).toBeCloseTo(9, 9);
    expect(dist(outer, [0, 0])).toBeCloseTo(11, 9);
    expect(Math.atan2(outer[1], outer[0])).toBeCloseTo(Math.atan2(inner[1], inner[0]), 9);
  });
});
