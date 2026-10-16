import { describe, expect, it } from 'vitest';
import type { Vec2 } from '@/core';
import { pointAt } from '@/sketch/curve-param';
import { curve2, pointsById } from '@/sketch/geometry';
import type { Curve2 } from '@/sketch/geometry';
import type { CurveHit } from '@/sketch/geometry-port';
import type {
  SketchConstraint,
  SketchConstraintId,
  SketchCurve,
  SketchData,
  SketchEntity,
  SketchEntityId,
} from '@/sketch/model';
import { parseSketchData } from '@/sketch/parse';
import { createFakeSketchGeometry } from '@/sketch/testing';
import { crossingPoints, cutsOf, extendEdit, pieceAt, splitEdit, trimEdit } from '@/sketch/trim';
import type { CurveCut, IdSource, SketchEdit } from '@/sketch/trim';

// Test-only branding of literals: the ids of test data were parsed, these name them.
const id = (s: string): SketchEntityId => s as SketchEntityId;

function sketch(entities: readonly unknown[], constraints: readonly unknown[] = []): SketchData {
  const r = parseSketchData(entities, constraints);
  if (!r.ok) throw new Error(`invalid test sketch: ${JSON.stringify(r.error)}`);
  return r.value;
}

/** New ids n1, n2… for entities and k1, k2… for constraints. */
function idSource(): IdSource {
  let entities = 0;
  let constraints = 0;
  return {
    entity: () => id(`n${String(++entities)}`),
    // Test-only branding, like id().
    constraint: () => `k${String(++constraints)}` as SketchConstraintId,
  };
}

const geometry = createFakeSketchGeometry();

const isCurve = (e: SketchEntity): e is SketchCurve => e.kind !== 'point';

function curveOf(data: SketchData, name: string): Curve2 {
  const c = data.entities.find((e) => e.id === name);
  if (c === undefined || !isCurve(c)) throw new Error(`no curve ${name}`);
  return curve2(c, pointsById(data));
}

/** The hits of all curves of the data from the fake geometry (no splines). */
function hitsOf(data: SketchData): Promise<readonly CurveHit[]> {
  const points = pointsById(data);
  return geometry.intersections(data.entities.filter(isCurve).map((c) => curve2(c, points)));
}

/** The edit, checked to be valid sketch data (the invariant of spec 12, rule 4). */
function valid(edit: SketchEdit | null): SketchEdit {
  expect(edit).not.toBeNull();
  if (edit === null) throw new Error('no edit');
  const r = parseSketchData(edit.data.entities, edit.data.constraints);
  expect(r.ok ? [] : r.error).toEqual([]);
  return edit;
}

function entity(data: SketchData, name: string): SketchEntity | undefined {
  return data.entities.find((e) => e.id === name);
}

function constraint(data: SketchData, name: string): SketchConstraint | undefined {
  return data.constraints.find((c) => c.id === name);
}

function coords(data: SketchData, name: string): Vec2 {
  const p = entity(data, name);
  if (p?.kind !== 'point') throw new Error(`no point ${name}`);
  return [p.x, p.y];
}

function expectPoint(actual: Vec2, expected: Vec2): void {
  expect(actual[0]).toBeCloseTo(expected[0], 9);
  expect(actual[1]).toBeCloseTo(expected[1], 9);
}

/**
 * A horizontal line h from p (0, 0) to q (10, 0); vertical lines v (x 3) and u (x 7) across it;
 * the line w from w1 (5, 0) on h up to w2 (5, 4); the line s from p down to s2 (0, −4).
 */
const CROSS = sketch(
  [
    { kind: 'point', id: 'p', x: 0, y: 0 },
    { kind: 'point', id: 'q', x: 10, y: 0 },
    { kind: 'line', id: 'h', p1: 'p', p2: 'q' },
    { kind: 'point', id: 'v1', x: 3, y: -5 },
    { kind: 'point', id: 'v2', x: 3, y: 5 },
    { kind: 'line', id: 'v', p1: 'v1', p2: 'v2' },
    { kind: 'point', id: 'w1', x: 5, y: 0 },
    { kind: 'point', id: 'w2', x: 5, y: 4 },
    { kind: 'line', id: 'w', p1: 'w1', p2: 'w2' },
    { kind: 'point', id: 'u1', x: 7, y: -5 },
    { kind: 'point', id: 'u2', x: 7, y: 5 },
    { kind: 'line', id: 'u', p1: 'u1', p2: 'u2' },
    { kind: 'point', id: 's2', x: 0, y: -4 },
    { kind: 'line', id: 's', p1: 'p', p2: 's2' },
  ],
  [
    { kind: 'horizontal', id: 'hh', line: 'h' },
    { kind: 'vertical', id: 'vv', line: 'v' },
    { kind: 'equal', id: 'eq', a: 'h', b: 'v' },
    { kind: 'fix', id: 'fq', point: 'q' },
  ],
);

