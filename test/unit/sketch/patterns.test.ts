import { describe, expect, it } from 'vitest';
import type { SketchCurve, SketchData, SketchPoint } from '@/sketch/model';
import { parseSketchData } from '@/sketch/parse';
import { patternCopies, patternOfCopy } from '@/sketch/patterns';

function sketch(entities: readonly unknown[]): SketchData {
  const r = parseSketchData(entities, []);
  if (!r.ok) throw new Error(`invalid test sketch: ${JSON.stringify(r.error)}`);
  return r.value;
}

const P = (id: string, x: number, y: number) => ({ kind: 'point', id, x, y });

/** A line a → b from [1, 0] to [3, 0]; a vertical axis o → u (x = 0). */
const BASE: readonly unknown[] = [
  P('a', 1, 0),
  P('b', 3, 0),
  { kind: 'line', id: 'ab', p1: 'a', p2: 'b' },
  P('o', 0, 0),
  P('u', 0, 5),
  { kind: 'line', id: 'ou', p1: 'o', p2: 'u', construction: true },
];

type Copy = SketchPoint | SketchCurve;

function byId(copies: readonly Copy[]): ReadonlyMap<string, Copy> {
  return new Map(copies.map((c) => [c.id, c]));
}

function pointAt(copies: readonly Copy[], id: string): readonly [number, number] {
  const p = byId(copies).get(id);
  if (p?.kind !== 'point') throw new Error(`no point copy ${id}`);
  return [p.x, p.y];
}

function expectPoint(copies: readonly Copy[], id: string, x: number, y: number): void {
  const [px, py] = pointAt(copies, id);
  expect(px).toBeCloseTo(x, 9);
  expect(py).toBeCloseTo(y, 9);
}

const ids = (copies: readonly Copy[]) => copies.map((c) => c.id);

