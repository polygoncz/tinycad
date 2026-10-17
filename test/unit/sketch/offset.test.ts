import { describe, expect, it } from 'vitest';
import type { Vec2 } from '@/core';
import type { OffsetCurve2 } from '@/sketch/geometry-port';
import type {
  SketchConstraint,
  SketchConstraintId,
  SketchData,
  SketchEntity,
  SketchEntityId,
} from '@/sketch/model';
import { chainCurves, chainOf, offsetEdit } from '@/sketch/offset';
import type { Chain } from '@/sketch/offset';
import { parseSketchData } from '@/sketch/parse';
import { createFakeSketchGeometry, rectangleData } from '@/sketch/testing';
import type { IdSource, SketchEdit } from '@/sketch/trim';

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

function point(pid: string, x: number, y: number): unknown {
  return { kind: 'point', id: pid, x, y };
}

function line(lid: string, p1: string, p2: string, construction = false): unknown {
  return { kind: 'line', id: lid, p1, p2, ...(construction ? { construction: true } : {}) };
}

function entity(data: SketchData, name: string): SketchEntity | undefined {
  return data.entities.find((e) => e.id === name);
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

/** The points a curve entity uses. */
function usedPoints(e: SketchEntity): readonly string[] {
  switch (e.kind) {
    case 'line':
      return [e.p1, e.p2];
    case 'arc':
      return [e.center, e.start, e.end];
    case 'circle':
      return [e.center];
    case 'bspline':
      return e.poles;
    default:
      return [];
  }
}

/** The edit, checked to be valid sketch data with every point before the curves that use it. */
function valid(edit: SketchEdit | null): SketchEdit {
  expect(edit).not.toBeNull();
  if (edit === null) throw new Error('no edit');
  const r = parseSketchData(edit.data.entities, edit.data.constraints);
  expect(r.ok ? [] : r.error).toEqual([]);
  const seen = new Set<string>();
  for (const e of edit.data.entities) {
    for (const p of usedPoints(e)) expect(seen.has(p), `${p} before ${e.id}`).toBe(true);
    seen.add(e.id);
  }
  return edit;
}

function offsetOf(data: SketchData): Extract<SketchConstraint, { kind: 'offset' }> {
  const c = data.constraints.find((x) => x.kind === 'offset');
  if (c?.kind !== 'offset') throw new Error('no offset constraint');
  return c;
}

/** The copy of the source in the offset constraint. */
function copyOf(data: SketchData, source: string): SketchEntity {
  const pair = offsetOf(data).pairs.find((p) => p.source === source);
  const copy = pair === undefined ? undefined : entity(data, pair.copy);
  if (copy === undefined) throw new Error(`no copy of ${source}`);
  return copy;
}

function chainOrThrow(data: SketchData, curve: string): Chain {
  const chain = chainOf(data, id(curve));
  if (chain === null) throw new Error(`no chain of ${curve}`);
  return chain;
}

/** An L: p(0,0) → q(10,0) as l1, l2 from r(10,5) to q (against the chain). */
const L = sketch([
  point('p', 0, 0),
  point('q', 10, 0),
  point('r', 10, 5),
  line('l1', 'p', 'q'),
  line('l2', 'r', 'q'),
]);

/**
 * A rounded L: l1 p(0,0) → q(8,0), the arc a1 around k(8,2) from q to r(10,2) counter-clockwise,
 * l2 from s(10,10) to r (against the chain from l1).
 */
const ROUNDED_L = sketch([
  point('p', 0, 0),
  point('q', 8, 0),
  point('k', 8, 2),
  point('r', 10, 2),
  point('s', 10, 10),
  line('l1', 'p', 'q'),
  { kind: 'arc', id: 'a1', center: 'k', start: 'q', end: 'r' },
  line('l2', 's', 'r'),
]);

/** A cubic spline sp p0(0,0) … p3(9,0) and a line l from p3 to e(15,0). */
const SPLINE_LINE = sketch([
  point('p0', 0, 0),
  point('p1', 3, 3),
  point('p2', 6, -3),
  point('p3', 9, 0),
  point('e', 15, 0),
  {
    kind: 'bspline',
    id: 'sp',
    degree: 3,
    poles: ['p0', 'p1', 'p2', 'p3'],
    knots: [0, 0, 0, 0, 1, 1, 1, 1],
  },
  line('l', 'p3', 'e'),
]);

const CIRCLE = sketch([point('o', 1, 2), { kind: 'circle', id: 'c', center: 'o', radius: 3 }]);

describe('chainOf', () => {
  it('runs round a rectangle from the clicked curve: closed', () => {
    const data = rectangleData();
    expect(chainOf(data, id('ab'))).toEqual({
      curves: [
        { id: 'ab', reversed: false },
        { id: 'bc', reversed: false },
        { id: 'cd', reversed: false },
        { id: 'da', reversed: false },
      ],
      closed: true,
    });
    expect(chainOf(data, id('cd'))?.curves.map((c) => c.id)).toEqual(['cd', 'da', 'ab', 'bc']);
  });

  it('follows an open L both ways, a curve against the chain reversed', () => {
    expect(chainOf(L, id('l1'))).toEqual({
      curves: [
        { id: 'l1', reversed: false },
        { id: 'l2', reversed: true },
      ],
      closed: false,
    });
    expect(chainOf(L, id('l2'))).toEqual({
      curves: [
        { id: 'l2', reversed: false },
        { id: 'l1', reversed: true },
      ],
      closed: false,
    });
  });

  it('runs through arcs, reversed against their direction', () => {
    expect(chainOf(ROUNDED_L, id('l2'))).toEqual({
      curves: [
        { id: 'l2', reversed: false },
        { id: 'a1', reversed: true },
        { id: 'l1', reversed: true },
      ],
      closed: false,
    });
  });

  it('stops in a point of three curves (a T)', () => {
    const data = sketch([
      point('e', -5, 0),
      point('a', 0, 0),
      point('m', 5, 0),
      point('b', 10, 0),
      point('c', 5, 5),
      line('ea', 'e', 'a'),
      line('t1', 'a', 'm'),
      line('t2', 'm', 'b'),
      line('t3', 'm', 'c'),
    ]);
    expect(chainOf(data, id('t1'))).toEqual({
      curves: [
        { id: 'ea', reversed: false },
        { id: 't1', reversed: false },
      ],
      closed: false,
    });
    expect(chainOf(data, id('t3'))?.curves).toEqual([{ id: 't3', reversed: false }]);
  });

  it('takes a circle alone as a closed chain', () => {
    expect(chainOf(CIRCLE, id('c'))).toEqual({
      curves: [{ id: 'c', reversed: false }],
      closed: true,
    });
  });

  it('does not join construction and non-construction curves', () => {
    const r = rectangleData();
    const data = sketch(
      r.entities.map((e) => (e.id === 'cd' ? { ...e, construction: true } : e)),
      r.constraints,
    );
    expect(chainOf(data, id('ab'))).toEqual({
      curves: [
        { id: 'da', reversed: false },
        { id: 'ab', reversed: false },
        { id: 'bc', reversed: false },
      ],
      closed: false,
    });
    expect(chainOf(data, id('cd'))).toEqual({
      curves: [{ id: 'cd', reversed: false }],
      closed: false,
    });
  });

  it('chains construction curves among themselves', () => {
    const data = sketch([
      point('p', 0, 0),
      point('q', 10, 0),
      point('r', 10, 5),
      line('l1', 'p', 'q', true),
      line('l2', 'q', 'r', true),
    ]);
    expect(chainOf(data, id('l1'))?.curves.map((c) => c.id)).toEqual(['l1', 'l2']);
  });

  it('ignores an infinite line through an end point; is null for it, a point or no entity', () => {
    const data = sketch([
      point('p', 0, 0),
      point('q', 10, 0),
      point('r', 10, 5),
      point('x', 20, 20),
      line('l1', 'p', 'q'),
      line('l2', 'q', 'r'),
      { kind: 'xline', id: 'x1', p1: 'q', p2: 'x', construction: true },
    ]);
    expect(chainOf(data, id('l1'))?.curves.map((c) => c.id)).toEqual(['l1', 'l2']);
    expect(chainOf(data, id('x1'))).toBeNull();
    expect(chainOf(data, id('p'))).toBeNull();
    expect(chainOf(data, id('nope'))).toBeNull();
  });

  it('is frozen', () => {
    const chain = chainOrThrow(rectangleData(), 'ab');
    expect(Object.isFrozen(chain)).toBe(true);
    expect(Object.isFrozen(chain.curves)).toBe(true);
    expect(chain.curves.every((c) => Object.isFrozen(c))).toBe(true);
  });
});

describe('chainCurves', () => {
  it('gives the curves with their ids oriented along the chain', () => {
    expect(chainCurves(L, chainOrThrow(L, 'l1'))).toEqual([
      { kind: 'line', from: [0, 0], to: [10, 0], id: 'l1' },
      { kind: 'line', from: [10, 0], to: [10, 5], id: 'l2' },
    ]);
  });

  it('reverses an arc into a clockwise one', () => {
    const [, arc] = chainCurves(ROUNDED_L, chainOrThrow(ROUNDED_L, 'l2'));
    expect(arc).toEqual({
      kind: 'arc',
      center: [8, 2],
      from: [10, 2],
      to: [8, 0],
      ccw: false,
      id: 'a1',
    });
  });

  it('reverses a spline: poles backwards, knots mirrored', () => {
    const data = sketch([
      point('p0', 0, 0),
      point('p1', 3, 3),
      point('p2', 6, -3),
      point('p3', 9, 0),
      point('p4', 12, 0),
      point('e', 12, -5),
      {
        kind: 'bspline',
        id: 'sp',
        degree: 3,
        poles: ['p0', 'p1', 'p2', 'p3', 'p4'],
        knots: [0, 0, 0, 0, 0.25, 1, 1, 1, 1],
      },
      line('l', 'e', 'p4'),
    ]);
    const [, sp] = chainCurves(data, chainOrThrow(data, 'l'));
    expect(sp).toEqual({
      kind: 'bspline',
      degree: 3,
      poles: [
        [12, 0],
        [9, 0],
        [6, -3],
        [3, 3],
        [0, 0],
      ],
      knots: [0, 0, 0, 0, 0.75, 1, 1, 1, 1],
      id: 'sp',
    });
  });

  it('gives a circle as it is', () => {
    expect(chainCurves(CIRCLE, chainOrThrow(CIRCLE, 'c'))).toEqual([
      { kind: 'circle', center: [1, 2], radius: 3, id: 'c' },
    ]);
  });
});

describe('offsetEdit', () => {
  it('offsets a rectangle outwards: shared corners, a pair per side, the dimension to open', async () => {
    const data = rectangleData();
    const chain = chainOrThrow(data, 'ab');
    const result = await geometry.offset(chainCurves(data, chain), true, 1);
    const edit = valid(offsetEdit(data, { chain, distance: 1, result }, idSource()));
    const next = edit.data;

    // The original stays; four new points, four new lines.
    expect(next.entities.slice(0, data.entities.length)).toEqual(data.entities);
    expect(next.entities).toHaveLength(data.entities.length + 8);
    const off = offsetOf(next);
    expect(off.value).toBe(1);
    expect(off.pairs.map((p) => p.source)).toEqual(['ab', 'bc', 'cd', 'da']);
    expect(edit.added).toEqual(new Set([off.id]));
    expect(edit.edit).toBe(off.id);

    const ab = copyOf(next, 'ab');
    const bc = copyOf(next, 'bc');
    const cd = copyOf(next, 'cd');
    const da = copyOf(next, 'da');
    if (ab.kind !== 'line' || bc.kind !== 'line' || cd.kind !== 'line' || da.kind !== 'line') {
      throw new Error('copies of lines are lines');
    }
    // Neighbouring copies share their corner points.
    expect(ab.p2).toBe(bc.p1);
    expect(bc.p2).toBe(cd.p1);
    expect(cd.p2).toBe(da.p1);
    expect(da.p2).toBe(ab.p1);
    expectPoint(coords(next, ab.p1), [-1, -1]);
    expectPoint(coords(next, bc.p1), [11, -1]);
    expectPoint(coords(next, cd.p1), [11, 6]);
    expectPoint(coords(next, da.p1), [-1, 6]);
  });

  it('takes the value from a negative distance (inwards)', async () => {
    const data = rectangleData();
    const chain = chainOrThrow(data, 'ab');
    const result = await geometry.offset(chainCurves(data, chain), true, -1);
    const next = valid(offsetEdit(data, { chain, distance: -1, result }, idSource())).data;
    expect(offsetOf(next).value).toBe(1);
    const ab = copyOf(next, 'ab');
    if (ab.kind !== 'line') throw new Error('a line');
    expectPoint(coords(next, ab.p1), [1, 1]);
  });

  it('orients a copy of a reversed line like its source', async () => {
    const chain = chainOrThrow(L, 'l1');
    const result = await geometry.offset(chainCurves(L, chain), false, 1);
    const next = valid(offsetEdit(L, { chain, distance: 1, result }, idSource())).data;
    const l1 = copyOf(next, 'l1');
    const l2 = copyOf(next, 'l2');
    if (l1.kind !== 'line' || l2.kind !== 'line') throw new Error('lines');
    // l2 runs r → q, its copy from above down to the shared corner.
    expect(l2.p2).toBe(l1.p2);
    expectPoint(coords(next, l1.p1), [0, -1]);
    expectPoint(coords(next, l1.p2), [11, -1]);
    expectPoint(coords(next, l2.p1), [11, 5]);
  });

  it('gives a circle copy the centre point of its source', () => {
    const chain = chainOrThrow(CIRCLE, 'c');
    const result: OffsetCurve2[] = [{ kind: 'circle', center: [1, 2], radius: 5, source: 'c' }];
    const edit = valid(offsetEdit(CIRCLE, { chain, distance: 2, result }, idSource()));
    expect(edit.data.entities).toHaveLength(3);
    expect(copyOf(edit.data, 'c')).toEqual({ kind: 'circle', id: 'n1', center: 'o', radius: 5 });
    expect(offsetOf(edit.data).value).toBe(2);
  });

  it('gives an arc copy the centre point of its source, through a reversed chain', () => {
    const chain = chainOrThrow(ROUNDED_L, 'l2');
    // Inwards (to the right of s → r → q → p): the hand-made answer of the kernel.
    const result: OffsetCurve2[] = [
      { kind: 'line', from: [9, 10], to: [9, 2], source: 'l2' },
      { kind: 'arc', center: [8, 2], from: [9, 2], to: [8, 1], ccw: false, source: 'a1' },
      { kind: 'line', from: [8, 1], to: [0, 1], source: 'l1' },
    ];
    const next = valid(offsetEdit(ROUNDED_L, { chain, distance: 1, result }, idSource())).data;
    expect(offsetOf(next).pairs.map((p) => p.source)).toEqual(['l2', 'a1', 'l1']);
    const l2 = copyOf(next, 'l2');
    const a1 = copyOf(next, 'a1');
    const l1 = copyOf(next, 'l1');
    if (l2.kind !== 'line' || a1.kind !== 'arc' || l1.kind !== 'line') throw new Error('kinds');
    expect(a1.center).toBe('k');
    // Counter-clockwise from (8, 1) to (9, 2), sharing the ends with the lines.
    expectPoint(coords(next, a1.start), [8, 1]);
    expectPoint(coords(next, a1.end), [9, 2]);
    expect(a1.end).toBe(l2.p2);
    expect(a1.start).toBe(l1.p2);
    // l1 runs p → q: its copy from (0, 1) to (8, 1).
    expectPoint(coords(next, l1.p1), [0, 1]);
    expectPoint(coords(next, l2.p1), [9, 10]);
  });

  it('bakes a spline: new poles, no pair, the end shared with the next copy', () => {
    const chain = chainOrThrow(SPLINE_LINE, 'sp');
    const result: OffsetCurve2[] = [
      {
        kind: 'bspline',
        degree: 3,
        poles: [
          [0, -1],
          [3, 2],
          [4.5, 0],
          [6, -4],
          [9, -1],
        ],
        knots: [0, 0, 0, 0, 0.5, 1, 1, 1, 1],
        source: 'sp',
      },
      { kind: 'line', from: [9, -1], to: [15, -1], source: 'l' },
    ];
    const edit = valid(offsetEdit(SPLINE_LINE, { chain, distance: 1, result }, idSource()));
    const next = edit.data;
    expect(offsetOf(next).pairs.map((p) => p.source)).toEqual(['l']);
    const l = copyOf(next, 'l');
    const sp = next.entities.find((e) => e.kind === 'bspline' && !SPLINE_LINE.entities.includes(e));
    if (l.kind !== 'line' || sp?.kind !== 'bspline') throw new Error('kinds');
    expect(sp.degree).toBe(3);
    expect(sp.knots).toEqual([0, 0, 0, 0, 0.5, 1, 1, 1, 1]);
    expect(sp.poles).toHaveLength(5);
    expect(sp.poles.at(-1)).toBe(l.p1);
    expect(sp.poles.map((p) => coords(next, p))).toEqual([
      [0, -1],
      [3, 2],
      [4.5, 0],
      [6, -4],
      [9, -1],
    ]);
    expect(sp.poles.some((p) => SPLINE_LINE.entities.some((e) => e.id === p))).toBe(false);
  });

  it('pairs nothing of a spline offset with a loop (a line from the spline), only the line', () => {
    const chain = chainOrThrow(SPLINE_LINE, 'sp');
    const piece = (poles: readonly Vec2[]): OffsetCurve2 => ({
      kind: 'bspline',
      degree: 3,
      poles,
      knots: [0, 0, 0, 0, 1, 1, 1, 1],
      source: 'sp',
    });
    const result: OffsetCurve2[] = [
      piece([
        [0, -1],
        [1, 0],
        [2, 0],
        [3, -1],
      ]),
      { kind: 'line', from: [3, -1], to: [6, -1], source: 'sp' },
      piece([
        [6, -1],
        [7, 0],
        [8, 0],
        [9, -1],
      ]),
      { kind: 'line', from: [9, -1], to: [15, -1], source: 'l' },
    ];
    const next = valid(offsetEdit(SPLINE_LINE, { chain, distance: 1, result }, idSource())).data;
    expect(offsetOf(next).pairs.map((p) => p.source)).toEqual(['l']);
    expect(next.entities.length - SPLINE_LINE.entities.length).toBe(4 + 5 + 4);
  });

  it('bakes a join without a source (a rounded corner): a new centre, no pair', () => {
    const chain = chainOrThrow(L, 'l1');
    const result: OffsetCurve2[] = [
      { kind: 'line', from: [0, -1], to: [10, -1], source: 'l1' },
      { kind: 'arc', center: [10, 0], from: [10, -1], to: [11, 0], ccw: true },
      { kind: 'line', from: [11, 0], to: [11, 5], source: 'l2' },
    ];
    const next = valid(offsetEdit(L, { chain, distance: 1, result }, idSource())).data;
    expect(offsetOf(next).pairs.map((p) => p.source)).toEqual(['l1', 'l2']);
    const join = next.entities.find((e) => e.kind === 'arc');
    if (join?.kind !== 'arc') throw new Error('no join');
    expect(join.center).not.toBe('q');
    expectPoint(coords(next, join.center), [10, 0]);
  });

  it('copies are construction when their sources are', async () => {
    const data = sketch([
      point('p', 0, 0),
      point('q', 10, 0),
      point('r', 10, 5),
      line('l1', 'p', 'q', true),
      line('l2', 'q', 'r', true),
    ]);
    const chain = chainOrThrow(data, 'l1');
    const result = await geometry.offset(chainCurves(data, chain), false, 1);
    const next = valid(offsetEdit(data, { chain, distance: 1, result }, idSource())).data;
    expect(copyOf(next, 'l1')).toMatchObject({ construction: true });
    expect(copyOf(next, 'l2')).toMatchObject({ construction: true });
  });

  it('adds no constraint when nothing pairs', () => {
    const data = sketch([
      point('p0', 0, 0),
      point('p1', 3, 3),
      point('p2', 6, -3),
      point('p3', 9, 0),
      {
        kind: 'bspline',
        id: 'sp',
        degree: 3,
        poles: ['p0', 'p1', 'p2', 'p3'],
        knots: [0, 0, 0, 0, 1, 1, 1, 1],
      },
    ]);
    const chain = chainOrThrow(data, 'sp');
    const result: OffsetCurve2[] = [
      {
        kind: 'bspline',
        degree: 3,
        poles: [
          [0, -1],
          [3, 2],
          [6, -4],
          [9, -1],
        ],
        knots: [0, 0, 0, 0, 1, 1, 1, 1],
        source: 'sp',
      },
    ];
    const edit = valid(offsetEdit(data, { chain, distance: 1, result }, idSource()));
    expect(edit.data.constraints).toEqual([]);
    expect(edit.added.size).toBe(0);
    expect(edit.edit).toBeUndefined();
    expect(edit.data.entities).toHaveLength(data.entities.length + 5);
  });

  it('is null for an empty result, a zero distance or a chain of unknown curves', async () => {
    const data = rectangleData();
    const chain = chainOrThrow(data, 'ab');
    const result = await geometry.offset(chainCurves(data, chain), true, 1);
    expect(offsetEdit(data, { chain, distance: 1, result: [] }, idSource())).toBeNull();
    expect(offsetEdit(data, { chain, distance: 0, result }, idSource())).toBeNull();
    expect(offsetEdit(data, { chain, distance: Number.NaN, result }, idSource())).toBeNull();
    const unknown: Chain = { curves: [{ id: id('nope'), reversed: false }], closed: false };
    expect(offsetEdit(data, { chain: unknown, distance: 1, result }, idSource())).toBeNull();
  });
});
