import { describe, expect, it } from 'vitest';
import type { Vec2 } from '@/core';
import { inferLine, inferRadius } from '@/sketch/infer';
import type { LineInference } from '@/sketch/infer';
import type { SketchData, SketchEntityId } from '@/sketch/model';
import { parseSketchData } from '@/sketch/parse';

function sketch(entities: readonly unknown[]): SketchData {
  const r = parseSketchData(entities, []);
  if (!r.ok) throw new Error(`invalid test sketch: ${JSON.stringify(r.error)}`);
  return r.value;
}

const id = (s: string): SketchEntityId => s as SketchEntityId; // test-only branding of literals

const DEG = Math.PI / 180;
const TOL = 3 * DEG;
const polar = (origin: Vec2, length: number, angleDeg: number): Vec2 => [
  origin[0] + length * Math.cos(angleDeg * DEG),
  origin[1] + length * Math.sin(angleDeg * DEG),
];

/** A point of the data as the `from` of inferLine. */
function from(data: SketchData, pointId: string): { at: Vec2; point: SketchEntityId } {
  const p = data.entities.find((e) => e.id === pointId);
  if (p?.kind !== 'point') throw new Error(`no point ${pointId}`);
  return { at: [p.x, p.y], point: p.id };
}

const NEW = (at: Vec2) => ({ at, point: null });

/** Line ab from a (0,0) to b at 30° (length 10), line bc from b at 120° (perpendicular to ab). */
const B: Vec2 = polar([0, 0], 10, 30);
const SLANTED = sketch([
  { kind: 'point', id: 'a', x: 0, y: 0 },
  { kind: 'point', id: 'b', x: B[0], y: B[1] },
  { kind: 'point', id: 'c', ...xy(polar(B, 10, 120)) },
  { kind: 'line', id: 'ab', p1: 'a', p2: 'b' },
  { kind: 'line', id: 'bc', p1: 'b', p2: 'c' },
  // Not connected to b, parallel to ab.
  { kind: 'point', id: 'd', x: 50, y: 0 },
  { kind: 'point', id: 'e', ...xy(polar([50, 0], 10, 30)) },
  { kind: 'line', id: 'de', p1: 'd', p2: 'e' },
]);

/** Horizontal line ab from (0,0) to (10,0). */
const FLAT = sketch([
  { kind: 'point', id: 'a', x: 0, y: 0 },
  { kind: 'point', id: 'b', x: 10, y: 0 },
  { kind: 'line', id: 'ab', p1: 'a', p2: 'b' },
]);

/** Arc q (r 5) around o (0,0) from s (5,0) to t at 45°; circle k (r 5) around o. */
const T: Vec2 = polar([0, 0], 5, 45);
const ROUND = sketch([
  { kind: 'point', id: 'o', x: 0, y: 0 },
  { kind: 'point', id: 's', x: 5, y: 0 },
  { kind: 'point', id: 't', ...xy(T) },
  { kind: 'arc', id: 'q', center: 'o', start: 's', end: 't' },
  { kind: 'circle', id: 'k', center: 'o', radius: 5 },
]);

function xy(p: Vec2): { x: number; y: number } {
  return { x: p[0], y: p[1] };
}