describe('patternCopies – mirror', () => {
  it('mirrors a line across the axis: points before the curve, derived ids with index 1', () => {
    const data = sketch([...BASE, { kind: 'mirror', id: 'm', sources: ['ab'], axis: 'ou' }]);
    const copies = patternCopies(data);
    expect(ids(copies)).toEqual(['m:1.a', 'm:1.b', 'm:1.ab']);
    expectPoint(copies, 'm:1.a', -1, 0);
    expectPoint(copies, 'm:1.b', -3, 0);
    expect(byId(copies).get('m:1.ab')).toEqual({
      kind: 'line',
      id: 'm:1.ab',
      p1: 'm:1.a',
      p2: 'm:1.b',
    });
  });

  it('mirrors across a slanted axis', () => {
    // Axis y = x through o and w: [1, 0] → [0, 1].
    const data = sketch([
      ...BASE,
      P('w', 2, 2),
      { kind: 'line', id: 'ow', p1: 'o', p2: 'w' },
      { kind: 'mirror', id: 'm', sources: ['a'], axis: 'ow' },
    ]);
    const copies = patternCopies(data);
    expect(ids(copies)).toEqual(['m:1.a']);
    expectPoint(copies, 'm:1.a', 0, 1);
  });

  it('mirrors an arc with start and end swapped, so it stays counter-clockwise', () => {
    // Quarter arc around c [2, 0] from s [3, 0] to e [2, 1]; mirror across x = 0.
    const data = sketch([
      ...BASE,
      P('c', 2, 0),
      P('s', 3, 0),
      P('e', 2, 1),
      { kind: 'arc', id: 'q', center: 'c', start: 's', end: 'e' },
      { kind: 'mirror', id: 'm', sources: ['q'], axis: 'ou' },
    ]);
    const copies = patternCopies(data);
    expect(ids(copies)).toEqual(['m:1.c', 'm:1.s', 'm:1.e', 'm:1.q']);
    expect(byId(copies).get('m:1.q')).toEqual({
      kind: 'arc',
      id: 'm:1.q',
      center: 'm:1.c',
      start: 'm:1.e',
      end: 'm:1.s',
    });
    expectPoint(copies, 'm:1.s', -3, 0);
    expectPoint(copies, 'm:1.e', -2, 1);
    // The mirrored arc goes counter-clockwise from [-2, 1] to [-3, 0]: through the upper left.
    const c = pointAt(copies, 'm:1.c');
    const start = pointAt(copies, 'm:1.e');
    const end = pointAt(copies, 'm:1.s');
    const cross = (start[0] - c[0]) * (end[1] - c[1]) - (start[1] - c[1]) * (end[0] - c[0]);
    expect(cross).toBeGreaterThan(0);
  });

  it('mirrors a circle by its centre only', () => {
    const data = sketch([
      ...BASE,
      P('c', 2, 3),
      { kind: 'circle', id: 'k', center: 'c', radius: 1.5 },
      { kind: 'mirror', id: 'm', sources: ['k'], axis: 'ou' },
    ]);
    const copies = patternCopies(data);
    expect(byId(copies).get('m:1.k')).toEqual({
      kind: 'circle',
      id: 'm:1.k',
      center: 'm:1.c',
      radius: 1.5,
    });
    expectPoint(copies, 'm:1.c', -2, 3);
  });

  it('mirrors a control point spline by its poles, knots unchanged', () => {
    const knots = [0, 0, 0, 1, 1, 1];
    const data = sketch([
      ...BASE,
      P('p0', 1, 1),
      P('p1', 2, 3),
      P('p2', 4, 1),
      { kind: 'bspline', id: 'sp', degree: 2, poles: ['p0', 'p1', 'p2'], knots },
      { kind: 'mirror', id: 'm', sources: ['sp'], axis: 'ou' },
    ]);
    const copies = patternCopies(data);
    expect(ids(copies)).toEqual(['m:1.p0', 'm:1.p1', 'm:1.p2', 'm:1.sp']);
    expect(byId(copies).get('m:1.sp')).toEqual({
      kind: 'bspline',
      id: 'm:1.sp',
      degree: 2,
      poles: ['m:1.p0', 'm:1.p1', 'm:1.p2'],
      knots,
    });
    expectPoint(copies, 'm:1.p1', -2, 3);
  });

  it('mirrors a fit point spline: fit points and stored poles, params and knots unchanged', () => {
    const data = sketch([
      ...BASE,
      P('f0', 1, 1),
      P('f1', 4, 2),
      {
        kind: 'fitSpline',
        id: 'fs',
        degree: 1,
        fit: ['f0', 'f1'],
        params: [0, 1],
        poles: [
          [1, 1],
          [4, 2],
        ],
        knots: [0, 0, 1, 1],
        construction: true,
      },
      { kind: 'mirror', id: 'm', sources: ['fs'], axis: 'ou' },
    ]);
    const copies = patternCopies(data);
    const copy = byId(copies).get('m:1.fs');
    expect(copy?.kind).toBe('fitSpline');
    if (copy?.kind !== 'fitSpline') return;
    expect(copy.fit).toEqual(['m:1.f0', 'm:1.f1']);
    expect(copy.params).toEqual([0, 1]);
    expect(copy.knots).toEqual([0, 0, 1, 1]);
    expect(copy.construction).toBe(true);
    expect(copy.poles[0]?.[0]).toBeCloseTo(-1, 9);
    expect(copy.poles[0]?.[1]).toBeCloseTo(1, 9);
    expect(copy.poles[1]?.[0]).toBeCloseTo(-4, 9);
    expect(copy.poles[1]?.[1]).toBeCloseTo(2, 9);
  });
});

