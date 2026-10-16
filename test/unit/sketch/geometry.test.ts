import { describe, expect, it } from 'vitest';
import { XLINE_EXTENT, curve2, regionCurves } from '@/sketch/geometry';
import { isPattern } from '@/sketch/model';
import { patternCopies } from '@/sketch/patterns';
import { pointsById } from '@/sketch/points';
import type { SketchCurve, SketchData } from '@/sketch/model';
import { parseSketchData } from '@/sketch/parse';

function sketch(entities: readonly unknown[]): SketchData {
  const r = parseSketchData(entities, []);
  if (!r.ok) throw new Error(`invalid test sketch: ${JSON.stringify(r.error)}`);
  return r.value;
}

function curve(data: SketchData, id: string): SketchCurve {
  const c = data.entities.find((e) => e.id === id);
  if (c === undefined || c.kind === 'point' || isPattern(c)) throw new Error(`no curve ${id}`);
  return c;
}

const DATA = sketch([
  { kind: 'point', id: 'o', x: 1, y: 2 },
  { kind: 'point', id: 's', x: 4, y: 2 },
  { kind: 'point', id: 'e', x: 1, y: 5 },
  { kind: 'line', id: 'l', p1: 's', p2: 'e' },
  { kind: 'circle', id: 'k', center: 'o', radius: 7 },
  { kind: 'arc', id: 'q', center: 'o', start: 's', end: 'e', construction: true },
]);

describe('curve2', () => {
  const points = pointsById(DATA);

  it('turns a line into from/to coordinates with the entity id', () => {
    expect(curve2(curve(DATA, 'l'), points)).toEqual({
      kind: 'line',
      from: [4, 2],
      to: [1, 5],
      id: 'l',
    });
  });

  it('turns a circle into center and radius with the entity id', () => {
    expect(curve2(curve(DATA, 'k'), points)).toEqual({
      kind: 'circle',
      center: [1, 2],
      radius: 7,
      id: 'k',
    });
  });

  it('turns an arc into a counter-clockwise arc with the entity id', () => {
    expect(curve2(curve(DATA, 'q'), points)).toEqual({
      kind: 'arc',
      center: [1, 2],
      from: [4, 2],
      to: [1, 5],
      ccw: true,
      id: 'q',
    });
  });

  it('throws when a point is missing (a programming error)', () => {
    expect(() => curve2(curve(DATA, 'l'), new Map())).toThrow();
  });
});

describe('curve2 – splines', () => {
  const data = sketch([
    { kind: 'point', id: 'a', x: 0, y: 0 },
    { kind: 'point', id: 'b', x: 1, y: 2 },
    { kind: 'point', id: 'c', x: 3, y: 2 },
    {
      kind: 'bspline',
      id: 's',
      degree: 2,
      poles: ['a', 'b', 'c'],
      knots: [0, 0, 0, 1, 1, 1],
    },
    {
      kind: 'fitSpline',
      id: 'f',
      degree: 2,
      fit: ['c', 'b', 'a'],
      params: [0, 0.5, 1],
      poles: [
        [3, 2],
        [1, 3],
        [0, 0],
      ],
      knots: [0, 0, 0, 1, 1, 1],
      construction: true,
    },
  ]);
  const points = pointsById(data);

  it('turns a control point spline into a bspline with the point coordinates as poles', () => {
    expect(curve2(curve(data, 's'), points)).toEqual({
      kind: 'bspline',
      degree: 2,
      poles: [
        [0, 0],
        [1, 2],
        [3, 2],
      ],
      knots: [0, 0, 0, 1, 1, 1],
      id: 's',
    });
  });

  it('turns a fit point spline into a bspline with its stored poles', () => {
    expect(curve2(curve(data, 'f'), points)).toEqual({
      kind: 'bspline',
      degree: 2,
      poles: [
        [3, 2],
        [1, 3],
        [0, 0],
      ],
      knots: [0, 0, 0, 1, 1, 1],
      id: 'f',
    });
  });

  it('throws when a pole point is missing (a programming error)', () => {
    expect(() => curve2(curve(data, 's'), new Map())).toThrow();
  });
});

describe('curve2 – infinite line (xline, M31)', () => {
  it('turns an xline into a line XLINE_EXTENT long each way from the middle of p1p2', () => {
    const data = sketch([
      { kind: 'point', id: 'p', x: 1, y: 1 },
      { kind: 'point', id: 'q', x: 4, y: 5 },
      { kind: 'xline', id: 'x', p1: 'p', p2: 'q', construction: true },
    ]);
    const c = curve2(curve(data, 'x'), pointsById(data));
    // m = (2.5, 3), d̂ = (0.6, 0.8).
    expect(c).toEqual({
      kind: 'line',
      from: [
        expect.closeTo(2.5 - 0.6 * XLINE_EXTENT, 6),
        expect.closeTo(3 - 0.8 * XLINE_EXTENT, 6),
      ],
      to: [expect.closeTo(2.5 + 0.6 * XLINE_EXTENT, 6), expect.closeTo(3 + 0.8 * XLINE_EXTENT, 6)],
      id: 'x',
    });
    expect(XLINE_EXTENT).toBe(1e5);
  });
});

