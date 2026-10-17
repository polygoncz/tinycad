import { describe, expect, it } from 'vitest';
import {
  constraintFor,
  constraintTargets,
  curvePoints,
  dimensionFor,
  measure,
  removeItems,
  toggleConstruction,
} from '@/sketch/edit';
import { isDimension, isPattern } from '@/sketch/model';
import type { SketchConstraint, SketchData, SketchEntity, SketchItemId } from '@/sketch/model';
import { parseSketchData } from '@/sketch/parse';
import { textData } from '@/sketch/testing';

function sketch(entities: readonly unknown[], constraints: readonly unknown[] = []): SketchData {
  const r = parseSketchData(entities, constraints);
  if (!r.ok) throw new Error(`invalid test sketch: ${JSON.stringify(r.error)}`);
  return r.value;
}

/**
 * Square a b c d (side 10) with lines ab, bc, cd, da; circle k (r 3) around o; arc q around o
 * from s to t (r 4); a lone point z.
 */
const DATA = sketch(
  [
    { kind: 'point', id: 'a', x: 0, y: 0 },
    { kind: 'point', id: 'b', x: 10, y: 0 },
    { kind: 'point', id: 'c', x: 10, y: 10 },
    { kind: 'point', id: 'd', x: 0, y: 10 },
    { kind: 'line', id: 'ab', p1: 'a', p2: 'b' },
    { kind: 'line', id: 'bc', p1: 'b', p2: 'c' },
    { kind: 'line', id: 'cd', p1: 'c', p2: 'd' },
    { kind: 'line', id: 'da', p1: 'd', p2: 'a' },
    { kind: 'point', id: 'o', x: 30, y: 0 },
    { kind: 'circle', id: 'k', center: 'o', radius: 3 },
    { kind: 'point', id: 's', x: 34, y: 0 },
    { kind: 'point', id: 't', x: 30, y: 4 },
    { kind: 'arc', id: 'q', center: 'o', start: 's', end: 't' },
    { kind: 'point', id: 'z', x: 5, y: 5 },
  ],
  [
    { kind: 'horizontal', id: 'h1', line: 'ab' },
    { kind: 'vertical', id: 'v1', line: 'bc' },
    { kind: 'fix', id: 'f1', point: 'a' },
    { kind: 'radius', id: 'r1', curve: 'k', value: 3 },
    { kind: 'distance', id: 'd1', a: 'a', b: 'c', value: 14 },
  ],
);

function e(...ids: string[]): SketchEntity[] {
  return ids.map((id) => {
    const found = DATA.entities.find((x) => x.id === id);
    if (found === undefined) throw new Error(`no entity ${id}`);
    return found;
  });
}

/** Ids from test strings; the data was parsed, so these are real ids. */
const ids = (...xs: string[]): readonly SketchItemId[] =>
  [...DATA.entities, ...DATA.constraints].map((x) => x.id).filter((id) => xs.includes(id));

const entityIds = (data: SketchData) => data.entities.map((x) => x.id);
const constraintIds = (data: SketchData) => data.constraints.map((x) => x.id);

describe('constraintFor', () => {
  it('horizontal and vertical need exactly one line', () => {
    expect(constraintFor('horizontal', e('ab'))).toEqual({ kind: 'horizontal', line: 'ab' });
    expect(constraintFor('vertical', e('bc'))).toEqual({ kind: 'vertical', line: 'bc' });
    expect(constraintFor('horizontal', e('ab', 'bc'))).toBeNull();
    expect(constraintFor('vertical', e('k'))).toBeNull();
    expect(constraintFor('horizontal', [])).toBeNull();
  });

  it('coincident needs exactly two points, in selection order', () => {
    expect(constraintFor('coincident', e('c', 'a'))).toEqual({
      kind: 'coincident',
      a: 'c',
      b: 'a',
    });
    expect(constraintFor('coincident', e('a'))).toBeNull();
    expect(constraintFor('coincident', e('a', 'ab'))).toBeNull();
    expect(constraintFor('coincident', e('a', 'a'))).toBeNull();
    expect(constraintFor('coincident', e('a', 'b', 'c'))).toBeNull();
  });

  it('fix needs exactly one point', () => {
    expect(constraintFor('fix', e('z'))).toEqual({ kind: 'fix', point: 'z' });
    expect(constraintFor('fix', e('ab'))).toBeNull();
    expect(constraintFor('fix', e('a', 'b'))).toBeNull();
  });

  it('parallel and perpendicular need exactly two lines', () => {
    expect(constraintFor('parallel', e('cd', 'ab'))).toEqual({
      kind: 'parallel',
      a: 'cd',
      b: 'ab',
    });
    expect(constraintFor('perpendicular', e('ab', 'bc'))).toEqual({
      kind: 'perpendicular',
      a: 'ab',
      b: 'bc',
    });
    expect(constraintFor('parallel', e('ab'))).toBeNull();
    expect(constraintFor('perpendicular', e('ab', 'k'))).toBeNull();
    expect(constraintFor('parallel', e('ab', 'ab'))).toBeNull();
  });

  it('equal takes two lines or two circles/arcs', () => {
    expect(constraintFor('equal', e('ab', 'cd'))).toEqual({ kind: 'equal', a: 'ab', b: 'cd' });
    expect(constraintFor('equal', e('q', 'k'))).toEqual({ kind: 'equal', a: 'q', b: 'k' });
    expect(constraintFor('equal', e('ab', 'k'))).toBeNull();
    expect(constraintFor('equal', e('a', 'b'))).toBeNull();
  });

  it('tangent takes a line and a circle/arc in either order, or two circles/arcs', () => {
    expect(constraintFor('tangent', e('ab', 'q'))).toEqual({ kind: 'tangent', a: 'ab', b: 'q' });
    expect(constraintFor('tangent', e('q', 'ab'))).toEqual({ kind: 'tangent', a: 'q', b: 'ab' });
    expect(constraintFor('tangent', e('k', 'q'))).toEqual({ kind: 'tangent', a: 'k', b: 'q' });
    expect(constraintFor('tangent', e('ab', 'cd'))).toBeNull();
    expect(constraintFor('tangent', e('k'))).toBeNull();
    expect(constraintFor('tangent', e('a', 'k'))).toBeNull();
  });

  it('coincident of a point and a curve (either order) is pointOnCurve', () => {
    expect(constraintFor('coincident', e('z', 'ab'))).toEqual({
      kind: 'pointOnCurve',
      point: 'z',
      curve: 'ab',
    });
    expect(constraintFor('coincident', e('k', 'z'))).toEqual({
      kind: 'pointOnCurve',
      point: 'z',
      curve: 'k',
    });
    expect(constraintFor('coincident', e('a', 'q'))).toEqual({
      kind: 'pointOnCurve',
      point: 'a',
      curve: 'q',
    });
    expect(constraintFor('coincident', e('ab', 'cd'))).toBeNull();
    expect(constraintFor('coincident', e('z'))).toBeNull();
  });

  it('pointOnCurve is null for a point that defines the curve', () => {
    expect(constraintFor('coincident', e('a', 'ab'))).toBeNull();
    expect(constraintFor('coincident', e('ab', 'b'))).toBeNull();
    expect(constraintFor('coincident', e('o', 'k'))).toBeNull();
    expect(constraintFor('coincident', e('q', 'o'))).toBeNull();
    expect(constraintFor('coincident', e('s', 'q'))).toBeNull();
    expect(constraintFor('coincident', e('t', 'q'))).toBeNull();
  });

  it('horizontal and vertical of two points align them, in selection order', () => {
    expect(constraintFor('horizontal', e('z', 'a'))).toEqual({ kind: 'hAlign', a: 'z', b: 'a' });
    expect(constraintFor('vertical', e('a', 'z'))).toEqual({ kind: 'vAlign', a: 'a', b: 'z' });
    expect(constraintFor('horizontal', e('a', 'a'))).toBeNull();
    expect(constraintFor('vertical', e('a', 'ab'))).toBeNull();
    expect(constraintFor('horizontal', e('a', 'b', 'z'))).toBeNull();
  });

  it('midpoint takes a point and a line in either order', () => {
    expect(constraintFor('midpoint', e('z', 'ab'))).toEqual({
      kind: 'midpoint',
      point: 'z',
      line: 'ab',
    });
    expect(constraintFor('midpoint', e('cd', 'a'))).toEqual({
      kind: 'midpoint',
      point: 'a',
      line: 'cd',
    });
    expect(constraintFor('midpoint', e('a', 'ab'))).toBeNull();
    expect(constraintFor('midpoint', e('z', 'k'))).toBeNull();
    expect(constraintFor('midpoint', e('z', 'a'))).toBeNull();
    expect(constraintFor('midpoint', e('z'))).toBeNull();
    expect(constraintFor('midpoint', e('ab'))).toBeNull();
  });
});