describe('cutsOf', () => {
  it('sorts the cuts by t, skips the own ends of the curve and names `by` and `at`', async () => {
    const cuts = cutsOf(CROSS, id('h'), await hitsOf(CROSS));
    // s and h share p (an own end of h): no cut.
    expect(cuts.map((c) => [c.by, c.at])).toEqual([
      ['v', null],
      ['w', 'w1'],
      ['u', null],
    ]);
    [0.3, 0.5, 0.7].forEach((t, i) => {
      expect(cuts[i]?.t).toBeCloseTo(t, 9);
    });
    expectPoint(cuts[1]?.point ?? [NaN, NaN], [5, 0]);
  });

  it('cuts a curve at the end of another curve on it (at = that end)', async () => {
    const cuts = cutsOf(CROSS, id('w'), await hitsOf(CROSS));
    // w meets h at its own end w1: no cut on w.
    expect(cuts).toEqual([]);
  });

  it('merges cuts of several curves in one point; by = the first in the order of entities', async () => {
    const data = sketch([
      ...CROSS.entities,
      { kind: 'point', id: 'd1', x: 1, y: -2 },
      { kind: 'point', id: 'd2', x: 5, y: 2 },
      { kind: 'line', id: 'd', p1: 'd1', p2: 'd2' },
    ]);
    const cuts = cutsOf(data, id('h'), await hitsOf(data));
    // d crosses h at (3, 0) like v, but v comes first.
    expect(cuts.map((c) => c.by)).toEqual(['v', 'w', 'u']);
  });

  it('takes `at` from any merged curve that ends there', async () => {
    const data = sketch([
      ...CROSS.entities,
      { kind: 'point', id: 'e2', x: 1, y: 3 },
      { kind: 'line', id: 'e', p1: 'v2', p2: 'e2' },
      { kind: 'point', id: 'f1', x: 3, y: 0 },
      { kind: 'point', id: 'f2', x: 1, y: -3 },
      { kind: 'line', id: 'f', p1: 'f1', p2: 'f2' },
    ]);
    const cuts = cutsOf(data, id('h'), await hitsOf(data));
    expect(cuts[0]).toMatchObject({ by: 'v', at: 'f1' });
  });

  it('ignores hits of curves not in the data (the __extend curve) and of other curves', async () => {
    const extend: Curve2 = { kind: 'line', from: [1, -1], to: [1, 1], id: '__extend' };
    const points = pointsById(CROSS);
    const curves = CROSS.entities.filter(isCurve).map((c) => curve2(c, points));
    const hits = await geometry.intersections([...curves, extend]);
    expect(cutsOf(CROSS, id('h'), hits).map((c) => c.by)).toEqual(['v', 'w', 'u']);
    expect(cutsOf(CROSS, id('nope'), hits)).toEqual([]);
  });

  it('merges a cut at the end of a circle turn (t ≈ 2π) with one at t ≈ 0', () => {
    const data = sketch([
      { kind: 'point', id: 'o', x: 0, y: 0 },
      { kind: 'circle', id: 'k', center: 'o', radius: 2 },
      { kind: 'point', id: 'a1', x: 2, y: -1 },
      { kind: 'point', id: 'a2', x: 2, y: 1 },
      { kind: 'line', id: 'a', p1: 'a1', p2: 'a2' },
      { kind: 'point', id: 'b1', x: 1, y: -1 },
      { kind: 'point', id: 'b2', x: 3, y: 1 },
      { kind: 'line', id: 'b', p1: 'b1', p2: 'b2' },
    ]);
    const hits: CurveHit[] = [
      { a: 'k', b: 'a', point: [2, 0], ta: 0, tb: 0.5 },
      { a: 'k', b: 'b', point: [2, -1e-12], ta: 2 * Math.PI - 5e-13, tb: 0.5 },
    ];
    const cuts = cutsOf(data, id('k'), hits);
    expect(cuts).toHaveLength(1);
    expect(cuts[0]?.by).toBe('a');
  });

  it('a self-intersection of a spline gives two cuts by the spline itself', () => {
    const data = sketch([
      { kind: 'point', id: 'a', x: 0, y: 0 },
      { kind: 'point', id: 'b', x: 4, y: 4 },
      { kind: 'point', id: 'c', x: 4, y: 0 },
      { kind: 'point', id: 'd', x: 0, y: 4 },
      {
        kind: 'bspline',
        id: 'z',
        degree: 3,
        poles: ['a', 'b', 'c', 'd'],
        knots: [0, 0, 0, 0, 1, 1, 1, 1],
      },
    ]);
    const z = curveOf(data, 'z');
    const hits: CurveHit[] = [{ a: 'z', b: 'z', point: pointAt(z, 0.3), ta: 0.3, tb: 0.7 }];
    const cuts = cutsOf(data, id('z'), hits);
    expect(cuts.map((c) => [c.t, c.by, c.at])).toEqual([
      [0.3, 'z', null],
      [0.7, 'z', null],
    ]);
  });
});

describe('crossingPoints (Q093)', () => {
  function hit(a: string, b: string, point: Vec2, extra: Partial<CurveHit> = {}): CurveHit {
    return { a, b, point, ta: 0, tb: 0, ...extra };
  }

  /**
   * The line ab (0,0)–(10,0), the line cd (5,−5)–(5,5) crossing it in (5,0), the line be from
   * the end b of ab to (10,5) and the construction line fg (2,−1)–(2,1) crossing ab in (2,0).
   */
  const CROSSED = sketch([
    { kind: 'point', id: 'a', x: 0, y: 0 },
    { kind: 'point', id: 'b', x: 10, y: 0 },
    { kind: 'line', id: 'ab', p1: 'a', p2: 'b' },
    { kind: 'point', id: 'c', x: 5, y: -5 },
    { kind: 'point', id: 'd', x: 5, y: 5 },
    { kind: 'line', id: 'cd', p1: 'c', p2: 'd' },
    { kind: 'point', id: 'e', x: 10, y: 5 },
    { kind: 'line', id: 'be', p1: 'b', p2: 'e' },
    { kind: 'point', id: 'f', x: 2, y: -1 },
    { kind: 'point', id: 'g', x: 2, y: 1 },
    { kind: 'line', id: 'fg', p1: 'f', p2: 'g', construction: true },
  ]);

  it('the crossings of non-construction curves, not their shared end points', async () => {
    const points = crossingPoints(CROSSED, await hitsOf(CROSSED));
    expect(points).toHaveLength(1);
    expectPoint(points[0] ?? [NaN, NaN], [5, 0]);
    expect(Object.isFrozen(points)).toBe(true);
  });

  it('an end point of one curve on the inside of another (T) is a crossing', () => {
    // cd passes through the end b of ab, which is no end of cd.
    const hits = [hit('ab', 'be', [10, 0]), hit('ab', 'cd', [10, 0])];
    expect(crossingPoints(CROSSED, hits)).toEqual([[10, 0]]);
  });

  it('the ends of overlaps, also in a shared end point', () => {
    const hits = [hit('ab', 'be', [10, 0], { overlap: true })];
    expect(crossingPoints(CROSSED, hits)).toEqual([[10, 0]]);
  });

  it('skips hits with a construction curve and of curves not in the data', () => {
    const hits = [hit('ab', 'fg', [2, 0]), hit('ab', '__extend', [3, 0])];
    expect(crossingPoints(CROSSED, hits)).toEqual([]);
  });

  const spline = (last: Vec2): SketchData =>
    sketch([
      { kind: 'point', id: 'p0', x: 0, y: 0 },
      { kind: 'point', id: 'p1', x: 10, y: 10 },
      { kind: 'point', id: 'p2', x: 10, y: 0 },
      { kind: 'point', id: 'p3', x: last[0], y: last[1] },
      {
        kind: 'bspline',
        id: 's',
        degree: 3,
        poles: ['p0', 'p1', 'p2', 'p3'],
        knots: [0, 0, 0, 0, 1, 1, 1, 1],
      },
    ]);

  it('a self-intersection of a spline, not where a closed spline meets itself in its ends', () => {
    expect(crossingPoints(spline([0, 10]), [hit('s', 's', [5, 4], { ta: 0.3, tb: 0.7 })])).toEqual([
      [5, 4],
    ]);
    expect(crossingPoints(spline([0, 0]), [hit('s', 's', [0, 0], { ta: 0, tb: 1 })])).toEqual([]);
  });
});