describe('inferLine', () => {
  const cases: readonly {
    readonly name: string;
    readonly data: SketchData;
    readonly from: { readonly at: Vec2; readonly point: SketchEntityId | null };
    readonly to: Vec2;
    readonly previous?: string;
    readonly expected: readonly LineInference[];
  }[] = [
    {
      name: 'axis: horizontal within 3°',
      data: FLAT,
      from: NEW([0, 20]),
      to: polar([0, 20], 10, 2.9),
      expected: [{ kind: 'horizontal' }],
    },
    {
      name: 'axis: vertical within 3° (downwards)',
      data: FLAT,
      from: NEW([0, 20]),
      to: polar([0, 20], 10, -87.5),
      expected: [{ kind: 'vertical' }],
    },
    {
      name: 'axis: nothing beyond 3°',
      data: FLAT,
      from: NEW([0, 20]),
      to: polar([0, 20], 10, 3.1),
      expected: [],
    },
    {
      name: 'zero length: nothing',
      data: FLAT,
      from: NEW([0, 20]),
      to: [0, 20],
      expected: [],
    },
    {
      name: 'parallel to a connected line',
      data: SLANTED,
      from: from(SLANTED, 'b'),
      to: polar(B, 7, 32),
      expected: [
        { kind: 'parallel', line: id('ab') },
        { kind: 'perpendicular', line: id('bc') },
      ],
    },
    {
      name: 'parallel in the opposite direction',
      data: SLANTED,
      from: from(SLANTED, 'b'),
      to: polar(B, 7, 211),
      expected: [
        { kind: 'parallel', line: id('ab') },
        { kind: 'perpendicular', line: id('bc') },
      ],
    },
    {
      name: 'perpendicular to a connected line',
      data: SLANTED,
      from: from(SLANTED, 'a'),
      to: polar([0, 0], 7, 121),
      expected: [{ kind: 'perpendicular', line: id('ab') }],
    },
    {
      name: 'a connected line at 45°: nothing',
      data: FLAT,
      from: from(FLAT, 'b'),
      to: polar([10, 0], 7, 45),
      expected: [],
    },
    {
      name: 'nothing beyond 3° from parallel or perpendicular',
      data: SLANTED,
      from: from(SLANTED, 'b'),
      to: polar(B, 7, 26.5),
      expected: [],
    },
    {
      name: 'only connected curves: a new point gets no parallel',
      data: SLANTED,
      from: NEW([100, 100]),
      to: polar([100, 100], 7, 30),
      expected: [],
    },
    {
      name: 'the axis wins over parallel and perpendicular',
      data: FLAT,
      from: from(FLAT, 'b'),
      to: [20, 0.2],
      expected: [{ kind: 'horizontal' }],
    },
    {
      name: 'the axis wins over perpendicular',
      data: FLAT,
      from: from(FLAT, 'b'),
      to: [10.2, 10],
      expected: [{ kind: 'vertical' }],
    },
    {
      name: 'tangent to an arc at its end',
      data: ROUND,
      from: from(ROUND, 't'),
      to: polar(T, 8, 135 + 2),
      expected: [{ kind: 'tangent', curve: id('q') }],
    },
    {
      name: 'tangent to an arc at its start, together with the axis',
      data: ROUND,
      from: from(ROUND, 's'),
      to: [5, -8],
      expected: [{ kind: 'vertical' }, { kind: 'tangent', curve: id('q') }],
    },
    {
      name: 'no tangent beyond 3°',
      data: ROUND,
      from: from(ROUND, 't'),
      to: polar(T, 8, 135 + 4),
      expected: [],
    },
    {
      name: 'no tangent from the center (the circle and the arc only use it as their center)',
      data: ROUND,
      from: from(ROUND, 'o'),
      to: polar([0, 0], 8, 60),
      expected: [],
    },
    {
      name: 'equal with the previous line, 2 % of the longer one (longer new line)',
      data: FLAT,
      from: from(FLAT, 'b'),
      to: polar([10, 0], 10.2, 60),
      previous: 'ab',
      expected: [{ kind: 'equal', line: id('ab') }],
    },
    {
      name: 'equal with the previous line, 2 % of the longer one (shorter new line)',
      data: FLAT,
      from: from(FLAT, 'b'),
      to: polar([10, 0], 9.81, 60),
      previous: 'ab',
      expected: [{ kind: 'equal', line: id('ab') }],
    },
    {
      name: 'no equal beyond 2 % (longer new line)',
      data: FLAT,
      from: from(FLAT, 'b'),
      to: polar([10, 0], 10.25, 60),
      previous: 'ab',
      expected: [],
    },
    {
      name: 'no equal beyond 2 % (shorter new line)',
      data: FLAT,
      from: from(FLAT, 'b'),
      to: polar([10, 0], 9.79, 60),
      previous: 'ab',
      expected: [],
    },
    {
      name: 'no equal without previous',
      data: FLAT,
      from: from(FLAT, 'b'),
      to: polar([10, 0], 10, 60),
      expected: [],
    },
    {
      name: 'no equal when previous is not a line',
      data: ROUND,
      from: NEW([20, 20]),
      to: polar([20, 20], 5, 60),
      previous: 'q',
      expected: [],
    },
    {
      name: 'at most one constraint per pair: perpendicular to previous, so no equal',
      data: SLANTED,
      from: from(SLANTED, 'b'),
      to: polar(B, 10, 120),
      previous: 'ab',
      expected: [
        { kind: 'perpendicular', line: id('ab') },
        { kind: 'parallel', line: id('bc') },
      ],
    },
    {
      name: 'order: axis, then connected curves in data order, then equal',
      data: FLAT,
      from: from(FLAT, 'b'),
      to: [10, 10],
      previous: 'ab',
      expected: [{ kind: 'vertical' }, { kind: 'equal', line: id('ab') }],
    },
  ];

  it.each(cases)('$name', ({ data, from: f, to, previous, expected }) => {
    const prev = previous === undefined ? null : id(previous);
    expect(inferLine(f, to, data, { previous: prev, angleTolerance: TOL })).toEqual(expected);
  });
});

