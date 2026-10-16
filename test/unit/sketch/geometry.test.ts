import { describe, expect, it } from 'vitest';
import { curve2, pointsById, regionCurves } from '@/sketch/geometry';
import { isPattern } from '@/sketch/model';
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

describe('pointsById', () => {
  it('maps point ids to points and skips curves', () => {
    const points = pointsById(DATA);
    expect([...points.keys()]).toEqual(['o', 's', 'e']);
    const s = DATA.entities[1];
    expect(s?.kind).toBe('point');
    expect(s !== undefined && points.get(s.id)).toBe(s);
  });
});

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