describe('constraintTargets', () => {
  it('lists the entities of the new constraints in their order', () => {
    const data = sketch(DATA.entities, [
      { kind: 'pointOnCurve', id: 'p1', point: 'z', curve: 'k' },
      { kind: 'midpoint', id: 'm1', point: 'z', line: 'ab' },
      { kind: 'hAlign', id: 'ha', a: 'z', b: 'a' },
      { kind: 'vAlign', id: 'va', a: 'c', b: 'z' },
    ]);
    expect(data.constraints.map(constraintTargets)).toEqual([
      ['z', 'k'],
      ['z', 'ab'],
      ['z', 'a'],
      ['c', 'z'],
    ]);
  });
});

describe('dimensionFor', () => {
  it('a line gives the distance of its points', () => {
    expect(dimensionFor(e('ab'), DATA)).toEqual({ kind: 'distance', a: 'a', b: 'b', value: 10 });
  });

  it('a circle or an arc gives its radius', () => {
    expect(dimensionFor(e('k'), DATA)).toEqual({ kind: 'radius', curve: 'k', value: 3 });
    expect(dimensionFor(e('q'), DATA)).toEqual({ kind: 'radius', curve: 'q', value: 4 });
  });

  it('two points give their distance', () => {
    expect(dimensionFor(e('a', 'z'), DATA)).toEqual({
      kind: 'distance',
      a: 'a',
      b: 'z',
      value: Math.hypot(5, 5),
    });
  });

  it('returns null for other selections and zero lengths', () => {
    expect(dimensionFor([], DATA)).toBeNull();
    expect(dimensionFor(e('a'), DATA)).toBeNull();
    expect(dimensionFor(e('ab', 'bc'), DATA)).toBeNull();
    expect(dimensionFor(e('a', 'ab'), DATA)).toBeNull();
    const zero = sketch([
      { kind: 'point', id: 'p', x: 1, y: 1 },
      { kind: 'point', id: 'r', x: 1, y: 1 },
      { kind: 'line', id: 'l', p1: 'p', p2: 'r' },
    ]);
    expect(dimensionFor(zero.entities.slice(0, 2), zero)).toBeNull();
    expect(dimensionFor(zero.entities.slice(2), zero)).toBeNull();
  });
});

describe('measure', () => {
  const dimension = (id: string) => {
    const c = DATA.constraints.find((x) => x.id === id);
    if (c?.kind !== 'distance' && c?.kind !== 'radius') throw new Error(`no dimension ${id}`);
    return c;
  };

  it('measures the current geometry, not the stored value', () => {
    expect(measure(DATA, dimension('d1'))).toBeCloseTo(Math.hypot(10, 10), 12);
    expect(measure(DATA, dimension('r1'))).toBe(3);
  });

  it('measures the radius of an arc from its start', () => {
    const data = sketch(
      [
        { kind: 'point', id: 'o', x: 0, y: 0 },
        { kind: 'point', id: 's', x: 0, y: 2 },
        { kind: 'point', id: 't', x: -2, y: 0 },
        { kind: 'arc', id: 'q', center: 'o', start: 's', end: 't' },
      ],
      [{ kind: 'radius', id: 'r', curve: 'q', value: 9 }],
    );
    const c = data.constraints[0];
    expect(c?.kind === 'radius' && measure(data, c)).toBe(2);
  });
});