describe('patternCopies – linear pattern', () => {
  it('copies along one direction with indices 1 … count − 1', () => {
    const data = sketch([
      ...BASE,
      {
        kind: 'linearPattern',
        id: 'lp',
        sources: ['ab'],
        direction1: { angle: Math.PI / 2, count: 3, spacing: 4 },
      },
    ]);
    const copies = patternCopies(data);
    expect(ids(copies)).toEqual(['lp:1.a', 'lp:1.b', 'lp:1.ab', 'lp:2.a', 'lp:2.b', 'lp:2.ab']);
    expectPoint(copies, 'lp:1.a', 1, 4);
    expectPoint(copies, 'lp:2.b', 3, 8);
  });

  it('copies a grid with two directions: indices i-j without 0-0, i major', () => {
    const data = sketch([
      ...BASE,
      {
        kind: 'linearPattern',
        id: 'lp',
        sources: ['a'],
        direction1: { angle: 0, count: 2, spacing: 10 },
        direction2: { angle: Math.PI / 2, count: 3, spacing: 5 },
      },
    ]);
    const copies = patternCopies(data);
    expect(ids(copies)).toEqual(['lp:0-1.a', 'lp:0-2.a', 'lp:1-0.a', 'lp:1-1.a', 'lp:1-2.a']);
    expectPoint(copies, 'lp:0-2.a', 1, 10);
    expectPoint(copies, 'lp:1-0.a', 11, 0);
    expectPoint(copies, 'lp:1-2.a', 11, 10);
  });

  it('keeps the ids when the spacing or the angle changes', () => {
    const pattern = (spacing: number, angle: number) =>
      sketch([
        ...BASE,
        {
          kind: 'linearPattern',
          id: 'lp',
          sources: ['ab'],
          direction1: { angle, count: 3, spacing },
        },
      ]);
    expect(ids(patternCopies(pattern(7, 1)))).toEqual(ids(patternCopies(pattern(4, 0))));
  });

  it('lowering the count removes only the highest indices', () => {
    const pattern = (count: number) =>
      sketch([
        ...BASE,
        {
          kind: 'linearPattern',
          id: 'lp',
          sources: ['ab'],
          direction1: { angle: 0, count, spacing: 5 },
        },
      ]);
    const four = ids(patternCopies(pattern(4)));
    const three = ids(patternCopies(pattern(3)));
    expect(four.filter((id) => !three.includes(id))).toEqual(['lp:3.a', 'lp:3.b', 'lp:3.ab']);
    expect(three.every((id) => four.includes(id))).toBe(true);
  });

  it('keeps points shared by two sources shared in the copy', () => {
    const data = sketch([
      ...BASE,
      P('c', 3, 2),
      { kind: 'line', id: 'bc', p1: 'b', p2: 'c' },
      {
        kind: 'linearPattern',
        id: 'lp',
        sources: ['ab', 'bc'],
        direction1: { angle: 0, count: 2, spacing: 5 },
      },
    ]);
    const copies = patternCopies(data);
    expect(ids(copies)).toEqual(['lp:1.a', 'lp:1.b', 'lp:1.ab', 'lp:1.c', 'lp:1.bc']);
    const ab = byId(copies).get('lp:1.ab');
    const bc = byId(copies).get('lp:1.bc');
    expect(ab?.kind === 'line' && ab.p2).toBe('lp:1.b');
    expect(bc?.kind === 'line' && bc.p1).toBe('lp:1.b');
  });

  it('copies inherit construction of their source', () => {
    const data = sketch([
      ...BASE,
      {
        kind: 'linearPattern',
        id: 'lp',
        sources: ['ou'],
        direction1: { angle: 0, count: 2, spacing: 5 },
      },
    ]);
    expect(byId(patternCopies(data)).get('lp:1.ou')).toEqual({
      kind: 'line',
      id: 'lp:1.ou',
      p1: 'lp:1.o',
      p2: 'lp:1.u',
      construction: true,
    });
  });
});