describe('inferRadius', () => {
  const DATA = sketch([
    { kind: 'point', id: 'o', x: 0, y: 0 },
    { kind: 'circle', id: 'k', center: 'o', radius: 10 },
    { kind: 'point', id: 's', x: 20, y: 0 },
    { kind: 'point', id: 't', x: 0, y: 20 },
    { kind: 'arc', id: 'q', center: 'o', start: 's', end: 't' },
    { kind: 'line', id: 'st', p1: 's', p2: 't' },
  ]);

  it.each([
    { name: 'circle, larger within 2 %', radius: 10.2, previous: 'k', expected: 'k' },
    { name: 'circle, smaller within 2 %', radius: 9.8, previous: 'k', expected: 'k' },
    { name: 'circle, beyond 2 %', radius: 10.25, previous: 'k', expected: null },
    { name: 'arc: radius from its start', radius: 20.3, previous: 'q', expected: 'q' },
    { name: 'arc, beyond 2 %', radius: 21, previous: 'q', expected: null },
    { name: 'a line is not round', radius: 10, previous: 'st', expected: null },
    { name: 'no previous', radius: 10, previous: null, expected: null },
  ])('$name', ({ radius, previous, expected }) => {
    expect(inferRadius(radius, DATA, previous === null ? null : id(previous))).toBe(expected);
  });
});

describe('inferLine with an xline (M31)', () => {
  /** The xline x through a (0,0) and b at 30°. */
  const XLINE = sketch([
    { kind: 'point', id: 'a', x: 0, y: 0 },
    { kind: 'point', id: 'b', x: B[0], y: B[1] },
    { kind: 'xline', id: 'x', p1: 'a', p2: 'b', construction: true },
  ]);
  const opts = { previous: null, angleTolerance: TOL };

  it('a line from a point of the xline gets parallel or perpendicular to its carrier line', () => {
    expect(inferLine(from(XLINE, 'b'), polar(B, 7, 31), XLINE, opts)).toEqual([
      { kind: 'parallel', line: id('x') },
    ]);
    expect(inferLine(from(XLINE, 'a'), polar([0, 0], 7, 121), XLINE, opts)).toEqual([
      { kind: 'perpendicular', line: id('x') },
    ]);
  });

  it('an xline as `previous` gives no equal (it has no length)', () => {
    expect(
      inferLine(NEW([100, 0]), polar([100, 0], 10, 30 + 45), XLINE, { ...opts, previous: id('x') }),
    ).toEqual([]);
  });
});