describe('measure – kinds of M28', () => {
  /**
   * Points p (1, 2) and r (4, -2); line ab along +x from (0, 0) to (10, 0); line ce from (2, 1)
   * to (2 + 3, 1 + 3), at 45° to ab; circle k (r 3) around o; arc q around o from s (r 5).
   */
  const data = sketch(
    [
      { kind: 'point', id: 'p', x: 1, y: 2 },
      { kind: 'point', id: 'r', x: 4, y: -2 },
      { kind: 'point', id: 'a', x: 0, y: 0 },
      { kind: 'point', id: 'b', x: 10, y: 0 },
      { kind: 'line', id: 'ab', p1: 'a', p2: 'b' },
      { kind: 'point', id: 'c', x: 2, y: 1 },
      { kind: 'point', id: 'e', x: 5, y: 4 },
      { kind: 'line', id: 'ce', p1: 'c', p2: 'e' },
      { kind: 'point', id: 'o', x: 20, y: 0 },
      { kind: 'circle', id: 'k', center: 'o', radius: 3 },
      { kind: 'point', id: 's', x: 23, y: 4 },
      { kind: 'point', id: 't', x: 15, y: 0 },
      { kind: 'arc', id: 'q', center: 'o', start: 's', end: 't' },
    ],
    [
      { kind: 'hDistance', id: 'h', a: 'p', b: 'r', value: 1 },
      { kind: 'hDistance', id: 'h2', a: 'r', b: 'p', value: 1 },
      { kind: 'vDistance', id: 'v', a: 'p', b: 'r', value: 1 },
      { kind: 'pointLineDistance', id: 'pl', point: 'p', line: 'ab', value: 1 },
      // Beyond the end of the segment: the infinite line counts.
      { kind: 'pointLineDistance', id: 'pl2', point: 'e', line: 'ab', value: 1 },
      { kind: 'pointLineDistance', id: 'pl3', point: 'a', line: 'ce', value: 1 },
      { kind: 'angle', id: 'g', a: 'ab', b: 'ce', value: 1 },
      { kind: 'angle', id: 'gA', a: 'ab', b: 'ce', value: 1, reverseA: true },
      { kind: 'angle', id: 'gB', a: 'ab', b: 'ce', value: 1, reverseB: true },
      { kind: 'angle', id: 'gAB', a: 'ab', b: 'ce', value: 1, reverseA: true, reverseB: true },
      { kind: 'diameter', id: 'dk', curve: 'k', value: 1 },
      { kind: 'diameter', id: 'dq', curve: 'q', value: 1 },
      { kind: 'distance', id: 'd', a: 'p', b: 'r', value: 1 },
      { kind: 'radius', id: 'rq', curve: 'q', value: 1 },
    ],
  );
  const dimension = (id: string) => {
    const c = data.constraints.find((x) => x.id === id);
    if (c === undefined || !('value' in c)) throw new Error(`no dimension ${id}`);
    return c;
  };

  it.each([
    ['distance', 'd', 5],
    ['hDistance', 'h', 3],
    ['hDistance with swapped points', 'h2', 3],
    ['vDistance', 'v', 4],
    ['pointLineDistance', 'pl', 2],
    ['pointLineDistance beyond the segment', 'pl2', 4],
    ['pointLineDistance to a slanted line', 'pl3', Math.SQRT1_2],
    ['angle', 'g', Math.PI / 4],
    ['angle reverseA', 'gA', (3 * Math.PI) / 4],
    ['angle reverseB', 'gB', (3 * Math.PI) / 4],
    ['angle reverseA and reverseB', 'gAB', Math.PI / 4],
    ['diameter of a circle', 'dk', 6],
    ['diameter of an arc', 'dq', 10],
    ['radius of an arc', 'rq', 5],
  ])('measures %s', (_name, id, expected) => {
    expect(measure(data, dimension(id))).toBeCloseTo(expected, 12);
  });

  it('removeItems drops the dimensions on a removed entity', () => {
    const removable = (id: string) => data.entities.filter((x) => x.id === id).map((x) => x.id);
    // With ab also its orphaned points a and b go, so pl3 (from a) goes too.
    expect(constraintIds(removeItems(data, removable('ab')))).toEqual([
      'h',
      'h2',
      'v',
      'dk',
      'dq',
      'd',
      'rq',
    ]);
    expect(constraintIds(removeItems(data, removable('k')))).not.toContain('dk');
    expect(constraintIds(removeItems(data, removable('p')))).toEqual([
      'pl2',
      'pl3',
      'g',
      'gA',
      'gB',
      'gAB',
      'dk',
      'dq',
      'rq',
    ]);
  });
});

