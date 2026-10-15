import { describe, expect, it } from 'vitest';
import type { Vec2 } from '@/core';
import type { SketchData, SketchEntityId } from '@/sketch/model';
import { parseSketchData } from '@/sketch/parse';
import { ORIGIN_SNAP, snap } from '@/sketch/snap';
import type { SnapOptions, SnapResult } from '@/sketch/snap';

function sketch(entities: readonly unknown[]): SketchData {
  const r = parseSketchData(entities, []);
  if (!r.ok) throw new Error(`invalid test sketch: ${JSON.stringify(r.error)}`);
  return r.value;
}

/** Test ids; the data was parsed, so only ids that exist in it are used. */
const id = (s: string): SketchEntityId => s as SketchEntityId; // test-only branding of literals

/**
 * Line ab (10,10)–(30,10), midpoint (20,10); circle k (r 5) around o (50,50); arc q (r 5) around
 * p (80,10) from s (85,10) to t (80,15), counter-clockwise (0°–90°); a lone point z (60,30).
 */
const DATA = sketch([
  { kind: 'point', id: 'a', x: 10, y: 10 },
  { kind: 'point', id: 'b', x: 30, y: 10 },
  { kind: 'line', id: 'ab', p1: 'a', p2: 'b' },
  { kind: 'point', id: 'o', x: 50, y: 50 },
  { kind: 'circle', id: 'k', center: 'o', radius: 5 },
  { kind: 'point', id: 'p', x: 80, y: 10 },
  { kind: 'point', id: 's', x: 85, y: 10 },
  { kind: 'point', id: 't', x: 80, y: 15 },
  { kind: 'arc', id: 'q', center: 'p', start: 's', end: 't' },
  { kind: 'point', id: 'z', x: 60, y: 30 },
]);

const OPTS: SnapOptions = { tolerance: 1, grid: null, infer: true };

const R45 = Math.SQRT1_2;

function expectAt(r: SnapResult, at: Vec2): void {
  expect(r.at[0]).toBeCloseTo(at[0], 9);
  expect(r.at[1]).toBeCloseTo(at[1], 9);
}

describe('ORIGIN_SNAP', () => {
  it('is the frozen origin [0, 0]', () => {
    expect(ORIGIN_SNAP).toEqual([0, 0]);
    expect(Object.isFrozen(ORIGIN_SNAP)).toBe(true);
  });
});

