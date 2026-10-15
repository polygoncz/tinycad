import { describe, expect, it } from 'vitest';
import { bspline as splineMath, type Vec2 } from '@/core';
import type { Curve2 } from '@/sketch/geometry';
import type { SketchData } from '@/sketch/model';
import { parseSketchData } from '@/sketch/parse';
import { computeRegions } from '@/sketch/regions';
import { rectangleData } from '@/sketch/testing';

function sketch(entities: readonly unknown[], constraints: readonly unknown[] = []): SketchData {
  const r = parseSketchData(entities, constraints);
  if (!r.ok) throw new Error(`invalid test sketch: ${JSON.stringify(r.error)}`);
  return r.value;
}

const pt = (id: string, x: number, y: number) => ({ kind: 'point', id, x, y });
const ln = (id: string, p1: string, p2: string, construction?: true) =>
  construction === undefined
    ? { kind: 'line', id, p1, p2 }
    : { kind: 'line', id, p1, p2, construction };
const circle = (id: string, center: string, radius: number) => ({
  kind: 'circle',
  id,
  center,
  radius,
});
const arc = (id: string, center: string, start: string, end: string) => ({
  kind: 'arc',
  id,
  center,
  start,
  end,
});

/** Rectangle 10 × 5 with points a b c d and lines ab bc cd da, as raw entities. */
const RECT = [
  pt('a', 0, 0),
  pt('b', 10, 0),
  pt('c', 10, 5),
  pt('d', 0, 5),
  ln('ab', 'a', 'b'),
  ln('bc', 'b', 'c'),
  ln('cd', 'c', 'd'),
  ln('da', 'd', 'a'),
];

const ids = (loop: readonly Curve2[]) => loop.map((c) => c.id);

const names = (data: SketchData) => computeRegions(data).regions.map((r) => r.name);

const bspline = (id: string, poles: readonly string[], degree = 3, construction?: true) => ({
  kind: 'bspline',
  id,
  degree,
  poles,
  knots: clamped(poles.length, degree),
  ...(construction === undefined ? {} : { construction }),
});
/** A clamped knot vector with uniform inner knots for `count` poles. */
function clamped(count: number, degree: number): number[] {
  const inner = count - degree - 1;
  return [
    ...Array<number>(degree + 1).fill(0),
    ...Array.from({ length: inner }, (_, i) => (i + 1) / (inner + 1)),
    ...Array<number>(degree + 1).fill(1),
  ];
}
/** A fit spline through named points given with their coordinates. */
const fitSpline = (id: string, fit: readonly (readonly [string, number, number])[]) => {
  const { degree, params, knots, poles } = splineMath.interpolate(
    fit.map(([, x, y]): Vec2 => [x, y]),
  );
  return { kind: 'fitSpline', id, degree, fit: fit.map(([name]) => name), params, poles, knots };
};

const start = (c: Curve2): Vec2 | undefined => {
  if (c.kind === 'circle') return undefined;
  return c.kind === 'bspline' ? c.poles[0] : c.from;
};
const end = (c: Curve2): Vec2 | undefined => {
  if (c.kind === 'circle') return undefined;
  return c.kind === 'bspline' ? c.poles[c.poles.length - 1] : c.to;
};

/** Shoelace of a closed polygon. */
function polygonArea(points: readonly Vec2[]): number {
  let sum = 0;
  points.forEach((p, i) => {
    const q = points[(i + 1) % points.length] ?? p;
    sum += p[0] * q[1] - q[0] * p[1];
  });
  return sum / 2;
}

/** A fine tessellation of a spline from its first point, without the last one (for polygons). */
function fine(c: Curve2 | undefined): Vec2[] {
  if (c?.kind !== 'bspline') throw new Error(`not a spline: ${JSON.stringify(c)}`);
  return splineMath.tessellate(c, 1e-6).slice(0, -1);
}

/** The outer curve with the given id. */
const curveOf = (loop: readonly Curve2[] | undefined, id: string) => loop?.find((c) => c.id === id);

/** Every curve ends where the next one starts (a lone circle is closed by itself). */
function expectClosed(loop: readonly Curve2[]): void {
  if (loop.length === 1 && loop[0]?.kind === 'circle') return;
  loop.forEach((c, i) => {
    const next = loop[(i + 1) % loop.length];
    expect(next).toBeDefined();
    if (next === undefined) return;
    const [ex, ey] = end(c) ?? [Number.NaN, Number.NaN];
    const [sx, sy] = start(next) ?? [Number.NaN, Number.NaN];
    expect(ex).toBeCloseTo(sx, 9);
    expect(ey).toBeCloseTo(sy, 9);
  });
}