describe('pieceAt', () => {
  const cut = (t: number, by = 'v'): CurveCut => ({ t, point: [t, 0], by: id(by), at: null });

  it('a line: between the neighbouring cuts, at the ends up to the end point', () => {
    const line: Curve2 = { kind: 'line', from: [0, 0], to: [10, 0] };
    const cuts = [cut(0.3), cut(0.7)];
    expect(pieceAt(line, cuts, 0.5)).toEqual({ from: 0.3, to: 0.7, start: cuts[0], end: cuts[1] });
    expect(pieceAt(line, cuts, 0.1)).toEqual({ from: 0, to: 0.3, start: null, end: cuts[0] });
    expect(pieceAt(line, cuts, 0.9)).toEqual({ from: 0.7, to: 1, start: cuts[1], end: null });
    expect(pieceAt(line, [], 0.9)).toEqual({ from: 0, to: 1, start: null, end: null });
  });

  it('a circle: cyclic, the piece over angle 0 runs past 2π', () => {
    const circle: Curve2 = { kind: 'circle', center: [0, 0], radius: 1 };
    const cuts = [cut(1), cut(4)];
    expect(pieceAt(circle, cuts, 2)).toEqual({ from: 1, to: 4, start: cuts[0], end: cuts[1] });
    expect(pieceAt(circle, cuts, 5)).toEqual({
      from: 4,
      to: 1 + 2 * Math.PI,
      start: cuts[1],
      end: cuts[0],
    });
    expect(pieceAt(circle, cuts, 0.5)).toEqual({
      from: 4,
      to: 1 + 2 * Math.PI,
      start: cuts[1],
      end: cuts[0],
    });
    expect(pieceAt(circle, [cuts[0] ?? cut(0)], 3)).toEqual({
      from: 1,
      to: 1 + 2 * Math.PI,
      start: cuts[0],
      end: cuts[0],
    });
    expect(pieceAt(circle, [], 3)).toEqual({ from: 0, to: 2 * Math.PI, start: null, end: null });
  });
});

/** Trims the piece of `curve` under the point near. */
async function trim(data: SketchData, curve: string, near: number, pieces?: readonly Curve2[]) {
  const cuts = cutsOf(data, id(curve), await hitsOf(data));
  const piece = pieceAt(curveOf(data, curve), cuts, near);
  return trimEdit(data, { curve: id(curve), piece, ...(pieces ? { pieces } : {}) }, idSource());
}

describe('trimEdit: lines', () => {
  it('a line without a cut is removed (removeItems)', async () => {
    const edit = valid(await trim(CROSS, 's', 0.5));
    expect(entity(edit.data, 's')).toBeUndefined();
    expect(entity(edit.data, 's2')).toBeUndefined();
    // p stays: h uses it.
    expect(entity(edit.data, 'p')).toBeDefined();
    expect(edit.added.size).toBe(0);
  });

  it('a piece at the end shortens the line to the cut: the end is a new point on the cutter', async () => {
    const edit = valid(await trim(CROSS, 'h', 0.9));
    const h = entity(edit.data, 'h');
    expect(h).toMatchObject({ kind: 'line', p1: 'p', p2: 'n1' });
    expectPoint(coords(edit.data, 'n1'), [7, 0]);
    expect(edit.data.constraints.filter((c) => c.kind === 'pointOnCurve')).toEqual([
      { kind: 'pointOnCurve', id: 'k1', point: 'n1', curve: 'u' },
    ]);
    expect([...edit.added]).toEqual(['k1']);
    // q is no longer used: removed with its fix.
    expect(entity(edit.data, 'q')).toBeUndefined();
    expect(constraint(edit.data, 'fq')).toBeUndefined();
    // horizontal stays, equal of two lines goes (the length changed).
    expect(constraint(edit.data, 'hh')).toBeDefined();
    expect(constraint(edit.data, 'eq')).toBeUndefined();
  });

  it('a piece at the start: the line keeps its id and end, the start moves to the cut', async () => {
    const edit = valid(await trim(CROSS, 'h', 0.1));
    expect(entity(edit.data, 'h')).toMatchObject({ p1: 'n1', p2: 'q' });
    expectPoint(coords(edit.data, 'n1'), [3, 0]);
    // p stays: s uses it.
    expect(entity(edit.data, 'p')).toBeDefined();
  });

  it('a piece in the middle gives two lines: the one with the start keeps the id', async () => {
    const edit = valid(await trim(CROSS, 'h', 0.4));
    expect(entity(edit.data, 'h')).toMatchObject({ kind: 'line', p1: 'p', p2: 'n1' });
    // The end at w1 (an end of w): the existing point, no new point.
    expect(entity(edit.data, 'n2')).toMatchObject({ kind: 'line', p1: 'w1', p2: 'q' });
    expect(entity(edit.data, 'n2')).not.toHaveProperty('construction');
    expect(constraint(edit.data, 'hh')).toMatchObject({ line: 'h' });
    expect(constraint(edit.data, 'fq')).toBeDefined();
    expect(edit.data.constraints.filter((c) => c.kind === 'pointOnCurve')).toEqual([
      { kind: 'pointOnCurve', id: 'k1', point: 'n1', curve: 'v' },
    ]);
  });

  it('keeps the construction flag on both pieces', async () => {
    const data = sketch(
      CROSS.entities.map((e) => (e.id === 'h' ? { ...e, construction: true } : e)),
      CROSS.constraints,
    );
    const edit = valid(await trim(data, 'h', 0.6));
    expect(entity(edit.data, 'h')).toMatchObject({ construction: true });
    expect(entity(edit.data, 'n1')).toMatchObject({ kind: 'point' });
    expect(entity(edit.data, 'n2')).toMatchObject({ kind: 'line', construction: true });
  });

  it('drops midpoint and keeps the other constraints of the line', async () => {
    const data = sketch(
      [
        ...CROSS.entities,
        { kind: 'point', id: 'm', x: 5, y: 1 },
        { kind: 'point', id: 'r', x: 9, y: 3 },
      ],
      [
        ...CROSS.constraints,
        { kind: 'midpoint', id: 'mid', point: 'm', line: 'h' },
        { kind: 'pointLineDistance', id: 'pld', point: 'r', line: 'h', value: 3 },
        { kind: 'pointOnCurve', id: 'poc', point: 'r', curve: 'h' },
      ],
    );
    const edit = valid(await trim(data, 'h', 0.9));
    expect(constraint(edit.data, 'mid')).toBeUndefined();
    expect(constraint(edit.data, 'pld')).toMatchObject({ line: 'h' });
    expect(constraint(edit.data, 'poc')).toMatchObject({ curve: 'h' });
  });

  it('drops a constraint that would refer to a defining point of the piece', async () => {
    // pointOnCurve(w1, h): w1 becomes the start of the second piece; it stays on h (the first piece).
    const data = sketch(CROSS.entities, [
      ...CROSS.constraints,
      { kind: 'pointOnCurve', id: 'poc', point: 'w1', curve: 'h' },
    ]);
    const edit = valid(await trim(data, 'h', 0.6));
    expect(entity(edit.data, 'h')).toMatchObject({ p1: 'p', p2: 'w1' });
    expect(constraint(edit.data, 'poc')).toBeUndefined();
  });
});