describe('snap: the order of steps', () => {
  const cases: readonly {
    readonly name: string;
    readonly cursor: Vec2;
    readonly opts?: Partial<SnapOptions>;
    readonly expected: Omit<SnapResult, 'at'> & { readonly at: Vec2 };
  }[] = [
    {
      name: '1. point: the nearest existing point, no inference',
      cursor: [10.5, 10.3],
      expected: { at: [10, 10], kind: 'point', point: id('a'), inferred: [], guides: [] },
    },
    {
      name: '1. point: an end beats the curve it lies on',
      cursor: [30.4, 10.1],
      expected: { at: [30, 10], kind: 'point', point: id('b'), inferred: [], guides: [] },
    },
    {
      name: '1. point: the center of a circle is a point',
      cursor: [50.2, 50.3],
      expected: { at: [50, 50], kind: 'point', point: id('o'), inferred: [], guides: [] },
    },
    {
      name: '1. point: a lone point',
      cursor: [59.5, 30.5],
      expected: { at: [60, 30], kind: 'point', point: id('z'), inferred: [], guides: [] },
    },
    {
      name: '2. origin: [0, 0] with fix',
      cursor: [0.3, -0.2],
      expected: {
        at: [0, 0],
        kind: 'origin',
        point: null,
        inferred: [{ kind: 'fix' }],
        guides: [],
      },
    },
    {
      name: '3. midpoint of a line',
      cursor: [20.3, 10.4],
      expected: {
        at: [20, 10],
        kind: 'midpoint',
        point: null,
        inferred: [{ kind: 'midpoint', line: id('ab') }],
        guides: [],
      },
    },
    {
      name: '4. onCurve: the projection on a line',
      cursor: [15, 10.5],
      expected: {
        at: [15, 10],
        kind: 'onCurve',
        point: null,
        inferred: [{ kind: 'pointOnCurve', curve: id('ab') }],
        guides: [],
      },
    },
    {
      name: '4. onCurve: the projection on a circle beats an alignment with its center',
      cursor: [50, 55.6],
      expected: {
        at: [50, 55],
        kind: 'onCurve',
        point: null,
        inferred: [{ kind: 'pointOnCurve', curve: id('k') }],
        guides: [],
      },
    },
    {
      name: '4. onCurve: the projection on an arc within its range',
      cursor: [80 + 5.5 * R45, 10 + 5.5 * R45],
      expected: {
        at: [80 + 5 * R45, 10 + 5 * R45],
        kind: 'onCurve',
        point: null,
        inferred: [{ kind: 'pointOnCurve', curve: id('q') }],
        guides: [],
      },
    },
    {
      name: '5. alignBoth: the vertical of one point and the horizontal of another',
      cursor: [10.4, 29.5],
      expected: {
        at: [10, 30],
        kind: 'alignBoth',
        point: null,
        inferred: [
          { kind: 'vAlign', with: id('a') },
          { kind: 'hAlign', with: id('z') },
        ],
        guides: [
          { axis: 'v', from: [10, 10], to: [10, 30] },
          { axis: 'h', from: [60, 30], to: [10, 30] },
        ],
      },
    },
    {
      name: '6. align: the vertical of a point, the other coordinate is the cursor',
      cursor: [10.4, 40.3],
      expected: {
        at: [10, 40.3],
        kind: 'align',
        point: null,
        inferred: [{ kind: 'vAlign', with: id('a') }],
        guides: [{ axis: 'v', from: [10, 10], to: [10, 40.3] }],
      },
    },
    {
      name: '6. align: the horizontal of a point',
      cursor: [40.2, 30.3],
      expected: {
        at: [40.2, 30],
        kind: 'align',
        point: null,
        inferred: [{ kind: 'hAlign', with: id('z') }],
        guides: [{ axis: 'h', from: [60, 30], to: [40.2, 30] }],
      },
    },
    {
      name: '6. align with the grid: the other coordinate snaps to the grid',
      cursor: [10.4, 41.3],
      opts: { grid: 5 },
      expected: {
        at: [10, 40],
        kind: 'align',
        point: null,
        inferred: [{ kind: 'vAlign', with: id('a') }],
        guides: [{ axis: 'v', from: [10, 10], to: [10, 40] }],
      },
    },
    {
      name: '7. grid: rounded to the grid',
      cursor: [42.4, 37.6],
      opts: { grid: 5 },
      expected: { at: [40, 40], kind: 'grid', point: null, inferred: [], guides: [] },
    },
    {
      name: '8. free: the cursor',
      cursor: [42.4, 37.6],
      expected: { at: [42.4, 37.6], kind: 'free', point: null, inferred: [], guides: [] },
    },
    {
      name: '8. free: an arc outside its range does not snap',
      cursor: [80 - 5.3 * R45, 10 - 5.3 * R45],
      expected: {
        at: [80 - 5.3 * R45, 10 - 5.3 * R45],
        kind: 'free',
        point: null,
        inferred: [],
        guides: [],
      },
    },
  ];

  it.each(cases)('$name', ({ cursor, opts, expected }) => {
    const r = snap(cursor, DATA, { ...OPTS, ...opts });
    const { at, ...rest } = expected;
    expect({ ...r, at: undefined }).toEqual({ ...rest, at: undefined });
    expectAt(r, at);
  });
});

describe('snap: details', () => {
  it('a point beats the origin', () => {
    const data = sketch([{ kind: 'point', id: 'n', x: 0.6, y: 0 }]);
    const r = snap([0.4, 0], data, OPTS);
    expect(r).toMatchObject({ kind: 'point', point: 'n' });
  });

  it('a point lying at the origin is snapped as a point, not as the origin', () => {
    const data = sketch([{ kind: 'point', id: 'n', x: 0, y: 0 }]);
    const r = snap([0.2, 0.1], data, OPTS);
    expect(r).toEqual({ at: [0, 0], kind: 'point', point: 'n', inferred: [], guides: [] });
  });

  it('the grid turns −0 into 0', () => {
    const r = snap([-3, 44], DATA, { ...OPTS, grid: 10 });
    expect(r.kind).toBe('grid');
    expect(Object.is(r.at[0], 0)).toBe(true);
    expect(r.at[1]).toBe(40);
  });

  it('alignBoth with one point near in both directions falls back to the nearer alignment', () => {
    // [10.6, 10.5] is 0.78 from a: not step 1 with tolerance 0.7, but within 0.7 of both its axes.
    const data = sketch([{ kind: 'point', id: 'n', x: 10, y: 10 }]);
    const r = snap([10.6, 10.5], data, { ...OPTS, tolerance: 0.7 });
    expect(r.kind).toBe('align');
    expect(r.inferred).toEqual([{ kind: 'hAlign', with: 'n' }]);
    expectAt(r, [10.6, 10]);
  });

  it('only points are alignment candidates, not midpoints of lines', () => {
    const r = snap([20.3, 45], DATA, OPTS);
    expect(r.kind).toBe('free');
  });
});