describe('removeItems', () => {
  it('removes selected constraints only', () => {
    const r = removeItems(DATA, ids('h1', 'r1'));
    expect(constraintIds(r)).toEqual(['v1', 'f1', 'd1']);
    expect(r.entities).toEqual(DATA.entities);
  });

  it('removing a point removes the curves using it, their orphan points and constraints', () => {
    const r = removeItems(DATA, ids('a'));
    // ab and da go with a; b and d stay because bc and cd still use them.
    expect(entityIds(r)).toEqual(['b', 'c', 'd', 'bc', 'cd', 'o', 'k', 's', 't', 'q', 'z']);
    // h1 (on ab), f1 (on a) and d1 (a–c) refer to removed entities.
    expect(constraintIds(r)).toEqual(['v1', 'r1']);
  });

  it('removing a curve removes its points no other curve uses', () => {
    const r = removeItems(DATA, ids('k'));
    // o is still the center of q.
    expect(entityIds(r)).not.toContain('k');
    expect(entityIds(r)).toContain('o');
    expect(constraintIds(r)).toEqual(['h1', 'v1', 'f1', 'd1']);

    const r2 = removeItems(DATA, ids('q'));
    // s and t were used only by q; o is still the center of k.
    expect(entityIds(r2)).toEqual(entityIds(DATA).filter((x) => !['q', 's', 't'].includes(x)));
  });

  it('keeps points that were not used by a removed curve', () => {
    const r = removeItems(DATA, ids('ab', 'bc', 'cd', 'da'));
    expect(entityIds(r)).toEqual(['o', 'k', 's', 't', 'q', 'z']);
    expect(constraintIds(r)).toEqual(['r1']);
  });

  it('ignores unknown ids and keeps the order', () => {
    const unknown = ids('nothing');
    expect(unknown).toEqual([]);
    const r = removeItems(DATA, [...ids('z'), ...ids('nope')]);
    expect(entityIds(r)).toEqual(entityIds(DATA).filter((x) => x !== 'z'));
    expect(removeItems(DATA, []).entities).toEqual(DATA.entities);
  });

  it('removes the new constraints with their entities', () => {
    const data = sketch(DATA.entities, [
      { kind: 'pointOnCurve', id: 'p1', point: 'z', curve: 'k' },
      { kind: 'midpoint', id: 'm1', point: 'z', line: 'ab' },
      { kind: 'hAlign', id: 'ha', a: 'z', b: 'a' },
      { kind: 'vAlign', id: 'va', a: 'c', b: 'd' },
    ]);
    expect(constraintIds(removeItems(data, ids('z')))).toEqual(['va']);
    expect(constraintIds(removeItems(data, ids('k')))).toEqual(['m1', 'ha', 'va']);
    expect(constraintIds(removeItems(data, ids('ab')))).toEqual(['p1', 'ha', 'va']);
  });

  it('does not change the input', () => {
    const before = JSON.stringify(DATA);
    removeItems(DATA, ids('a', 'h1'));
    expect(JSON.stringify(DATA)).toBe(before);
  });
});

describe('toggleConstruction', () => {
  const construction = (data: SketchData) =>
    data.entities
      .filter((x) => x.kind !== 'point' && !isPattern(x) && x.construction === true)
      .map((x) => x.id);

  it('makes all selected curves construction when some are normal', () => {
    const once = toggleConstruction(DATA, ids('ab', 'k'));
    expect(construction(once)).toEqual(['ab', 'k']);
    const mixed = toggleConstruction(once, ids('ab', 'bc'));
    expect(construction(mixed)).toEqual(['ab', 'bc', 'k']);
  });

  it('makes all selected curves normal when all are construction', () => {
    const once = toggleConstruction(DATA, ids('ab', 'q'));
    const back = toggleConstruction(once, ids('ab', 'q'));
    expect(construction(back)).toEqual([]);
    // Normal curves have no construction field at all (parseSketchData accepts only true).
    expect(back.entities.find((x) => x.id === 'ab')).toEqual({
      kind: 'line',
      id: 'ab',
      p1: 'a',
      p2: 'b',
    });
  });

  it('ignores points and constraints', () => {
    const r = toggleConstruction(DATA, ids('a', 'h1'));
    expect(r.entities).toEqual(DATA.entities);
    expect(r.constraints).toEqual(DATA.constraints);
  });

  it('keeps constraints and the entity order', () => {
    const r = toggleConstruction(DATA, ids('cd'));
    expect(entityIds(r)).toEqual(entityIds(DATA));
    expect(r.constraints).toBe(DATA.constraints satisfies readonly SketchConstraint[]);
  });
});

/**
 * Splines next to line pq: s (control points p r u, starts at p), f (fit points u v q, ends
 * at q), line rv between interior points of both; a circle m; a tangent ps–s and a fix on r.
 */
const SPLINES = sketch(
  [
    { kind: 'point', id: 'p', x: 0, y: 0 },
    { kind: 'point', id: 'q', x: 10, y: 0 },
    { kind: 'point', id: 'r', x: 2, y: 4 },
    { kind: 'point', id: 'u', x: 5, y: 5 },
    { kind: 'point', id: 'v', x: 8, y: 4 },
    { kind: 'line', id: 'pq', p1: 'p', p2: 'q' },
    { kind: 'line', id: 'rv', p1: 'r', p2: 'v' },
    { kind: 'bspline', id: 's', degree: 2, poles: ['p', 'r', 'u'], knots: [0, 0, 0, 1, 1, 1] },
    {
      kind: 'fitSpline',
      id: 'f',
      degree: 2,
      fit: ['u', 'v', 'q'],
      params: [0, 0.5, 1],
      poles: [
        [5, 5],
        [8, 5],
        [10, 0],
      ],
      knots: [0, 0, 0, 1, 1, 1],
    },
    { kind: 'point', id: 'o', x: 20, y: 0 },
    { kind: 'circle', id: 'm', center: 'o', radius: 2 },
  ],
  [
    { kind: 'tangent', id: 't1', a: 'pq', b: 's' },
    { kind: 'fix', id: 'f1', point: 'r' },
  ],
);

function se(...xs: string[]): SketchEntity[] {
  return xs.map((id) => {
    const found = SPLINES.entities.find((x) => x.id === id);
    if (found === undefined) throw new Error(`no entity ${id}`);
    return found;
  });
}

const splineIds = (...xs: string[]): readonly SketchItemId[] =>
  [...SPLINES.entities, ...SPLINES.constraints].map((x) => x.id).filter((id) => xs.includes(id));