/** Arc a around o (0, 0) radius 5 from a1 (5, 0) to a2 (−5, 0) ccw; lines x = 3 and x = −3 across. */
const ARC = sketch(
  [
    { kind: 'point', id: 'o', x: 0, y: 0 },
    { kind: 'point', id: 'a1', x: 5, y: 0 },
    { kind: 'point', id: 'a2', x: -5, y: 0 },
    { kind: 'arc', id: 'a', center: 'o', start: 'a1', end: 'a2' },
    { kind: 'point', id: 'l1', x: 3, y: 0 },
    { kind: 'point', id: 'l2', x: 3, y: 10 },
    { kind: 'line', id: 'l', p1: 'l1', p2: 'l2' },
    { kind: 'point', id: 'm1', x: -3, y: 0 },
    { kind: 'point', id: 'm2', x: -3, y: 10 },
    { kind: 'line', id: 'm', p1: 'm1', p2: 'm2' },
  ],
  [{ kind: 'radius', id: 'r', curve: 'a', value: 5 }],
);

describe('trimEdit: arcs', () => {
  it('an arc without a cut is removed', async () => {
    const data = sketch(
      ARC.entities.filter((e) => !['l', 'l1', 'l2', 'm', 'm1', 'm2'].includes(e.id)),
    );
    const edit = valid(await trim(data, 'a', 1));
    expect(entity(edit.data, 'a')).toBeUndefined();
    expect(entity(edit.data, 'o')).toBeUndefined();
  });

  it('a piece at the end shortens the arc', async () => {
    const edit = valid(await trim(ARC, 'a', 3));
    expect(entity(edit.data, 'a')).toMatchObject({
      kind: 'arc',
      center: 'o',
      start: 'a1',
      end: 'n1',
    });
    expectPoint(coords(edit.data, 'n1'), [-3, 4]);
    expect(entity(edit.data, 'a2')).toBeUndefined();
    expect(constraint(edit.data, 'r')).toMatchObject({ curve: 'a' });
  });

  it('a piece in the middle gives two arcs sharing the centre', async () => {
    const edit = valid(await trim(ARC, 'a', Math.PI / 2));
    expect(entity(edit.data, 'a')).toMatchObject({
      kind: 'arc',
      center: 'o',
      start: 'a1',
      end: 'n1',
    });
    expect(entity(edit.data, 'n3')).toMatchObject({
      kind: 'arc',
      center: 'o',
      start: 'n2',
      end: 'a2',
    });
    expectPoint(coords(edit.data, 'n1'), [3, 4]);
    expectPoint(coords(edit.data, 'n2'), [-3, 4]);
    expect([...edit.added]).toHaveLength(2);
  });
});

/** Circle k around o (0, 0) radius 5; lines x = 3 and x = −3 across; a tangent line t at y = 5. */
const CIRCLE = sketch(
  [
    { kind: 'point', id: 'o', x: 0, y: 0 },
    { kind: 'circle', id: 'k', center: 'o', radius: 5 },
    { kind: 'point', id: 'l1', x: 3, y: -10 },
    { kind: 'point', id: 'l2', x: 3, y: 10 },
    { kind: 'line', id: 'l', p1: 'l1', p2: 'l2' },
    { kind: 'point', id: 'm1', x: -3, y: -10 },
    { kind: 'point', id: 'm2', x: -3, y: 10 },
    { kind: 'line', id: 'm', p1: 'm1', p2: 'm2' },
  ],
  [
    { kind: 'diameter', id: 'dia', curve: 'k', value: 10 },
    { kind: 'tangent', id: 'tan', a: 'l', b: 'k' },
  ],
);

describe('trimEdit: circles', () => {
  it('a circle with fewer than two cuts is removed', async () => {
    const data = sketch(CIRCLE.entities.filter((e) => !['m', 'm1', 'm2'].includes(e.id)));
    // l alone crosses k in two points: two cuts; with only one cut (a tangent) nothing is kept.
    const tangent = sketch([
      ...data.entities.filter((e) => !['l', 'l1', 'l2'].includes(e.id)),
      { kind: 'point', id: 't1', x: -10, y: 5 },
      { kind: 'point', id: 't2', x: 10, y: 5 },
      { kind: 'line', id: 't', p1: 't1', p2: 't2' },
    ]);
    const edit = valid(await trim(tangent, 'k', 1));
    expect(entity(edit.data, 'k')).toBeUndefined();
  });

  it('becomes an arc with the same id from the cut after the piece to the cut before it', async () => {
    // The cuts of l at angles ±53°, of m at 180° ± 53°; the piece at angle 0 is between l's cuts.
    const edit = valid(await trim(CIRCLE, 'k', 0));
    const k = entity(edit.data, 'k');
    expect(k).toMatchObject({ kind: 'arc', center: 'o' });
    if (k?.kind !== 'arc') throw new Error('not an arc');
    expectPoint(coords(edit.data, k.start), [3, 4]);
    expectPoint(coords(edit.data, k.end), [3, -4]);
    // Dimensions and tangent of the circle stay with the arc.
    expect(constraint(edit.data, 'dia')).toMatchObject({ curve: 'k' });
    expect(constraint(edit.data, 'tan')).toBeDefined();
    expect(edit.data.constraints.filter((c) => c.kind === 'pointOnCurve')).toHaveLength(2);
  });

  it('a piece over angle 0 between the two last cuts', async () => {
    const data = sketch(CIRCLE.entities.filter((e) => !['m', 'm1', 'm2'].includes(e.id)));
    const edit = valid(await trim(data, 'k', Math.PI));
    const k = entity(edit.data, 'k');
    if (k?.kind !== 'arc') throw new Error('not an arc');
    expectPoint(coords(edit.data, k.start), [3, -4]);
    expectPoint(coords(edit.data, k.end), [3, 4]);
  });
});