describe('snap: a tie of distances is won by the earlier entity in the data', () => {
  const points = [
    { kind: 'point', id: 'u', x: 100, y: 100 },
    { kind: 'point', id: 'v', x: 101, y: 100 },
  ];
  const lines = [
    { kind: 'point', id: 'l1', x: 0, y: 100 },
    { kind: 'point', id: 'l2', x: 50, y: 100 },
    { kind: 'point', id: 'm1', x: 0, y: 102 },
    { kind: 'point', id: 'm2', x: 50, y: 102 },
    { kind: 'line', id: 'l', p1: 'l1', p2: 'l2' },
    { kind: 'line', id: 'm', p1: 'm1', p2: 'm2' },
  ];
  const reversedLines = [...lines.slice(0, 4), ...lines.slice(4).reverse()];

  it.each([
    { name: 'points', entities: points, cursor: [100.5, 100] as Vec2, expected: 'u' },
    {
      name: 'points reversed',
      entities: [...points].reverse(),
      cursor: [100.5, 100] as Vec2,
      expected: 'v',
    },
  ])('$name', ({ entities, cursor, expected }) => {
    expect(snap(cursor, sketch(entities), OPTS).point).toBe(expected);
  });

  it.each([
    { name: 'curves', entities: lines, expected: 'l' },
    { name: 'curves reversed', entities: reversedLines, expected: 'm' },
  ])('$name', ({ entities, expected }) => {
    const r = snap([20, 101], sketch(entities), { ...OPTS, tolerance: 1.5 });
    expect(r.inferred).toEqual([{ kind: 'pointOnCurve', curve: expected }]);
  });

  it('alignment', () => {
    const data = sketch([
      { kind: 'point', id: 'u', x: 10, y: 0 },
      { kind: 'point', id: 'v', x: 10, y: 20 },
    ]);
    expect(snap([10.5, 50], data, OPTS).inferred).toEqual([{ kind: 'vAlign', with: 'u' }]);
  });
});

describe('snap: exclude', () => {
  it('an excluded point is neither snapped nor aligned to', () => {
    const r = snap([60.3, 30.2], DATA, { ...OPTS, exclude: new Set([id('z')]) });
    expect(r.kind).toBe('free');
  });

  it('an excluded line has neither a midpoint nor a projection', () => {
    const r = snap([20.3, 10.4], DATA, { ...OPTS, exclude: new Set([id('ab')]) });
    expect(r.kind).toBe('align');
    expect(r.inferred).toEqual([{ kind: 'hAlign', with: 'a' }]);
  });
});

describe('snap: infer false (Ctrl/Cmd)', () => {
  const off: SnapOptions = { ...OPTS, infer: false };

  it.each([
    { name: 'a point still snaps', cursor: [10.5, 10.3] as Vec2, kind: 'point' },
    { name: 'the origin still snaps', cursor: [0.3, -0.2] as Vec2, kind: 'origin' },
    { name: 'no midpoint', cursor: [20.3, 10.4] as Vec2, kind: 'free' },
    { name: 'no curve', cursor: [15, 10.5] as Vec2, kind: 'free' },
    { name: 'no alignment', cursor: [10.4, 40.3] as Vec2, kind: 'free' },
  ])('$name', ({ cursor, kind }) => {
    expect(snap(cursor, DATA, off).kind).toBe(kind);
  });

  it('the grid still applies', () => {
    const r = snap([20.3, 10.4], DATA, { ...off, grid: 5 });
    expect(r).toEqual({ at: [20, 10], kind: 'grid', point: null, inferred: [], guides: [] });
  });
});