describe('splines in editing helpers', () => {
  it('constraintFor offers tangent line–spline at a spline end, in either order', () => {
    expect(constraintFor('tangent', se('pq', 's'))).toEqual({ kind: 'tangent', a: 'pq', b: 's' });
    expect(constraintFor('tangent', se('s', 'pq'))).toEqual({ kind: 'tangent', a: 's', b: 'pq' });
    expect(constraintFor('tangent', se('f', 'pq'))).toEqual({ kind: 'tangent', a: 'f', b: 'pq' });
    expect(constraintFor('tangent', se('pq', 'f'))).toEqual({ kind: 'tangent', a: 'pq', b: 'f' });
  });

  it('constraintFor returns null for tangent away from a spline end', () => {
    // rv touches r (interior pole of s) and v (interior fit point of f).
    expect(constraintFor('tangent', se('rv', 's'))).toBeNull();
    expect(constraintFor('tangent', se('f', 'rv'))).toBeNull();
  });

  it('constraintFor returns null for every other selection with a spline', () => {
    expect(constraintFor('tangent', se('s', 'm'))).toBeNull();
    expect(constraintFor('tangent', se('s', 'f'))).toBeNull();
    expect(constraintFor('tangent', se('s'))).toBeNull();
    expect(constraintFor('equal', se('s', 'f'))).toBeNull();
    expect(constraintFor('equal', se('pq', 's'))).toBeNull();
    expect(constraintFor('parallel', se('pq', 'f'))).toBeNull();
    expect(constraintFor('perpendicular', se('s', 'pq'))).toBeNull();
    expect(constraintFor('horizontal', se('s'))).toBeNull();
    expect(constraintFor('vertical', se('f'))).toBeNull();
    expect(constraintFor('fix', se('f'))).toBeNull();
  });

  it('constraintFor makes coincident of a point and a spline pointOnCurve, in either order', () => {
    expect(constraintFor('coincident', se('v', 's'))).toEqual({
      kind: 'pointOnCurve',
      point: 'v',
      curve: 's',
    });
    expect(constraintFor('coincident', se('f', 'p'))).toEqual({
      kind: 'pointOnCurve',
      point: 'p',
      curve: 'f',
    });
  });

  it('constraintFor returns null for coincident of a spline and its own point', () => {
    expect(constraintFor('coincident', se('p', 's'))).toBeNull();
    expect(constraintFor('coincident', se('r', 's'))).toBeNull();
    expect(constraintFor('coincident', se('f', 'v'))).toBeNull();
    expect(constraintFor('coincident', se('q', 'f'))).toBeNull();
    expect(constraintFor('coincident', se('s', 'f'))).toBeNull();
  });

  it('dimensionFor returns null for a spline', () => {
    expect(dimensionFor(se('s'), SPLINES)).toBeNull();
    expect(dimensionFor(se('f'), SPLINES)).toBeNull();
    expect(dimensionFor(se('s', 'f'), SPLINES)).toBeNull();
  });

  it('removing a control point removes the spline, its orphan points and constraints', () => {
    const r = removeItems(SPLINES, splineIds('r'));
    // s goes with r; p stays (pq), u stays (f); rv goes with r, v stays (f).
    expect(entityIds(r)).toEqual(['p', 'q', 'u', 'v', 'pq', 'f', 'o', 'm']);
    expect(constraintIds(r)).toEqual([]);
  });

  it('removing a fit point removes the fit spline and its orphan points', () => {
    const r = removeItems(SPLINES, splineIds('q'));
    // f and pq go with q; v stays (rv), u stays (s), p stays (s).
    expect(entityIds(r)).toEqual(['p', 'r', 'u', 'v', 'rv', 's', 'o', 'm']);
    expect(constraintIds(r)).toEqual(['f1']);
  });

  it('removing a spline removes the points no other curve uses', () => {
    const r = removeItems(SPLINES, splineIds('f', 'rv'));
    // u is still a pole of s; v only belonged to f and rv; q stays (pq).
    expect(entityIds(r)).toEqual(['p', 'q', 'r', 'u', 'pq', 's', 'o', 'm']);
    expect(constraintIds(r)).toEqual(['t1', 'f1']);
    const r2 = removeItems(SPLINES, splineIds('s'));
    expect(entityIds(r2)).toEqual(['p', 'q', 'r', 'u', 'v', 'pq', 'rv', 'f', 'o', 'm']);
    expect(constraintIds(r2)).toEqual(['f1']);
  });

  it('toggleConstruction switches splines like other curves', () => {
    const once = toggleConstruction(SPLINES, splineIds('s', 'f'));
    const construction = once.entities
      .filter((x) => x.kind !== 'point' && !isPattern(x) && x.construction === true)
      .map((x) => x.id);
    expect(construction).toEqual(['s', 'f']);
    const back = toggleConstruction(once, splineIds('s', 'f'));
    expect(back.entities).toEqual(SPLINES.entities);
  });
});