/** A cubic Bézier spline z through poles a b c d (one span), crossed by the vertical line x at t = 0.5. */
const SPLINE_ENTITIES = [
  { kind: 'point', id: 'a', x: 0, y: 0 },
  { kind: 'point', id: 'b', x: 2, y: 4 },
  { kind: 'point', id: 'c', x: 6, y: 4 },
  { kind: 'point', id: 'd', x: 8, y: 0 },
  { kind: 'point', id: 'x1', x: 4, y: -1 },
  { kind: 'point', id: 'x2', x: 4, y: 5 },
  { kind: 'line', id: 'x', p1: 'x1', p2: 'x2' },
];
const BSPLINE = sketch([
  ...SPLINE_ENTITIES,
  {
    kind: 'bspline',
    id: 'z',
    degree: 3,
    poles: ['a', 'b', 'c', 'd'],
    knots: [0, 0, 0, 0, 1, 1, 1, 1],
  },
]);

/** The piece [from, to] of a single-span Bézier by de Casteljau, knots rescaled to [0, 1]. */
function bezierPiece(c: Curve2, from: number, to: number): Curve2 {
  if (c.kind !== 'bspline') throw new Error('not a spline');
  const split = (poles: readonly Vec2[], t: number): [Vec2[], Vec2[]] => {
    const left: Vec2[] = [];
    const right: Vec2[] = [];
    let row = [...poles];
    while (row.length > 0) {
      left.push(row[0] ?? [NaN, NaN]);
      right.unshift(row.at(-1) ?? [NaN, NaN]);
      row = row.slice(1).map((p, i): Vec2 => {
        const q = row[i] ?? p;
        return [q[0] + (p[0] - q[0]) * t, q[1] + (p[1] - q[1]) * t];
      });
    }
    return [left, right];
  };
  const [, tail] = split(c.poles, from);
  const [piece] = split(tail, (to - from) / (1 - from));
  return {
    kind: 'bspline',
    degree: c.degree,
    poles: piece,
    knots: c.knots,
    ...(c.id ? { id: c.id } : {}),
  };
}

/** The hit of the line x with the spline z at t = 0.5 (the fake geometry does no splines). */
function splineHits(data: SketchData): readonly CurveHit[] {
  return [{ a: 'z', b: 'x', point: pointAt(curveOf(data, 'z'), 0.5), ta: 0.5, tb: 0.5 }];
}