describe('regionCurves', () => {
  const data = sketch([
    { kind: 'point', id: 'a', x: 0, y: 0 },
    { kind: 'point', id: 'b', x: 4, y: 0 },
    { kind: 'point', id: 'c', x: 4, y: 3 },
    { kind: 'point', id: 'd', x: 0, y: 4 },
    { kind: 'line', id: 'ab', p1: 'a', p2: 'b' },
    { kind: 'line', id: 'bc', p1: 'b', p2: 'c', construction: true },
    { kind: 'arc', id: 'q', center: 'a', start: 'b', end: 'd' },
    { kind: 'circle', id: 'k', center: 'c', radius: 1 },
    { kind: 'circle', id: 'kc', center: 'a', radius: 9, construction: true },
    { kind: 'bspline', id: 's', degree: 2, poles: ['a', 'b', 'c'], knots: [0, 0, 0, 1, 1, 1] },
    {
      kind: 'fitSpline',
      id: 'f',
      degree: 2,
      fit: ['c', 'b', 'a'],
      params: [0, 0.5, 1],
      poles: [
        [4, 3],
        [5, 1],
        [0, 0],
      ],
      knots: [0, 0, 0, 1, 1, 1],
    },
    {
      kind: 'fitSpline',
      id: 'fc',
      degree: 2,
      fit: ['a', 'b', 'c'],
      params: [0, 0.5, 1],
      poles: [
        [0, 0],
        [5, 1],
        [4, 3],
      ],
      knots: [0, 0, 0, 1, 1, 1],
      construction: true,
    },
  ]);

  it('gives the non-construction curves in the order of the entities, without points', () => {
    expect(regionCurves(data).map((c) => c.id)).toEqual(['ab', 'q', 'k', 's', 'f']);
  });

  it('gives every curve the id of its entity', () => {
    const curves = regionCurves(data);
    expect(curves.every((c) => c.id !== undefined)).toBe(true);
  });

  it('turns each curve like curve2: a control point spline into a bspline', () => {
    const points = pointsById(data);
    expect(regionCurves(data)).toEqual(
      ['ab', 'q', 'k', 's', 'f'].map((id) => curve2(curve(data, id), points)),
    );
    expect(regionCurves(data)[3]).toEqual({
      kind: 'bspline',
      degree: 2,
      poles: [
        [0, 0],
        [4, 0],
        [4, 3],
      ],
      knots: [0, 0, 0, 1, 1, 1],
      id: 's',
    });
  });

  it('turns a fit point spline into a bspline with its stored poles', () => {
    expect(regionCurves(data)[4]).toEqual({
      kind: 'bspline',
      degree: 2,
      poles: [
        [4, 3],
        [5, 1],
        [0, 0],
      ],
      knots: [0, 0, 0, 1, 1, 1],
      id: 'f',
    });
  });

  it('gives nothing for a sketch with only points or construction curves', () => {
    expect(
      regionCurves(
        sketch([
          { kind: 'point', id: 'a', x: 0, y: 0 },
          { kind: 'point', id: 'b', x: 1, y: 0 },
          { kind: 'line', id: 'l', p1: 'a', p2: 'b', construction: true },
        ]),
      ),
    ).toEqual([]);
  });

  it('returns a frozen array', () => {
    expect(Object.isFrozen(regionCurves(data))).toBe(true);
  });
});

describe('regionCurves – infinite line (xline, M31)', () => {
  it('leaves an xline out', () => {
    const data = sketch([
      { kind: 'point', id: 'a', x: 0, y: 0 },
      { kind: 'point', id: 'b', x: 4, y: 0 },
      { kind: 'line', id: 'ab', p1: 'a', p2: 'b' },
      { kind: 'xline', id: 'x', p1: 'a', p2: 'b', construction: true },
    ]);
    expect(regionCurves(data).map((c) => c.id)).toEqual(['ab']);
  });
});