describe('infinite lines (xline, M31) in editing helpers', () => {
  /** Line ab, xlines x (a→c) and y (b→d), circle k around o, arc q, spline s from a, lone point z. */
  const X = sketch(
    [
      { kind: 'point', id: 'a', x: 0, y: 0 },
      { kind: 'point', id: 'b', x: 10, y: 0 },
      { kind: 'point', id: 'c', x: 10, y: 10 },
      { kind: 'point', id: 'd', x: 0, y: 10 },
      { kind: 'line', id: 'ab', p1: 'a', p2: 'b' },
      { kind: 'xline', id: 'x', p1: 'a', p2: 'c', construction: true },
      { kind: 'xline', id: 'y', p1: 'b', p2: 'd', construction: true },
      { kind: 'point', id: 'o', x: 30, y: 0 },
      { kind: 'circle', id: 'k', center: 'o', radius: 3 },
      { kind: 'point', id: 's1', x: 34, y: 0 },
      { kind: 'point', id: 't1', x: 30, y: 4 },
      { kind: 'arc', id: 'q', center: 'o', start: 's1', end: 't1' },
      { kind: 'point', id: 'e', x: -5, y: 3 },
      { kind: 'bspline', id: 's', degree: 1, poles: ['a', 'e'], knots: [0, 0, 1, 1] },
      { kind: 'point', id: 'z', x: 20, y: 0 },
    ],
    [
      { kind: 'parallel', id: 'p1', a: 'x', b: 'ab' },
      { kind: 'pointLineDistance', id: 'pl', point: 'z', line: 'x', value: 1 },
      { kind: 'angle', id: 'an', a: 'x', b: 'ab', value: 1 },
    ],
  );
  const xe = (...names: string[]): SketchEntity[] =>
    names.map((id) => {
      const found = X.entities.find((v) => v.id === id);
      if (found === undefined) throw new Error(`no entity ${id}`);
      return found;
    });
  const xids = (...xs: string[]): readonly SketchItemId[] =>
    [...X.entities, ...X.constraints].map((v) => v.id).filter((id) => xs.includes(id));

  it('constraintFor takes an xline as a carrier line', () => {
    expect(constraintFor('horizontal', xe('x'))).toEqual({ kind: 'horizontal', line: 'x' });
    expect(constraintFor('vertical', xe('x'))).toEqual({ kind: 'vertical', line: 'x' });
    expect(constraintFor('parallel', xe('x', 'ab'))).toEqual({ kind: 'parallel', a: 'x', b: 'ab' });
    expect(constraintFor('parallel', xe('x', 'y'))).toEqual({ kind: 'parallel', a: 'x', b: 'y' });
    expect(constraintFor('perpendicular', xe('ab', 'x'))).toEqual({
      kind: 'perpendicular',
      a: 'ab',
      b: 'x',
    });
    expect(constraintFor('tangent', xe('x', 'k'))).toEqual({ kind: 'tangent', a: 'x', b: 'k' });
    expect(constraintFor('tangent', xe('q', 'x'))).toEqual({ kind: 'tangent', a: 'q', b: 'x' });
    expect(constraintFor('coincident', xe('z', 'x'))).toEqual({
      kind: 'pointOnCurve',
      point: 'z',
      curve: 'x',
    });
    expect(constraintFor('coincident', xe('x', 'z'))).toEqual({
      kind: 'pointOnCurve',
      point: 'z',
      curve: 'x',
    });
  });

  it('constraintFor returns null where an xline would need a length or ends', () => {
    expect(constraintFor('midpoint', xe('z', 'x'))).toBeNull();
    expect(constraintFor('midpoint', xe('x', 'z'))).toBeNull();
    expect(constraintFor('equal', xe('x', 'y'))).toBeNull();
    expect(constraintFor('equal', xe('x', 'ab'))).toBeNull();
    // x shares a with the first pole of s.
    expect(constraintFor('tangent', xe('x', 's'))).toBeNull();
    expect(constraintFor('tangent', xe('x', 'y'))).toBeNull();
    expect(constraintFor('coincident', xe('a', 'x'))).toBeNull();
    expect(constraintFor('fix', xe('x'))).toBeNull();
  });

  it('dimensionFor returns null for an xline (it has no length)', () => {
    expect(dimensionFor(xe('x'), X)).toBeNull();
    expect(dimensionFor(xe('x', 'ab'), X)).toBeNull();
  });

  it('measure measures the distance and the angle to an xline', () => {
    const [pl, angle] = X.constraints.filter(isDimension);
    expect(pl === undefined ? NaN : measure(X, pl)).toBeCloseTo(20 / Math.SQRT2, 9);
    expect(angle === undefined ? NaN : measure(X, angle)).toBeCloseTo(Math.PI / 4, 9);
  });

  it('curvePoints of an xline are its two points', () => {
    const [x] = xe('x');
    expect(x?.kind === 'xline' ? curvePoints(x) : []).toEqual(['a', 'c']);
  });

  it('removing a point of an xline removes the xline and its constraints', () => {
    const out = removeItems(X, xids('c'));
    expect(entityIds(out)).not.toContain('x');
    expect(entityIds(out)).not.toContain('c');
    // a is still used by ab and s.
    expect(entityIds(out)).toContain('a');
    expect(constraintIds(out)).toEqual([]);
  });

  it('removing an xline removes its orphan points', () => {
    const out = removeItems(X, xids('y'));
    expect(entityIds(out)).not.toContain('y');
    expect(entityIds(out)).not.toContain('d');
    expect(entityIds(out)).toContain('b');
  });

  it('toggleConstruction skips an xline: it stays construction', () => {
    expect(toggleConstruction(X, xids('x'))).toBe(X);
    const out = toggleConstruction(X, xids('x', 'ab'));
    const byId = (id: string) => out.entities.find((v) => v.id === id);
    expect(byId('ab')).toMatchObject({ construction: true });
    expect(byId('x')).toBe(X.entities.find((v) => v.id === 'x'));
    const back = toggleConstruction(out, xids('x', 'ab'));
    expect(back.entities.find((v) => v.id === 'ab')).not.toHaveProperty('construction');
    expect(back.entities.find((v) => v.id === 'x')).toMatchObject({ construction: true });
  });
});

/**
 * M36: square a b c d with lines ab, bc, cd, da; an axis line xy (x [20, 0], y [20, 10]); a lone
 * point z; mirror m of ab and z across xy; linear pattern lp of bc and cd; circular pattern cp of
 * da around z.
 */
const PATTERNS = sketch(
  [
    ...DATA.entities.slice(0, 8),
    { kind: 'point', id: 'x', x: 20, y: 0 },
    { kind: 'point', id: 'y', x: 20, y: 10 },
    { kind: 'line', id: 'xy', p1: 'x', p2: 'y', construction: true },
    { kind: 'point', id: 'z', x: 5, y: 5 },
    { kind: 'mirror', id: 'm', sources: ['ab', 'z'], axis: 'xy' },
    {
      kind: 'linearPattern',
      id: 'lp',
      sources: ['bc', 'cd'],
      direction1: { angle: 0, count: 3, spacing: 12 },
    },
    {
      kind: 'circularPattern',
      id: 'cp',
      sources: ['da'],
      center: 'z',
      count: 4,
      angle: 2 * Math.PI,
    },
  ],
  [
    { kind: 'horizontal', id: 'h1', line: 'ab' },
    { kind: 'symmetric', id: 's1', a: 'a', b: 'c', axis: 'xy' },
  ],
);

const patternIds = (...xs: string[]): readonly SketchItemId[] =>
  [...PATTERNS.entities, ...PATTERNS.constraints].map((x) => x.id).filter((id) => xs.includes(id));

function patternEntity(id: string): SketchEntity {
  const found = PATTERNS.entities.find((x) => x.id === id);
  if (found === undefined) throw new Error(`no entity ${id}`);
  return found;
}