describe('trimEdit: splines', () => {
  it('a spline without a cut is removed', () => {
    const data = sketch(BSPLINE.entities.filter((e) => !['x', 'x1', 'x2'].includes(e.id)));
    const piece = pieceAt(curveOf(data, 'z'), [], 0.5);
    const edit = valid(trimEdit(data, { curve: id('z'), piece }, idSource()));
    expect(entity(edit.data, 'z')).toBeUndefined();
    expect(entity(edit.data, 'b')).toBeUndefined();
  });

  it('a piece at the end: the kept piece from segment with the original start and new poles', () => {
    const z = curveOf(BSPLINE, 'z');
    const cuts = cutsOf(BSPLINE, id('z'), splineHits(BSPLINE));
    const piece = pieceAt(z, cuts, 0.8);
    const kept = bezierPiece(z, 0, 0.5);
    const edit = valid(trimEdit(BSPLINE, { curve: id('z'), piece, pieces: [kept] }, idSource()));
    const result = entity(edit.data, 'z');
    expect(result).toMatchObject({ kind: 'bspline', degree: 3, knots: [0, 0, 0, 0, 1, 1, 1, 1] });
    if (result?.kind !== 'bspline') throw new Error('not a spline');
    expect(result.poles[0]).toBe('a');
    expect(result.poles).toHaveLength(4);
    // Interior poles are new points at the poles of the piece; the end is the cut point on x.
    result.poles.slice(1).forEach((pole, i) => {
      expectPoint(
        coords(edit.data, pole),
        kept.kind === 'bspline' ? (kept.poles[i + 1] ?? [NaN, NaN]) : [NaN, NaN],
      );
    });
    const end = result.poles[3] ?? id('');
    expect(edit.data.constraints).toContainEqual(
      expect.objectContaining({ kind: 'pointOnCurve', point: end, curve: 'x' }),
    );
    // The old poles b, c, d are not used any more.
    for (const old of ['b', 'c', 'd']) expect(entity(edit.data, old)).toBeUndefined();
  });

  it('a piece in the middle: two pieces, the one with the start keeps the id', () => {
    const data = sketch([
      ...BSPLINE.entities,
      { kind: 'point', id: 'y1', x: 6.5, y: -1 },
      { kind: 'point', id: 'y2', x: 6.5, y: 5 },
      { kind: 'line', id: 'y', p1: 'y1', p2: 'y2' },
    ]);
    const z = curveOf(data, 'z');
    const hits: CurveHit[] = [
      ...splineHits(data),
      { a: 'z', b: 'y', point: pointAt(z, 0.8), ta: 0.8, tb: 0.5 },
    ];
    const piece = pieceAt(z, cutsOf(data, id('z'), hits), 0.6);
    expect([piece.from, piece.to]).toEqual([0.5, 0.8]);
    const pieces = [bezierPiece(z, 0, 0.5), bezierPiece(z, 0.8, 1)];
    const edit = valid(trimEdit(data, { curve: id('z'), piece, pieces }, idSource()));
    const first = entity(edit.data, 'z');
    const second = edit.data.entities.find((e) => e.kind === 'bspline' && e.id !== 'z');
    if (first?.kind !== 'bspline' || second?.kind !== 'bspline') throw new Error('no pieces');
    expect(first.poles[0]).toBe('a');
    expect(second.poles.at(-1)).toBe('d');
  });

  it('a fitSpline becomes a bspline with the same id; its fit points go', () => {
    const data = sketch([
      ...SPLINE_ENTITIES,
      { kind: 'point', id: 'f2', x: 4, y: 3 },
      {
        kind: 'fitSpline',
        id: 'z',
        degree: 2,
        fit: ['a', 'f2', 'd'],
        params: [0, 0.5, 1],
        poles: [
          [0, 0],
          [4, 6],
          [8, 0],
        ],
        knots: [0, 0, 0, 1, 1, 1],
      },
    ]);
    const z = curveOf(data, 'z');
    const piece = pieceAt(z, cutsOf(data, id('z'), splineHits(data)), 0.2);
    const kept = bezierPiece(z, 0.5, 1);
    const edit = valid(trimEdit(data, { curve: id('z'), piece, pieces: [kept] }, idSource()));
    const result = entity(edit.data, 'z');
    expect(result).toMatchObject({ kind: 'bspline', degree: 2 });
    if (result?.kind !== 'bspline') throw new Error('not a spline');
    expect(result.poles.at(-1)).toBe('d');
    expect(entity(edit.data, 'a')).toBeUndefined();
    expect(entity(edit.data, 'f2')).toBeUndefined();
  });

  it('pointOnCurve on the spline goes to the piece the point lies on, or is dropped', () => {
    const z = curveOf(BSPLINE, 'z');
    const [p1, p2, p3] = [0.2, 0.6, 0.9].map((t) => pointAt(z, t));
    const data = sketch(
      [
        ...BSPLINE.entities,
        { kind: 'point', id: 'y1', x: 6.5, y: -1 },
        { kind: 'point', id: 'y2', x: 6.5, y: 5 },
        { kind: 'line', id: 'y', p1: 'y1', p2: 'y2' },
        { kind: 'point', id: 'r1', x: p1?.[0], y: p1?.[1] },
        { kind: 'point', id: 'r2', x: p2?.[0], y: p2?.[1] },
        { kind: 'point', id: 'r3', x: p3?.[0], y: p3?.[1] },
      ],
      [
        { kind: 'pointOnCurve', id: 'o1', point: 'r1', curve: 'z' },
        { kind: 'pointOnCurve', id: 'o2', point: 'r2', curve: 'z' },
        { kind: 'pointOnCurve', id: 'o3', point: 'r3', curve: 'z' },
      ],
    );
    const hits: CurveHit[] = [
      ...splineHits(data),
      { a: 'z', b: 'y', point: pointAt(z, 0.8), ta: 0.8, tb: 0.5 },
    ];
    const piece = pieceAt(z, cutsOf(data, id('z'), hits), 0.6);
    const pieces = [bezierPiece(z, 0, 0.5), bezierPiece(z, 0.8, 1)];
    const edit = valid(trimEdit(data, { curve: id('z'), piece, pieces }, idSource()));
    const second = edit.data.entities.find((e) => e.kind === 'bspline' && e.id !== 'z');
    expect(constraint(edit.data, 'o1')).toMatchObject({ curve: 'z' });
    expect(constraint(edit.data, 'o2')).toBeUndefined();
    expect(constraint(edit.data, 'o3')).toMatchObject({ curve: second?.id });
  });

  it('a tangent of a line at the start of the spline stays while the piece keeps the start', () => {
    const data = sketch(
      [
        ...BSPLINE.entities,
        { kind: 'point', id: 'g', x: -2, y: -4 },
        { kind: 'line', id: 'gl', p1: 'g', p2: 'a' },
      ],
      [{ kind: 'tangent', id: 'tg', a: 'gl', b: 'z' }],
    );
    const z = curveOf(data, 'z');
    const cuts = cutsOf(data, id('z'), splineHits(data));
    const keepStart = valid(
      trimEdit(
        data,
        { curve: id('z'), piece: pieceAt(z, cuts, 0.8), pieces: [bezierPiece(z, 0, 0.5)] },
        idSource(),
      ),
    );
    expect(constraint(keepStart.data, 'tg')).toBeDefined();
    const loseStart = valid(
      trimEdit(
        data,
        { curve: id('z'), piece: pieceAt(z, cuts, 0.2), pieces: [bezierPiece(z, 0.5, 1)] },
        idSource(),
      ),
    );
    expect(constraint(loseStart.data, 'tg')).toBeUndefined();
    // a stays: gl uses it.
    expect(entity(loseStart.data, 'a')).toBeDefined();
  });

  it('a tangent of a line at the end of the spline goes to the piece holding the end', () => {
    const data = sketch(
      [
        ...BSPLINE.entities,
        { kind: 'point', id: 'g', x: 10, y: -4 },
        { kind: 'line', id: 'gl', p1: 'd', p2: 'g' },
      ],
      [{ kind: 'tangent', id: 'tg', a: 'gl', b: 'z' }],
    );
    const z = curveOf(data, 'z');
    const pieces = [bezierPiece(z, 0, 0.3), bezierPiece(z, 0.3, 1)] as const;
    const split = valid(splitEdit(data, { curve: id('z'), where: 0.3, pieces }, idSource()));
    const second = split.data.entities.find((e) => e.kind === 'bspline' && e.id !== 'z');
    expect(constraint(split.data, 'tg')).toEqual({
      kind: 'tangent',
      id: 'tg',
      a: 'gl',
      b: second?.id,
    });

    // Trimming away the piece with the end: no piece holds d, the tangent goes.
    const cuts = cutsOf(data, id('z'), splineHits(data));
    const trimmed = valid(
      trimEdit(
        data,
        { curve: id('z'), piece: pieceAt(z, cuts, 0.8), pieces: [bezierPiece(z, 0, 0.5)] },
        idSource(),
      ),
    );
    expect(constraint(trimmed.data, 'tg')).toBeUndefined();
  });

  it('removing a loop of a self-intersection: both pieces share one new point, no pointOnCurve', () => {
    const z = curveOf(BSPLINE, 'z');
    const crossing = pointAt(z, 0.3);
    const hits: CurveHit[] = [{ a: 'z', b: 'z', point: crossing, ta: 0.3, tb: 0.7 }];
    const cuts = cutsOf(BSPLINE, id('z'), hits);
    expect(cuts).toHaveLength(2);
    const piece = pieceAt(z, cuts, 0.5);
    const pieces = [bezierPiece(z, 0, 0.3), bezierPiece(z, 0.7, 1)];
    const edit = valid(trimEdit(BSPLINE, { curve: id('z'), piece, pieces }, idSource()));
    const first = entity(edit.data, 'z');
    const second = edit.data.entities.find((e) => e.kind === 'bspline' && e.id !== 'z');
    if (first?.kind !== 'bspline' || second?.kind !== 'bspline') throw new Error('no pieces');
    expect(first.poles.at(-1)).toBe(second.poles[0]);
    expectPoint(coords(edit.data, second.poles[0] ?? id('')), crossing);
    expect(edit.added.size).toBe(0);
    expect(edit.data.constraints.filter((c) => c.kind === 'pointOnCurve')).toEqual([]);
  });
});