/** Shoelace over the curve end points; enough to tell orientation of the loops tested here. */
function chordArea(loop: readonly Curve2[]): number {
  let sum = 0;
  for (const c of loop) {
    const [x1, y1] = start(c) ?? [0, 0];
    const [x2, y2] = end(c) ?? [0, 0];
    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
}

describe('computeRegions', () => {
  it('a rectangle is one counter-clockwise region named after its four lines', () => {
    const { regions, crossing } = computeRegions(rectangleData({ width: 10, height: 5 }));
    expect(crossing).toBe(false);
    expect(regions).toHaveLength(1);
    const [r] = regions;
    expect(r?.name).toBe('ab,bc,cd,da');
    expect(r?.area).toBeCloseTo(50, 9);
    expect(r?.holes).toEqual([]);
    expect(r?.outer).toHaveLength(4);
    expectClosed(r?.outer ?? []);
    expect(chordArea(r?.outer ?? [])).toBeCloseTo(50, 9);
  });

  it('two rectangles sharing an edge are two regions', () => {
    const data = sketch([
      ...RECT,
      pt('e', 20, 0),
      pt('f', 20, 5),
      ln('be', 'b', 'e'),
      ln('ef', 'e', 'f'),
      ln('fc', 'f', 'c'),
    ]);
    const { regions } = computeRegions(data);
    expect(regions.map((r) => r.name)).toEqual(['ab,bc,cd,da', 'bc,be,ef,fc']);
    for (const r of regions) {
      expect(r.area).toBeCloseTo(50, 9);
      expectClosed(r.outer);
      expect(chordArea(r.outer)).toBeGreaterThan(0);
    }
  });

  it('a circle inside a rectangle is a hole and a region of its own', () => {
    const data = sketch([...RECT, pt('o', 5, 2.5), circle('k', 'o', 2)]);
    const { regions } = computeRegions(data);
    expect(regions.map((r) => r.name)).toEqual(['ab,bc,cd,da,k', 'k']);
    const [outer, disc] = regions;
    expect(outer?.area).toBeCloseTo(50 - 4 * Math.PI, 9);
    expect(outer?.holes).toEqual([[{ kind: 'circle', center: [5, 2.5], radius: 2, id: 'k' }]]);
    expect(disc?.area).toBeCloseTo(4 * Math.PI, 9);
    expect(disc?.outer).toEqual([{ kind: 'circle', center: [5, 2.5], radius: 2, id: 'k' }]);
    expect(disc?.holes).toEqual([]);
  });

  it('a polygon hole is clockwise', () => {
    const data = sketch([
      ...RECT,
      pt('p', 2, 1),
      pt('q', 4, 1),
      pt('r', 4, 3),
      ln('pq', 'p', 'q'),
      ln('qr', 'q', 'r'),
      ln('rp', 'r', 'p'),
    ]);
    const { regions } = computeRegions(data);
    expect(regions.map((r) => r.name)).toEqual(['ab,bc,cd,da,pq,qr,rp', 'pq,qr,rp']);
    const hole = regions[0]?.holes[0] ?? [];
    expectClosed(hole);
    expect(chordArea(hole)).toBeCloseTo(-2, 9);
    expect(regions[0]?.area).toBeCloseTo(48, 9);
  });

  it('circle in circle in circle: each ring has the next circle as its hole', () => {
    const data = sketch([
      pt('o', 1, 1),
      circle('k1', 'o', 10),
      circle('k2', 'o', 5),
      circle('k3', 'o', 2),
    ]);
    const { regions } = computeRegions(data);
    expect(regions.map((r) => [r.name, r.holes.length])).toEqual([
      ['k1,k2', 1],
      ['k2,k3', 1],
      ['k3', 0],
    ]);
    expect(regions.map((r) => r.area / Math.PI)).toEqual([
      expect.closeTo(75, 9),
      expect.closeTo(21, 9),
      expect.closeTo(4, 9),
    ]);
  });

  it('a slot of lines and tangent arcs is one region', () => {
    const data = sketch([
      pt('a', 0, 0),
      pt('b', 10, 0),
      pt('c', 10, 10),
      pt('d', 0, 10),
      pt('m1', 10, 5),
      pt('m2', 0, 5),
      ln('l1', 'a', 'b'),
      arc('a1', 'm1', 'b', 'c'),
      ln('l2', 'c', 'd'),
      arc('a2', 'm2', 'd', 'a'),
    ]);
    const { regions, crossing } = computeRegions(data);
    expect(crossing).toBe(false);
    expect(regions.map((r) => r.name)).toEqual(['a1,a2,l1,l2']);
    expect(regions[0]?.area).toBeCloseTo(100 + 25 * Math.PI, 9);
    expectClosed(regions[0]?.outer ?? []);
  });

  it('orders a line and a tangent arc leaving a node in the same direction by curvature', () => {
    // At a, line ab and arc q both leave along +x; q turns left, so it is further
    // counter-clockwise. The upper region is triangle a b c minus the arc's circular segment;
    // triangle a e b below makes a the third edge's node, so the order matters.
    const data = sketch([
      pt('a', 0, 0),
      pt('b', 10, 0),
      pt('c', 5, 5),
      pt('m', 0, 5),
      pt('e', 0, -5),
      ln('ab', 'a', 'b'),
      ln('bc', 'b', 'c'),
      arc('q', 'm', 'a', 'c'),
      ln('ae', 'a', 'e'),
      ln('eb', 'e', 'b'),
    ]);
    const { regions, crossing } = computeRegions(data);
    expect(crossing).toBe(false);
    expect(regions.map((r) => r.name)).toEqual(['ab,ae,eb', 'ab,bc,q']);
    expect(regions[0]?.area).toBeCloseTo(25, 9);
    expect(regions[1]?.area).toBeCloseTo(25 - 12.5 * (Math.PI / 2 - 1), 9);
    const outer = regions[1]?.outer ?? [];
    expectClosed(outer);
    // Traversed counter-clockwise, the arc runs backwards (clockwise).
    expect(outer.find((c) => c.kind === 'arc')).toEqual({
      kind: 'arc',
      center: [0, 5],
      from: [5, 5],
      to: [0, 0],
      ccw: false,
      id: 'q',
    });
  });

  it('an open polyline bounds nothing', () => {
    const data = sketch([
      pt('a', 0, 0),
      pt('b', 10, 0),
      pt('c', 10, 5),
      ln('ab', 'a', 'b'),
      ln('bc', 'b', 'c'),
    ]);
    expect(computeRegions(data)).toEqual({ regions: [], crossing: false });
  });

  it('prunes a dangling tail', () => {
    const data = sketch([
      ...RECT,
      pt('t1', 15, 8),
      pt('t2', 20, 8),
      ln('t', 'c', 't1'),
      ln('u', 't1', 't2'),
    ]);
    const { regions } = computeRegions(data);
    expect(regions.map((r) => r.name)).toEqual(['ab,bc,cd,da']);
    expect(regions[0]?.area).toBeCloseTo(50, 9);
  });

  it('ignores construction curves', () => {
    const data = sketch([
      ...RECT,
      ln('diag', 'a', 'c', true),
      pt('o', 5, 2.5),
      { kind: 'circle', id: 'k', center: 'o', radius: 1, construction: true },
    ]);
    expect(names(data)).toEqual(['ab,bc,cd,da']);
  });

  it('ignores zero-length lines', () => {
    const data = sketch([...RECT, pt('a2', 0, 0), ln('zero', 'a', 'a2')]);
    expect(names(data)).toEqual(['ab,bc,cd,da']);
  });

  it.each([
    [
      'crossing lines',
      [
        pt('p', 0, 0),
        pt('q', 10, 10),
        pt('r', 0, 10),
        pt('s', 10, 0),
        ln('pq', 'p', 'q'),
        ln('rs', 'r', 's'),
      ],
    ],
    ['a line across a rectangle', [...RECT, pt('p', -5, 2), pt('q', 15, 2), ln('pq', 'p', 'q')]],
    [
      'an end touching the inside of a line',
      [...RECT, pt('p', 5, 0), pt('q', 5, -5), ln('pq', 'p', 'q')],
    ],
    ['overlapping collinear lines', [...RECT, pt('p', 2, 0), pt('q', 6, 0), ln('pq', 'p', 'q')]],
    ['a circle through a rectangle edge', [...RECT, pt('o', 10, 2.5), circle('k', 'o', 1)]],
    ['a circle touching a rectangle edge', [...RECT, pt('o', 5, 4), circle('k', 'o', 1)]],
    [
      'two overlapping circles',
      [pt('o', 0, 0), pt('p', 1, 0), circle('k1', 'o', 2), circle('k2', 'p', 2)],
    ],
    ['equal concentric circles', [pt('o', 0, 0), circle('k1', 'o', 2), circle('k2', 'o', 2)]],
  ])('%s cross: no regions', (_name, entities) => {
    expect(computeRegions(sketch(entities))).toEqual({ regions: [], crossing: true });
  });

  it('merges points joined by coincident into one node', () => {
    const data = sketch(
      [
        pt('a1', 0, 0),
        pt('b1', 10, 0),
        pt('b2', 10, 0),
        pt('c2', 10, 5),
        pt('c3', 10, 5),
        pt('a3', 0, 0),
        ln('ab', 'a1', 'b1'),
        ln('bc', 'b2', 'c2'),
        ln('ca', 'c3', 'a3'),
      ],
      [
        { kind: 'coincident', id: 'k1', a: 'b1', b: 'b2' },
        { kind: 'coincident', id: 'k2', a: 'c2', b: 'c3' },
        { kind: 'coincident', id: 'k3', a: 'a3', b: 'a1' },
      ],
    );
    const { regions } = computeRegions(data);
    expect(regions.map((r) => r.name)).toEqual(['ab,bc,ca']);
    expect(regions[0]?.area).toBeCloseTo(25, 9);
  });

  it('keeps the name when coordinates and entity order change', () => {
    const moved = sketch(
      [
        ln('da', 'd', 'a'),
        pt('c', 47, 12),
        ln('bc', 'b', 'c'),
        pt('a', 3, -4),
        ln('cd', 'c', 'd'),
        pt('d', 3, 12),
        ln('ab', 'a', 'b'),
        pt('b', 47, -4),
      ].reverse(),
    );
    expect(names(moved)).toEqual(['ab,bc,cd,da']);
    expect(computeRegions(moved).regions[0]?.area).toBeCloseTo(44 * 16, 9);
  });

  it('every outer curve of a rectangle carries the id of its line (M14)', () => {
    const [r] = computeRegions(sketch(RECT)).regions;
    expect(ids(r?.outer ?? []).sort()).toEqual(['ab', 'bc', 'cd', 'da']);
    expect(r?.name).toBe('ab,bc,cd,da');
  });

  it('a circle hole carries the id of its circle (M14)', () => {
    const data = sketch([...RECT, pt('o', 5, 2.5), circle('k', 'o', 2)]);
    const [outer, disc] = computeRegions(data).regions;
    expect(ids(outer?.outer ?? []).sort()).toEqual(['ab', 'bc', 'cd', 'da']);
    expect(outer?.holes.map(ids)).toEqual([['k']]);
    expect(ids(disc?.outer ?? [])).toEqual(['k']);
  });

  it('a clockwise polygon hole carries the ids of its lines (M14)', () => {
    const data = sketch([
      ...RECT,
      pt('p', 2, 1),
      pt('q', 4, 1),
      pt('r', 4, 3),
      ln('pq', 'p', 'q'),
      ln('qr', 'q', 'r'),
      ln('rp', 'r', 'p'),
    ]);
    const [outer, inner] = computeRegions(data).regions;
    expect(outer?.holes.map((h) => ids(h).sort())).toEqual([['pq', 'qr', 'rp']]);
    expect(ids(inner?.outer ?? []).sort()).toEqual(['pq', 'qr', 'rp']);
  });

  it('a slot keeps the ids of its lines and arcs, reversed or not (M14)', () => {
    const data = sketch([
      pt('a', 0, 0),
      pt('b', 10, 0),
      pt('c', 10, 10),
      pt('d', 0, 10),
      pt('m1', 10, 5),
      pt('m2', 0, 5),
      ln('l1', 'a', 'b'),
      arc('a1', 'm1', 'b', 'c'),
      ln('l2', 'c', 'd'),
      arc('a2', 'm2', 'd', 'a'),
    ]);
    const [r] = computeRegions(data).regions;
    expect(r?.name).toBe('a1,a2,l1,l2');
    expect(ids(r?.outer ?? []).sort()).toEqual(['a1', 'a2', 'l1', 'l2']);
    // The same slot as a hole of a large rectangle: the hole is clockwise, so its arcs are reversed.
    const holed = sketch([
      ...data.entities,
      pt('A', -20, -20),
      pt('B', 30, -20),
      pt('C', 30, 30),
      pt('D', -20, 30),
      ln('AB', 'A', 'B'),
      ln('BC', 'B', 'C'),
      ln('CD', 'C', 'D'),
      ln('DA', 'D', 'A'),
    ]);
    const outer = computeRegions(holed).regions.find((x) => x.holes.length === 1);
    const hole = outer?.holes[0] ?? [];
    expect(hole.filter((c) => c.kind === 'arc').map((c) => [c.ccw, c.id])).toEqual(
      expect.arrayContaining([
        [false, 'a1'],
        [false, 'a2'],
      ]),
    );
    expect(ids(hole).sort()).toEqual(['a1', 'a2', 'l1', 'l2']);
  });

  it('sorts names by string comparison', () => {
    const data = sketch([
      ...rectangleData({ prefix: 'B' }).entities,
      ...rectangleData({ prefix: 'A', x: 20 }).entities,
    ]);
    expect(names(data)).toEqual(['Aab,Abc,Acd,Ada', 'Bab,Bbc,Bcd,Bda']);
  });
});

describe('computeRegions with splines (M29)', () => {
  /**
   * Areas come from a tessellation with tolerance 1e-4 · scale (here 1e-3 to 2e-3): the area
   * between the chords and the curve is up to about 2/3 · tolerance · length (here up to 40).
   */
  const AREA_TOL = 5e-2;

  /** Rectangle 10 × 5 whose right side bc is a cubic spline bulging to x = 13. */
  const SPLINE_RECT = [
    pt('a', 0, 0),
    pt('b', 10, 0),
    pt('s1', 13, 1),
    pt('s2', 13, 4),
    pt('c', 10, 5),
    pt('d', 0, 5),
    ln('ab', 'a', 'b'),
    bspline('bc', ['b', 's1', 's2', 'c']),
    ln('cd', 'c', 'd'),
    ln('da', 'd', 'a'),
  ];

  it('a rectangle with a bspline side is one region carrying the exact spline', () => {
    const { regions, crossing } = computeRegions(sketch(SPLINE_RECT));
    expect(crossing).toBe(false);
    expect(regions.map((r) => r.name)).toEqual(['ab,bc,cd,da']);
    const [r] = regions;
    expect(r?.outer).toHaveLength(4);
    expectClosed(r?.outer ?? []);
    const spline = curveOf(r?.outer, 'bc');
    // Traversed counter-clockwise, the spline runs forward (b → c).
    expect(spline).toEqual({
      kind: 'bspline',
      degree: 3,
      poles: [
        [10, 0],
        [13, 1],
        [13, 4],
        [10, 5],
      ],
      knots: [0, 0, 0, 0, 1, 1, 1, 1],
      id: 'bc',
    });
    const expected = polygonArea([[0, 0], ...fine(spline), [10, 5], [0, 5]]);
    expect(expected).toBeGreaterThan(50);
    expect(Math.abs((r?.area ?? 0) - expected)).toBeLessThan(AREA_TOL);
  });

  it('a rectangle with a fit spline side is one region', () => {
    const data = sketch([
      pt('a', 0, 0),
      pt('b', 10, 0),
      pt('m', 12, 2.5),
      pt('c', 10, 5),
      pt('d', 0, 5),
      ln('ab', 'a', 'b'),
      fitSpline('bc', [
        ['b', 10, 0],
        ['m', 12, 2.5],
        ['c', 10, 5],
      ]),
      ln('cd', 'c', 'd'),
      ln('da', 'd', 'a'),
    ]);
    const { regions } = computeRegions(data);
    expect(regions.map((r) => r.name)).toEqual(['ab,bc,cd,da']);
    const outer = regions[0]?.outer ?? [];
    expectClosed(outer);
    const spline = curveOf(outer, 'bc');
    expect(spline?.kind).toBe('bspline');
    const expected = polygonArea([[0, 0], ...fine(spline), [10, 5], [0, 5]]);
    expect(Math.abs((regions[0]?.area ?? 0) - expected)).toBeLessThan(AREA_TOL);
  });

  /** A closed cubic spline around the square 10 × 10, from p0 back to p4 at the same place. */
  const closedSpline = (
    order: readonly string[],
    constraints: readonly unknown[],
    knots = [0, 0, 0, 0, 0.5, 1, 1, 1, 1],
  ) =>
    sketch(
      [
        pt('p0', 0, 0),
        pt('p1', 10, 0),
        pt('p2', 10, 10),
        pt('p3', 0, 10),
        pt('p4', 0, 0),
        { kind: 'bspline', id: 'sp', degree: 3, poles: order, knots },
      ],
      constraints,
    );

  it.each([
    ['joined by coincident', [{ kind: 'coincident', id: 'k', a: 'p0', b: 'p4' }]],
    ['at the same place', []],
  ])('a closed spline with ends %s is a loop with one node', (_name, constraints) => {
    const data = closedSpline(['p0', 'p1', 'p2', 'p3', 'p4'], constraints);
    const { regions, crossing } = computeRegions(data);
    expect(crossing).toBe(false);
    expect(regions.map((r) => r.name)).toEqual(['sp']);
    const [r] = regions;
    expect(r?.holes).toEqual([]);
    expect(r?.outer).toHaveLength(1);
    expectClosed(r?.outer ?? []);
    const expected = polygonArea(fine(r?.outer[0]));
    expect(expected).toBeGreaterThan(0);
    expect(Math.abs((r?.area ?? 0) - expected)).toBeLessThan(AREA_TOL);
  });

  it('a clockwise closed spline is reversed in the counter-clockwise outer loop', () => {
    const data = closedSpline(['p0', 'p3', 'p2', 'p1', 'p4'], [], [0, 0, 0, 0, 0.25, 1, 1, 1, 1]);
    const { regions } = computeRegions(data);
    expect(regions.map((r) => r.name)).toEqual(['sp']);
    // Reversed: poles in the opposite order, knots mirrored (k → 1 − k, reversed).
    expect(regions[0]?.outer).toEqual([
      {
        kind: 'bspline',
        degree: 3,
        poles: [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
          [0, 0],
        ],
        knots: [0, 0, 0, 0, 0.75, 1, 1, 1, 1],
        id: 'sp',
      },
    ]);
    expect(regions[0]?.area).toBeGreaterThan(0);
  });

  it('a closed spline inside a rectangle is a clockwise hole and a region of its own', () => {
    const data = sketch(
      [
        pt('A', 0, 0),
        pt('B', 20, 0),
        pt('C', 20, 20),
        pt('D', 0, 20),
        ln('AB', 'A', 'B'),
        ln('BC', 'B', 'C'),
        ln('CD', 'C', 'D'),
        ln('DA', 'D', 'A'),
        pt('p0', 5, 5),
        pt('p1', 15, 5),
        pt('p2', 15, 15),
        pt('p3', 5, 15),
        pt('p4', 5, 5),
        bspline('sp', ['p0', 'p1', 'p2', 'p3', 'p4']),
      ],
      [{ kind: 'coincident', id: 'k', a: 'p0', b: 'p4' }],
    );
    const { regions, crossing } = computeRegions(data);
    expect(crossing).toBe(false);
    expect(regions.map((r) => r.name)).toEqual(['AB,BC,CD,DA,sp', 'sp']);
    const [outer, disc] = regions;
    const splineArea = polygonArea(fine(disc?.outer[0]));
    expect(Math.abs((disc?.area ?? 0) - splineArea)).toBeLessThan(AREA_TOL);
    expect(outer?.holes.map(ids)).toEqual([['sp']]);
    expect(polygonArea(fine(outer?.holes[0]?.[0]))).toBeCloseTo(-splineArea, 9);
    expect(Math.abs((outer?.area ?? 0) - (400 - splineArea))).toBeLessThan(AREA_TOL);
  });

  it.each([
    [
      'a spline across a rectangle',
      [
        ...RECT,
        pt('s1', 5, -3),
        pt('s2', 6, 2),
        pt('s3', 7, 8),
        bspline('sp', ['s1', 's2', 's3'], 2),
      ],
    ],
    [
      'a spline end touching the inside of a line',
      [
        ...RECT,
        pt('s1', 5, 0),
        pt('s2', 7, -2),
        pt('s3', 5, -5),
        bspline('sp', ['s1', 's2', 's3'], 2),
      ],
    ],
    [
      'a spline through a circle',
      [
        pt('o', 0, 0),
        circle('k', 'o', 2),
        pt('s1', -5, 0),
        pt('s2', 0, 1),
        pt('s3', 5, 0),
        bspline('sp', ['s1', 's2', 's3'], 2),
      ],
    ],
    [
      'two crossing splines',
      [
        pt('s1', 0, 0),
        pt('s2', 5, 10),
        pt('s3', 10, 0),
        pt('t1', 0, 5),
        pt('t2', 5, -5),
        pt('t3', 10, 5),
        bspline('sp', ['s1', 's2', 's3'], 2),
        bspline('tq', ['t1', 't2', 't3'], 2),
      ],
    ],
    [
      'a closed cubic figure eight',
      [
        pt('o', 10, 5),
        pt('s1', 20, 10),
        pt('s2', 20, 0),
        pt('s3', 0, 10),
        pt('s4', 0, 0),
        pt('o2', 10, 5),
        bspline('sp', ['o', 's1', 's2', 's3', 's4', 'o2']),
      ],
    ],
    [
      // The degree follows the pole count (min(3, n − 1)), so a b a is quadratic: a straight
      // there-and-back curve whose tessellation overlaps itself.
      'a closed spline a b a running back over itself',
      [pt('a', 0, 0), pt('b', 10, 0), pt('a2', 0, 0), bspline('sp', ['a', 'b', 'a2'], 2)],
    ],
    [
      'an open spline turning back onto itself',
      [pt('a', 0, 0), pt('b', 10, 0), pt('c', 5, 0), bspline('sp', ['a', 'b', 'c'], 2)],
    ],
  ])('%s cross: no regions', (_name, entities) => {
    expect(computeRegions(sketch(entities))).toEqual({ regions: [], crossing: true });
  });

  it('keeps the name when coordinates and entity order change', () => {
    const moved = sketch(
      [
        pt('a', -3, -4),
        pt('b', 30, -4),
        pt('s1', 40, 2),
        pt('s2', 35, 9),
        pt('c', 30, 12),
        pt('d', -3, 12),
        ...SPLINE_RECT.slice(6),
      ].reverse(),
    );
    expect(names(sketch(SPLINE_RECT))).toEqual(['ab,bc,cd,da']);
    expect(names(moved)).toEqual(['ab,bc,cd,da']);
  });

  it('ignores construction splines', () => {
    const data = sketch([
      ...RECT,
      pt('s1', 5, -3),
      pt('s2', 6, 2),
      pt('s3', 7, 8),
      bspline('sp', ['s1', 's2', 's3'], 2, true),
    ]);
    expect(computeRegions(data)).toMatchObject({ crossing: false });
    expect(names(data)).toEqual(['ab,bc,cd,da']);
  });

  it('orders a line and a spline leaving a node in the same direction by curvature', () => {
    // At a, line ab and spline q both leave along +x; q turns left, so it is further
    // counter-clockwise. The quadratic spline a p c cuts 2/3 of triangle a p c (25/3) off
    // triangle a b c (25); triangle a e b below makes a the third edge's node.
    const data = sketch([
      pt('a', 0, 0),
      pt('b', 10, 0),
      pt('c', 5, 5),
      pt('p', 5, 0),
      pt('e', 0, -5),
      ln('ab', 'a', 'b'),
      ln('bc', 'b', 'c'),
      bspline('q', ['a', 'p', 'c'], 2),
      ln('ae', 'a', 'e'),
      ln('eb', 'e', 'b'),
    ]);
    const { regions, crossing } = computeRegions(data);
    expect(crossing).toBe(false);
    expect(regions.map((r) => r.name)).toEqual(['ab,ae,eb', 'ab,bc,q']);
    expect(regions[0]?.area).toBeCloseTo(25, 9);
    expect(regions[1]?.area).toBeCloseTo(50 / 3, 2);
    const outer = regions[1]?.outer ?? [];
    expectClosed(outer);
    // Traversed counter-clockwise, the spline runs backwards (c → a).
    expect(curveOf(outer, 'q')).toEqual({
      kind: 'bspline',
      degree: 2,
      poles: [
        [5, 5],
        [5, 0],
        [0, 0],
      ],
      knots: [0, 0, 0, 1, 1, 1],
      id: 'q',
    });
  });
});