function sourcesOf(data: SketchData, id: string): readonly string[] | undefined {
  const found = data.entities.find((x) => x.id === id);
  return found !== undefined && isPattern(found) ? found.sources : undefined;
}

describe('symmetric constraint (M36)', () => {
  const sel = (...xs: string[]) => xs.map(patternEntity);

  it('constraintFor takes two points and an axis line, in this order', () => {
    expect(constraintFor('symmetric', sel('a', 'c', 'xy'))).toEqual({
      kind: 'symmetric',
      a: 'a',
      b: 'c',
      axis: 'xy',
    });
  });

  it('constraintFor returns null for other selections', () => {
    expect(constraintFor('symmetric', sel('a', 'c'))).toBeNull();
    expect(constraintFor('symmetric', sel('xy', 'a', 'c'))).toBeNull();
    expect(constraintFor('symmetric', sel('a', 'a', 'xy'))).toBeNull();
    expect(constraintFor('symmetric', sel('a', 'c', 'z'))).toBeNull();
    expect(constraintFor('symmetric', sel('a', 'c', 'xy', 'z'))).toBeNull();
    // A point of the axis.
    expect(constraintFor('symmetric', sel('x', 'c', 'xy'))).toBeNull();
    expect(constraintFor('symmetric', sel('a', 'y', 'xy'))).toBeNull();
    // Three entities fit no other constraint.
    expect(constraintFor('coincident', sel('a', 'c', 'xy'))).toBeNull();
  });

  it('constraintTargets lists a, b and the axis', () => {
    const symmetric = PATTERNS.constraints.find((c) => c.id === 's1');
    expect(symmetric !== undefined && constraintTargets(symmetric)).toEqual(['a', 'c', 'xy']);
  });

  it('removeItems removes it with its axis or a point', () => {
    expect(constraintIds(removeItems(PATTERNS, patternIds('xy')))).toEqual(['h1']);
    expect(constraintIds(removeItems(PATTERNS, patternIds('c')))).toEqual(['h1']);
  });
});

describe('editing helpers with patterns (M36)', () => {
  it('constraintFor and dimensionFor return null when a pattern is selected', () => {
    expect(constraintFor('horizontal', [patternEntity('m')])).toBeNull();
    expect(constraintFor('fix', [patternEntity('cp')])).toBeNull();
    expect(constraintFor('equal', [patternEntity('m'), patternEntity('lp')])).toBeNull();
    expect(constraintFor('coincident', [patternEntity('z'), patternEntity('m')])).toBeNull();
    expect(
      constraintFor('symmetric', [patternEntity('a'), patternEntity('c'), patternEntity('m')]),
    ).toBeNull();
    expect(dimensionFor([patternEntity('lp')], PATTERNS)).toBeNull();
    expect(dimensionFor([patternEntity('a'), patternEntity('cp')], PATTERNS)).toBeNull();
  });

  it('toggleConstruction skips patterns', () => {
    const r = toggleConstruction(PATTERNS, patternIds('m', 'lp', 'ab'));
    expect(r.entities.find((x) => x.id === 'm')).toBe(patternEntity('m'));
    expect(r.entities.find((x) => x.id === 'lp')).toBe(patternEntity('lp'));
    const ab = r.entities.find((x) => x.id === 'ab');
    expect(ab?.kind === 'line' && ab.construction).toBe(true);
    expect(toggleConstruction(PATTERNS, patternIds('m', 'cp'))).toBe(PATTERNS);
  });
});

describe('removeItems with patterns (M36)', () => {
  it('removing a pattern keeps its sources, axis and center', () => {
    const r = removeItems(PATTERNS, patternIds('m', 'lp', 'cp'));
    expect(entityIds(r)).toEqual(entityIds(PATTERNS).filter((x) => !['m', 'lp', 'cp'].includes(x)));
    expect(constraintIds(r)).toEqual(['h1', 's1']);
  });

  it('removing a source drops it from the sources of the patterns', () => {
    const r = removeItems(PATTERNS, patternIds('cd'));
    expect(sourcesOf(r, 'lp')).toEqual(['bc']);
    expect(Object.isFrozen(sourcesOf(r, 'lp'))).toBe(true);
    // Other patterns stay the same objects.
    expect(r.entities.find((x) => x.id === 'm')).toBe(patternEntity('m'));
  });

  it('removing the last source removes the pattern', () => {
    const r = removeItems(PATTERNS, patternIds('da'));
    expect(entityIds(r)).not.toContain('cp');
  });

  it('removing a point source drops it too', () => {
    const r = removeItems(PATTERNS, patternIds('z'));
    expect(sourcesOf(r, 'm')).toEqual(['ab']);
    // z is the center of cp: cp goes as well.
    expect(entityIds(r)).not.toContain('cp');
  });

  it('removing the axis or the center removes the pattern', () => {
    const axis = removeItems(PATTERNS, patternIds('xy'));
    expect(entityIds(axis)).not.toContain('m');
    expect(entityIds(axis)).toContain('ab');
    // A point of the axis removes the axis and so the mirror.
    const point = removeItems(PATTERNS, patternIds('y'));
    expect(entityIds(point)).not.toContain('xy');
    expect(entityIds(point)).not.toContain('m');
  });

  it('cascades to a fixed point: a point removes its curves, they leave the sources, empty patterns go', () => {
    // a removes ab and da; ab is the only curve of m (z stays its source), da the only source of cp.
    const r = removeItems(PATTERNS, patternIds('a'));
    expect(sourcesOf(r, 'm')).toEqual(['z']);
    expect(entityIds(r)).not.toContain('cp');
    expect(sourcesOf(r, 'lp')).toEqual(['bc', 'cd']);
  });

  it('a point used as a center counts as used', () => {
    // A circle around z removed: z stays, it is the center of cp.
    const data = sketch(
      [...PATTERNS.entities, { kind: 'circle', id: 'k', center: 'z', radius: 1 }],
      [],
    );
    const withoutM = removeItems(data, [
      ...patternIds('m'),
      ...data.entities.filter((x) => x.id === 'k').map((x) => x.id),
    ]);
    expect(entityIds(withoutM)).toContain('z');
    expect(entityIds(withoutM)).toContain('cp');
  });

  it('removes a center point when its pattern goes in the same cascade', () => {
    // o is used only by circle k and as the center of pattern po of k: removing k empties po,
    // so o is an orphan of k and goes too.
    const data = sketch(
      [
        { kind: 'point', id: 'o', x: 0, y: 0 },
        { kind: 'point', id: 'p', x: 3, y: 0 },
        { kind: 'circle', id: 'k', center: 'p', radius: 1 },
        { kind: 'line', id: 'op', p1: 'o', p2: 'p' },
        { kind: 'circularPattern', id: 'po', sources: ['k'], center: 'o', count: 2, angle: 1 },
      ],
      [],
    );
    const r = removeItems(
      data,
      data.entities.filter((x) => x.id === 'op' || x.id === 'k').map((x) => x.id),
    );
    expect(entityIds(r)).toEqual([]);
  });
});