describe('regionCurves – copies of mirrors and patterns (M36)', () => {
  const BASE = [
    { kind: 'point', id: 'o', x: 0, y: 0 },
    { kind: 'point', id: 'u', x: 0, y: 1 },
    { kind: 'point', id: 'c', x: 3, y: 0 },
    { kind: 'point', id: 'e', x: 4, y: 0 },
    { kind: 'point', id: 'f', x: 4, y: 2 },
    // The axis of the mirror: construction, so it bounds nothing itself.
    { kind: 'line', id: 'ou', p1: 'o', p2: 'u', construction: true },
    { kind: 'circle', id: 'k', center: 'c', radius: 0.5 },
    { kind: 'line', id: 'ef', p1: 'e', p2: 'f' },
    { kind: 'line', id: 'cf', p1: 'c', p2: 'f', construction: true },
  ] as const;

  it('appends the copies of a mirror after the curves of the data, with derived ids', () => {
    const data = sketch([...BASE, { kind: 'mirror', id: 'm', sources: ['k', 'ef'], axis: 'ou' }]);
    expect(regionCurves(data).map((c) => c.id)).toEqual(['k', 'ef', 'm:1.k', 'm:1.ef']);
    expect(regionCurves(data)[2]).toEqual({
      kind: 'circle',
      center: [-3, 0],
      radius: 0.5,
      id: 'm:1.k',
    });
    expect(regionCurves(data)[3]).toEqual({
      kind: 'line',
      from: [-4, 0],
      to: [-4, 2],
      id: 'm:1.ef',
    });
  });

  it('appends the copies of a linear pattern in one and two directions', () => {
    const one = sketch([
      ...BASE,
      {
        kind: 'linearPattern',
        id: 'lp',
        sources: ['k'],
        direction1: { angle: Math.PI / 2, count: 3, spacing: 2 },
      },
    ]);
    expect(regionCurves(one).map((c) => c.id)).toEqual(['k', 'ef', 'lp:1.k', 'lp:2.k']);
    const lp2 = regionCurves(one)[3];
    if (lp2?.kind !== 'circle') expect.fail('No circle copy lp:2.k');
    expect(lp2.center[0]).toBeCloseTo(3, 12);
    expect(lp2.center[1]).toBeCloseTo(4, 12);

    const grid = sketch([
      ...BASE,
      {
        kind: 'linearPattern',
        id: 'lp',
        sources: ['k'],
        direction1: { angle: 0, count: 2, spacing: 2 },
        direction2: { angle: Math.PI / 2, count: 2, spacing: 2 },
      },
    ]);
    expect(regionCurves(grid).map((c) => c.id)).toEqual([
      'k',
      'ef',
      'lp:0-1.k',
      'lp:1-0.k',
      'lp:1-1.k',
    ]);
  });

  it('appends the copies of a circular pattern', () => {
    const data = sketch([
      ...BASE,
      {
        kind: 'circularPattern',
        id: 'cp',
        sources: ['k'],
        center: 'o',
        count: 4,
        angle: 2 * Math.PI,
      },
    ]);
    const curves = regionCurves(data);
    expect(curves.map((c) => c.id)).toEqual(['k', 'ef', 'cp:1.k', 'cp:2.k', 'cp:3.k']);
    const quarter = curves[2];
    if (quarter?.kind !== 'circle') expect.fail('No circle copy cp:1.k');
    expect(quarter.center[0]).toBeCloseTo(0, 12);
    expect(quarter.center[1]).toBeCloseTo(3, 12);
    expect(quarter.radius).toBe(0.5);
  });

  it('turns each copy like curve2 over the points of the data and the copied points', () => {
    const data = sketch([
      ...BASE,
      { kind: 'circularPattern', id: 'cp', sources: ['k', 'ef'], center: 'o', count: 3, angle: 1 },
    ]);
    const copies = patternCopies(data);
    const points = new Map(pointsById(data));
    for (const copy of copies) if (copy.kind === 'point') points.set(copy.id, copy);
    const curveCopies = copies.filter((c): c is SketchCurve => c.kind !== 'point');
    expect(regionCurves(data).slice(2)).toEqual(curveCopies.map((c) => curve2(c, points)));
  });

  it('skips the copies of construction curves and the pattern entities themselves', () => {
    const data = sketch([
      ...BASE,
      { kind: 'mirror', id: 'm', sources: ['cf', 'c'], axis: 'ou' },
      {
        kind: 'linearPattern',
        id: 'lp',
        sources: ['cf'],
        direction1: { angle: 0, count: 2, spacing: 1 },
      },
    ]);
    expect(regionCurves(data).map((c) => c.id)).toEqual(['k', 'ef']);
  });

  it('returns a frozen array with copies', () => {
    const data = sketch([...BASE, { kind: 'mirror', id: 'm', sources: ['k'], axis: 'ou' }]);
    expect(Object.isFrozen(regionCurves(data))).toBe(true);
  });
});