describe('extendEdit', () => {
  /** A line e from e1 (0, 0) to e2 (2, 0); a vertical line v at x = 6; arc a around (0, 10). */
  const DATA = sketch(
    [
      { kind: 'point', id: 'e1', x: 0, y: 0 },
      { kind: 'point', id: 'e2', x: 2, y: 0 },
      { kind: 'line', id: 'e', p1: 'e1', p2: 'e2' },
      { kind: 'point', id: 'v1', x: 6, y: -5 },
      { kind: 'point', id: 'v2', x: 6, y: 5 },
      { kind: 'line', id: 'v', p1: 'v1', p2: 'v2' },
      { kind: 'point', id: 'w1', x: -4, y: 0 },
      { kind: 'point', id: 'w2', x: -4, y: 5 },
      { kind: 'line', id: 'w', p1: 'w1', p2: 'w2' },
      { kind: 'point', id: 'o', x: 0, y: 10 },
      { kind: 'point', id: 'a1', x: 5, y: 10 },
      { kind: 'point', id: 'a2', x: 0, y: 15 },
      { kind: 'arc', id: 'a', center: 'o', start: 'a1', end: 'a2' },
      { kind: 'point', id: 'm', x: 1, y: 1 },
    ],
    [
      { kind: 'horizontal', id: 'he', line: 'e' },
      { kind: 'equal', id: 'eq', a: 'e', b: 'v' },
      { kind: 'midpoint', id: 'mid', point: 'm', line: 'e' },
      { kind: 'fix', id: 'f2', point: 'e2' },
    ],
  );

  it('moves the end of a line to a new point on the target curve', () => {
    const edit = valid(
      extendEdit(DATA, { curve: id('e'), end: 'end', point: [6, 0], by: id('v') }, idSource()),
    );
    expect(entity(edit.data, 'e')).toMatchObject({ p1: 'e1', p2: 'n1' });
    expectPoint(coords(edit.data, 'n1'), [6, 0]);
    expect(constraint(edit.data, 'k1')).toEqual({
      kind: 'pointOnCurve',
      id: 'k1',
      point: 'n1',
      curve: 'v',
    });
    expect([...edit.added]).toEqual(['k1']);
    // The old end is not used any more: gone with its fix; equal and midpoint go, horizontal stays.
    expect(entity(edit.data, 'e2')).toBeUndefined();
    expect(constraint(edit.data, 'f2')).toBeUndefined();
    expect(constraint(edit.data, 'eq')).toBeUndefined();
    expect(constraint(edit.data, 'mid')).toBeUndefined();
    expect(constraint(edit.data, 'he')).toBeDefined();
  });

  it('extends the start to an end of the target: the existing point', () => {
    const edit = valid(
      extendEdit(DATA, { curve: id('e'), end: 'start', point: [-4, 0], by: id('w') }, idSource()),
    );
    expect(entity(edit.data, 'e')).toMatchObject({ p1: 'w1', p2: 'e2' });
    expect(edit.added.size).toBe(0);
    expect(entity(edit.data, 'e1')).toBeUndefined();
  });

  it('keeps the old end point another entity uses', () => {
    const data = sketch(
      [
        ...DATA.entities,
        { kind: 'point', id: 'g', x: 2, y: -3 },
        { kind: 'line', id: 'gl', p1: 'e2', p2: 'g' },
      ],
      DATA.constraints,
    );
    const edit = valid(
      extendEdit(data, { curve: id('e'), end: 'end', point: [6, 0], by: id('v') }, idSource()),
    );
    expect(entity(edit.data, 'e2')).toBeDefined();
    expect(constraint(edit.data, 'f2')).toBeDefined();
  });

  it('extends an arc along its circle', () => {
    const p: Vec2 = [-5, 10];
    const edit = valid(
      extendEdit(DATA, { curve: id('a'), end: 'end', point: p, by: id('w') }, idSource()),
    );
    expect(entity(edit.data, 'a')).toMatchObject({
      kind: 'arc',
      center: 'o',
      start: 'a1',
      end: 'n1',
    });
    expectPoint(coords(edit.data, 'n1'), p);
  });

  it('does nothing for a circle, a spline, an unknown target or the curve itself', () => {
    const data = sketch([...DATA.entities, { kind: 'circle', id: 'k', center: 'o', radius: 1 }]);
    const ids = idSource();
    expect(
      extendEdit(data, { curve: id('k'), end: 'end', point: [6, 0], by: id('v') }, ids),
    ).toBeNull();
    expect(
      extendEdit(data, { curve: id('e'), end: 'end', point: [6, 0], by: id('nope') }, ids),
    ).toBeNull();
    expect(
      extendEdit(data, { curve: id('e'), end: 'end', point: [6, 0], by: id('e') }, ids),
    ).toBeNull();
    expect(
      extendEdit(data, { curve: id('nope'), end: 'end', point: [6, 0], by: id('v') }, ids),
    ).toBeNull();
  });

  it('does nothing when the new end would be the other end', () => {
    expect(
      extendEdit(DATA, { curve: id('e'), end: 'end', point: [0, 0], by: id('w') }, idSource()),
    ).toBeNull();
  });
});