/**
 * M37: a text 't' ('ab') on its construction baseline t.bl (points t.p1, t.p2) with a horizontal
 * constraint on the baseline; a second text 'u' on the same baseline; a line ef with points e, f.
 */
const TEXTS = sketch(
  [
    ...textData({ id: 't' }).entities,
    ...textData({ id: 'u', text: 'c' }).entities.filter((e) => e.kind === 'text'),
    { kind: 'point', id: 'e', x: 0, y: 20 },
    { kind: 'point', id: 'f', x: 10, y: 20 },
    { kind: 'line', id: 'ef', p1: 'e', p2: 'f' },
  ].map((e) => (e.kind === 'text' && e.id === 'u' ? { ...e, baseline: 't.bl' } : e)),
  [{ kind: 'horizontal', id: 'h', line: 't.bl' }],
);

const textEntity = (id: string): SketchEntity => {
  const e = TEXTS.entities.find((x) => x.id === id);
  if (e === undefined) throw new Error(`no entity ${id}`);
  return e;
};
/** Ids from test strings; the data was parsed, so these are real ids. */
const textIds = (...xs: string[]): readonly SketchItemId[] =>
  [...TEXTS.entities, ...TEXTS.constraints].map((x) => x.id).filter((id) => xs.includes(id));
const idsOf = (data: SketchData) => data.entities.map((e) => e.id);

describe('editing helpers with texts (M37)', () => {
  it('constraintFor and dimensionFor return null when a text is selected', () => {
    const t = textEntity('t');
    const line = textEntity('ef');
    const point = textEntity('e');
    expect(constraintFor('horizontal', [t])).toBeNull();
    expect(constraintFor('fix', [t])).toBeNull();
    expect(constraintFor('parallel', [t, line])).toBeNull();
    expect(constraintFor('equal', [line, t])).toBeNull();
    expect(constraintFor('coincident', [point, t])).toBeNull();
    expect(constraintFor('midpoint', [t, point])).toBeNull();
    expect(dimensionFor([t], TEXTS)).toBeNull();
    expect(dimensionFor([t, line], TEXTS)).toBeNull();
  });

  it('toggleConstruction toggles a text with the selected curves', () => {
    const once = toggleConstruction(TEXTS, textIds('t', 'ef'));
    const t = once.entities.find((x) => x.id === 't');
    expect(t?.kind === 'text' && t.construction).toBe(true);
    const ef = once.entities.find((x) => x.id === 'ef');
    expect(ef?.kind === 'line' && ef.construction).toBe(true);
    const back = toggleConstruction(once, textIds('t'));
    const normal = back.entities.find((x) => x.id === 't');
    // A normal text has no construction field at all, like a curve.
    expect(normal).toEqual({ ...textEntity('t') });
    expect(normal !== undefined && Object.hasOwn(normal, 'construction')).toBe(false);
    expect(parseSketchData(back.entities, back.constraints).ok).toBe(true);
  });

  it('toggleConstruction of a construction text and a normal curve makes both construction', () => {
    const once = toggleConstruction(TEXTS, textIds('t'));
    const both = toggleConstruction(once, textIds('t', 'ef'));
    const t = both.entities.find((x) => x.id === 't');
    expect(t?.kind === 'text' && t.construction).toBe(true);
  });

  it('removing a text keeps its baseline and the constraints on it', () => {
    const r = removeItems(TEXTS, textIds('t'));
    expect(idsOf(r)).toEqual(idsOf(TEXTS).filter((x) => x !== 't'));
    expect(r.constraints.map((c) => c.id)).toEqual(['h']);
  });

  it('removing the baseline removes every text on it', () => {
    const r = removeItems(TEXTS, textIds('t.bl'));
    expect(idsOf(r)).toEqual(['e', 'f', 'ef']);
    expect(r.constraints).toEqual([]);
  });

  it('removing a point of the baseline removes the baseline and the texts', () => {
    const r = removeItems(TEXTS, textIds('t.p2'));
    expect(idsOf(r)).toEqual(['e', 'f', 'ef']);
  });
});

describe('symmetric constraint across an xline (after M31)', () => {
  const X = sketch(
    [
      ...PATTERNS.entities.filter((e) => !isPattern(e)),
      { kind: 'xline', id: 'xx', p1: 'x', p2: 'y', construction: true },
    ],
    [],
  );
  const sel = (...xs: string[]) =>
    xs.map((id) => {
      const found = X.entities.find((e) => e.id === id);
      if (found === undefined) throw new Error(`no entity ${id}`);
      return found;
    });

  it('constraintFor takes an xline as the axis', () => {
    expect(constraintFor('symmetric', sel('a', 'c', 'xx'))).toEqual({
      kind: 'symmetric',
      a: 'a',
      b: 'c',
      axis: 'xx',
    });
  });

  it('constraintFor refuses a point of the xline', () => {
    expect(constraintFor('symmetric', sel('x', 'c', 'xx'))).toBeNull();
  });
});