describe('patternCopies – circular pattern', () => {
  const circular = (count: number, angle: number) =>
    sketch([
      ...BASE,
      { kind: 'circularPattern', id: 'cp', sources: ['a'], center: 'o', count, angle },
    ]);

  it('divides a full circle into count steps', () => {
    const copies = patternCopies(circular(4, 2 * Math.PI));
    expect(ids(copies)).toEqual(['cp:1.a', 'cp:2.a', 'cp:3.a']);
    expectPoint(copies, 'cp:1.a', 0, 1);
    expectPoint(copies, 'cp:2.a', -1, 0);
    expectPoint(copies, 'cp:3.a', 0, -1);
  });

  it('spreads a smaller angle over count − 1 steps, the last instance at the angle', () => {
    const copies = patternCopies(circular(3, Math.PI / 2));
    expect(ids(copies)).toEqual(['cp:1.a', 'cp:2.a']);
    expectPoint(copies, 'cp:1.a', Math.SQRT1_2, Math.SQRT1_2);
    expectPoint(copies, 'cp:2.a', 0, 1);
  });

  it('turns clockwise for a negative angle', () => {
    const copies = patternCopies(circular(2, -Math.PI / 2));
    expectPoint(copies, 'cp:1.a', 0, -1);
    const full = patternCopies(circular(4, -2 * Math.PI));
    expectPoint(full, 'cp:1.a', 0, -1);
  });

  it('rotates an arc without swapping its ends', () => {
    const data = sketch([
      ...BASE,
      P('c', 2, 0),
      P('s', 3, 0),
      P('e', 2, 1),
      { kind: 'arc', id: 'q', center: 'c', start: 's', end: 'e' },
      { kind: 'circularPattern', id: 'cp', sources: ['q'], center: 'o', count: 2, angle: Math.PI },
    ]);
    const copies = patternCopies(data);
    expect(byId(copies).get('cp:1.q')).toEqual({
      kind: 'arc',
      id: 'cp:1.q',
      center: 'cp:1.c',
      start: 'cp:1.s',
      end: 'cp:1.e',
    });
    expectPoint(copies, 'cp:1.s', -3, 0);
  });
});

describe('patternCopies – order and sharing', () => {
  it('copies patterns in entity order and a point only once per instance', () => {
    const data = sketch([
      ...BASE,
      { kind: 'mirror', id: 'm', sources: ['ab', 'a'], axis: 'ou' },
      {
        kind: 'linearPattern',
        id: 'lp',
        sources: ['b'],
        direction1: { angle: 0, count: 2, spacing: 1 },
      },
    ]);
    expect(ids(patternCopies(data))).toEqual(['m:1.a', 'm:1.b', 'm:1.ab', 'lp:1.b']);
  });

  it('returns nothing without patterns and frozen copies', () => {
    expect(patternCopies(sketch(BASE))).toEqual([]);
    const copies = patternCopies(
      sketch([...BASE, { kind: 'mirror', id: 'm', sources: ['ab'], axis: 'ou' }]),
    );
    expect(Object.isFrozen(copies)).toBe(true);
    expect(copies.every((c) => Object.isFrozen(c))).toBe(true);
  });
});

describe('patternOfCopy', () => {
  it('returns the pattern of a derived id', () => {
    expect(patternOfCopy('m:1.ab')).toBe('m');
    expect(patternOfCopy('lp:1-0.a')).toBe('lp');
    expect(patternOfCopy('cp:12.xYz')).toBe('cp');
  });

  it('returns null for other ids', () => {
    expect(patternOfCopy('ab')).toBeNull();
    expect(patternOfCopy(':1.a')).toBeNull();
    expect(patternOfCopy('m:1.')).toBeNull();
    expect(patternOfCopy('m:x.a')).toBeNull();
    expect(patternOfCopy('__poles:sp')).toBeNull();
  });
});

describe('patternCopies – mirror across an xline (after M31)', () => {
  it('mirrors across the infinite line like across a line', () => {
    const data = sketch([
      ...BASE,
      { kind: 'xline', id: 'x', p1: 'o', p2: 'u', construction: true },
      { kind: 'mirror', id: 'm', sources: ['ab'], axis: 'x' },
    ]);
    const copies = patternCopies(data);
    expect(ids(copies)).toEqual(['m:1.a', 'm:1.b', 'm:1.ab']);
    expectPoint(copies, 'm:1.a', -1, 0);
    expectPoint(copies, 'm:1.b', -3, 0);
  });
});