describe('splitEdit', () => {
  it('splits a line at a parameter: two lines sharing a new point, parallel between them', () => {
    const edit = valid(splitEdit(CROSS, { curve: id('h'), where: 0.2 }, idSource()));
    expect(entity(edit.data, 'h')).toMatchObject({ p1: 'p', p2: 'n1' });
    expect(entity(edit.data, 'n2')).toMatchObject({ kind: 'line', p1: 'n1', p2: 'q' });
    expectPoint(coords(edit.data, 'n1'), [2, 0]);
    expect(constraint(edit.data, 'k1')).toEqual({ kind: 'parallel', id: 'k1', a: 'h', b: 'n2' });
    expect([...edit.added]).toEqual(['k1']);
    // equal of two lines goes (the length changed); horizontal and fix stay.
    expect(constraint(edit.data, 'eq')).toBeUndefined();
    expect(constraint(edit.data, 'hh')).toBeDefined();
    expect(constraint(edit.data, 'fq')).toBeDefined();
  });

  it('puts the new points before the pieces that use them (the solver needs them first)', () => {
    const edit = valid(splitEdit(CROSS, { curve: id('h'), where: 0.2 }, idSource()));
    const ids = edit.data.entities.map((e) => e.id);
    expect(ids.indexOf(id('n1'))).toBeLessThan(ids.indexOf(id('h')));
    expect(ids.indexOf(id('h'))).toBeLessThan(ids.indexOf(id('n2')));
  });

  it('splits at a cut: a new point on the cutter, or the existing end of the cutter', async () => {
    const cuts = cutsOf(CROSS, id('h'), await hitsOf(CROSS));
    const [atV, atW] = cuts;
    if (atV === undefined || atW === undefined) throw new Error('no cuts');
    const onV = valid(splitEdit(CROSS, { curve: id('h'), where: atV }, idSource()));
    expect(onV.data.constraints).toContainEqual({
      kind: 'pointOnCurve',
      id: 'k1',
      point: 'n1',
      curve: 'v',
    });
    expect([...onV.added].sort()).toEqual(['k1', 'k2']);
    const onW = valid(splitEdit(CROSS, { curve: id('h'), where: atW }, idSource()));
    expect(entity(onW.data, 'h')).toMatchObject({ p2: 'w1' });
    expect(entity(onW.data, 'n1')).toMatchObject({ kind: 'line', p1: 'w1', p2: 'q' });
  });

  it('does nothing at an end of the curve', () => {
    expect(splitEdit(CROSS, { curve: id('h'), where: 0 }, idSource())).toBeNull();
    expect(splitEdit(CROSS, { curve: id('h'), where: 1 }, idSource())).toBeNull();
    expect(splitEdit(CROSS, { curve: id('p'), where: 0.5 }, idSource())).toBeNull();
  });

  it('splits an arc into two arcs sharing the centre and the point', () => {
    const edit = valid(splitEdit(ARC, { curve: id('a'), where: Math.PI / 2 }, idSource()));
    expect(entity(edit.data, 'a')).toMatchObject({ center: 'o', start: 'a1', end: 'n1' });
    expect(entity(edit.data, 'n2')).toMatchObject({
      kind: 'arc',
      center: 'o',
      start: 'n1',
      end: 'a2',
    });
    expectPoint(coords(edit.data, 'n1'), [0, 5]);
    expect(constraint(edit.data, 'r')).toMatchObject({ curve: 'a' });
    expect(edit.added.size).toBe(0);
  });

  it('splits a circle in the point and the opposite one; the arc starting at the smaller t keeps the id', () => {
    const edit = valid(splitEdit(CIRCLE, { curve: id('k'), where: Math.PI / 2 }, idSource()));
    expect(entity(edit.data, 'k')).toMatchObject({
      kind: 'arc',
      center: 'o',
      start: 'n1',
      end: 'n2',
    });
    expect(entity(edit.data, 'n3')).toMatchObject({
      kind: 'arc',
      center: 'o',
      start: 'n2',
      end: 'n1',
    });
    expectPoint(coords(edit.data, 'n1'), [0, 5]);
    expectPoint(coords(edit.data, 'n2'), [0, -5]);
    expect(constraint(edit.data, 'dia')).toMatchObject({ curve: 'k' });
    expect(constraint(edit.data, 'tan')).toBeDefined();

    const late = valid(splitEdit(CIRCLE, { curve: id('k'), where: (3 * Math.PI) / 2 }, idSource()));
    // The opposite point (t = π/2) starts the arc with the id.
    expect(entity(late.data, 'k')).toMatchObject({ start: 'n2', end: 'n1' });
    expectPoint(coords(late.data, 'n2'), [0, 5]);
  });

  it('splits a spline into two pieces from segment sharing the point', () => {
    const z = curveOf(BSPLINE, 'z');
    const pieces = [bezierPiece(z, 0, 0.3), bezierPiece(z, 0.3, 1)] as const;
    const edit = valid(splitEdit(BSPLINE, { curve: id('z'), where: 0.3, pieces }, idSource()));
    const first = entity(edit.data, 'z');
    const second = edit.data.entities.find((e) => e.kind === 'bspline' && e.id !== 'z');
    if (first?.kind !== 'bspline' || second?.kind !== 'bspline') throw new Error('no pieces');
    expect(first.poles[0]).toBe('a');
    expect(second.poles.at(-1)).toBe('d');
    expect(first.poles.at(-1)).toBe(second.poles[0]);
    expectPoint(coords(edit.data, second.poles[0] ?? id('')), pointAt(z, 0.3));
  });
});

describe('the infinite line (M31)', () => {
  // The line l (0,0)–(10,0) and the xline x through (5,−1) and (5,1).
  const WITH_XLINE = sketch([
    { kind: 'point', id: 'l1', x: 0, y: 0 },
    { kind: 'point', id: 'l2', x: 10, y: 0 },
    { kind: 'line', id: 'l', p1: 'l1', p2: 'l2' },
    { kind: 'point', id: 'x1', x: 5, y: -1 },
    { kind: 'point', id: 'x2', x: 5, y: 1 },
    { kind: 'xline', id: 'x', p1: 'x1', p2: 'x2', construction: true },
  ]);

  it('cuts other curves like any curve', async () => {
    const cuts = cutsOf(WITH_XLINE, id('l'), await hitsOf(WITH_XLINE));
    expect(cuts.map((c) => [c.by, c.at])).toEqual([['x', null]]);
    expectPoint(cuts[0]?.point ?? [NaN, NaN], [5, 0]);
  });

  it('is not trimmed itself: no ends, the edit is null', async () => {
    const hits = await hitsOf(WITH_XLINE);
    const piece = pieceAt(curveOf(WITH_XLINE, 'x'), cutsOf(WITH_XLINE, id('x'), hits), 0.25);
    expect(trimEdit(WITH_XLINE, { curve: id('x'), piece }, idSource())).toBeNull();
  });
});
