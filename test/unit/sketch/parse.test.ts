import { describe, expect, it } from 'vitest';
import { parseSketchData } from '@/sketch/parse';
import type { SketchIssue } from '@/sketch/parse';

const P = (id: string, x = 0, y = 0) => ({ kind: 'point', id, x, y });

/** Points a, b, c, d of a 10 × 10 square, its four lines, a circle and an arc (all valid). */
const ENTITIES: readonly unknown[] = [
  P('a', 0, 0),
  P('b', 10, 0),
  P('c', 10, 10),
  P('d', 0, 10),
  { kind: 'line', id: 'ab', p1: 'a', p2: 'b' },
  { kind: 'line', id: 'bc', p1: 'b', p2: 'c', construction: true },
  { kind: 'circle', id: 'k', center: 'a', radius: 2 },
  // Quarter arc around a from b to d (both 10 away).
  { kind: 'arc', id: 'q', center: 'a', start: 'b', end: 'd' },
];

const entityIssue = (index: number): SketchIssue => ({
  path: 'entities',
  index,
  code: 'sketch.invalidEntity',
});
const constraintIssue = (index: number): SketchIssue => ({
  path: 'constraints',
  index,
  code: 'sketch.invalidConstraint',
});

function entityIssues(entities: unknown): readonly SketchIssue[] {
  const r = parseSketchData(entities, []);
  return r.ok ? [] : r.error;
}

function constraintIssues(constraints: unknown): readonly SketchIssue[] {
  const r = parseSketchData(ENTITIES, constraints);
  return r.ok ? [] : r.error;
}

describe('parseSketchData – valid data', () => {
  it('returns the same values typed', () => {
    const constraints = [{ kind: 'horizontal', id: 'h', line: 'ab' }];
    const r = parseSketchData(ENTITIES, constraints);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.entities).toBe(ENTITIES);
    expect(r.value.constraints).toBe(constraints);
  });

  it('accepts empty arrays', () => {
    expect(parseSketchData([], []).ok).toBe(true);
  });

  it('accepts a reference to a point defined later in the array', () => {
    expect(entityIssues([{ kind: 'line', id: 'l', p1: 'a', p2: 'b' }, P('a'), P('b', 1)])).toEqual(
      [],
    );
  });

  it('accepts every constraint kind with valid targets', () => {
    expect(
      constraintIssues([
        { kind: 'coincident', id: 'c1', a: 'a', b: 'b' },
        { kind: 'horizontal', id: 'c2', line: 'ab' },
        { kind: 'vertical', id: 'c3', line: 'bc' },
        { kind: 'parallel', id: 'c4', a: 'ab', b: 'bc' },
        { kind: 'perpendicular', id: 'c5', a: 'ab', b: 'bc' },
        { kind: 'equal', id: 'c6', a: 'ab', b: 'bc' },
        { kind: 'equal', id: 'c7', a: 'k', b: 'q' },
        { kind: 'tangent', id: 'c8', a: 'ab', b: 'k' },
        { kind: 'tangent', id: 'c9', a: 'q', b: 'ab' },
        { kind: 'tangent', id: 'c10', a: 'k', b: 'q' },
        { kind: 'fix', id: 'c11', point: 'a' },
        { kind: 'distance', id: 'c12', a: 'a', b: 'c', value: 5 },
        { kind: 'radius', id: 'c13', curve: 'k', value: 3 },
        { kind: 'radius', id: 'c14', curve: 'q', value: 3 },
        { kind: 'pointOnCurve', id: 'c15', point: 'c', curve: 'ab' },
        { kind: 'pointOnCurve', id: 'c16', point: 'd', curve: 'k' },
        { kind: 'pointOnCurve', id: 'c17', point: 'c', curve: 'q' },
        { kind: 'midpoint', id: 'c18', point: 'c', line: 'ab' },
        { kind: 'hAlign', id: 'c19', a: 'c', b: 'd' },
        { kind: 'vAlign', id: 'c20', a: 'd', b: 'a' },
      ]),
    ).toEqual([]);
  });

  it('accepts every dimension kind of M28 without placement', () => {
    expect(
      constraintIssues([
        { kind: 'hDistance', id: 'd1', a: 'a', b: 'c', value: 10 },
        { kind: 'vDistance', id: 'd2', a: 'a', b: 'c', value: 10 },
        { kind: 'pointLineDistance', id: 'd3', point: 'c', line: 'ab', value: 10 },
        { kind: 'angle', id: 'd4', a: 'ab', b: 'bc', value: Math.PI / 2 },
        { kind: 'angle', id: 'd5', a: 'ab', b: 'bc', value: 1, reverseA: true, reverseB: true },
        { kind: 'diameter', id: 'd6', curve: 'k', value: 4 },
        { kind: 'diameter', id: 'd7', curve: 'q', value: 20 },
      ]),
    ).toEqual([]);
  });

  it('accepts a placement of the matching kind on every dimension', () => {
    const linear = { kind: 'linear', offset: -3, along: 2.5 };
    const radial = { kind: 'radial', angle: -1, distance: 7 };
    expect(
      constraintIssues([
        { kind: 'distance', id: 'd1', a: 'a', b: 'c', value: 5, placement: linear },
        { kind: 'hDistance', id: 'd2', a: 'a', b: 'c', value: 10, placement: linear },
        { kind: 'vDistance', id: 'd3', a: 'a', b: 'c', value: 10, placement: linear },
        {
          kind: 'pointLineDistance',
          id: 'd4',
          point: 'c',
          line: 'ab',
          value: 10,
          placement: linear,
        },
        {
          kind: 'angle',
          id: 'd5',
          a: 'ab',
          b: 'bc',
          value: 1,
          placement: { kind: 'angular', radius: 4, t: 0 },
        },
        {
          kind: 'angle',
          id: 'd6',
          a: 'ab',
          b: 'bc',
          value: 1,
          placement: { kind: 'angular', radius: 4, t: 1 },
        },
        { kind: 'radius', id: 'd7', curve: 'k', value: 2, placement: radial },
        { kind: 'diameter', id: 'd8', curve: 'q', value: 20, placement: radial },
      ]),
    ).toEqual([]);
  });
});

describe('parseSketchData – entities', () => {
  it('reports a non-array with index -1', () => {
    expect(entityIssues({})).toEqual([entityIssue(-1)]);
    const r = parseSketchData([], 'nope');
    expect(r.ok ? [] : r.error).toEqual([constraintIssue(-1)]);
  });

  it.each([
    ['not an object', 42],
    ['null', null],
    ['an array', []],
    ['unknown kind', { kind: 'spline', id: 'x' }],
    ['missing property', { kind: 'point', id: 'x', x: 0 }],
    ['extra property', { kind: 'point', id: 'x', x: 0, y: 0, z: 0 }],
    ['empty id', P('')],
    ['id not a string', { kind: 'point', id: 7, x: 0, y: 0 }],
    ['non-finite coordinate', P('x', Number.NaN)],
    ['infinite coordinate', P('x', 0, Infinity)],
    ['coordinate not a number', { kind: 'point', id: 'x', x: '1', y: 0 }],
    ['zero radius', { kind: 'circle', id: 'x', center: 'a', radius: 0 }],
    ['negative radius', { kind: 'circle', id: 'x', center: 'a', radius: -1 }],
    ['non-finite radius', { kind: 'circle', id: 'x', center: 'a', radius: Infinity }],
    ['construction false', { kind: 'line', id: 'x', p1: 'a', p2: 'b', construction: false }],
    ['reference to a missing point', { kind: 'line', id: 'x', p1: 'a', p2: 'zz' }],
    ['reference to a line', { kind: 'line', id: 'x', p1: 'a', p2: 'ab' }],
    ['p1 equal to p2', { kind: 'line', id: 'x', p1: 'a', p2: 'a' }],
    ['arc with repeated point', { kind: 'arc', id: 'x', center: 'a', start: 'b', end: 'b' }],
    ['arc with center = start', { kind: 'arc', id: 'x', center: 'a', start: 'a', end: 'b' }],
    ['arc with unequal radii', { kind: 'arc', id: 'x', center: 'a', start: 'b', end: 'c' }],
    ['arc with zero radius', { kind: 'arc', id: 'x', center: 'a', start: 'z1', end: 'z2' }],
  ])('reports %s at its index', (_name, bad) => {
    // z1 and z2 sit on a: an arc around a through them has radius 0.
    expect(entityIssues([...ENTITIES, P('z1'), P('z2'), bad])).toEqual([
      entityIssue(ENTITIES.length + 2),
    ]);
  });

  it('accepts an arc whose radii differ within the tolerance', () => {
    expect(
      entityIssues([
        P('o'),
        P('s', 100, 0),
        P('e', 0, 100 + 5e-5),
        { kind: 'arc', id: 'x', center: 'o', start: 's', end: 'e' },
      ]),
    ).toEqual([]);
    expect(
      entityIssues([
        P('o'),
        P('s', 100, 0),
        P('e', 0, 100 + 2e-4),
        { kind: 'arc', id: 'x', center: 'o', start: 's', end: 'e' },
      ]),
    ).toEqual([entityIssue(3)]);
  });

  it('reports a duplicate id at the later occurrence', () => {
    expect(entityIssues([P('a'), P('b', 1), P('a', 2)])).toEqual([entityIssue(2)]);
  });

  it('reports all problems, not just the first', () => {
    expect(entityIssues([P('a'), 1, P('b', Number.NaN), P('c')])).toEqual([
      entityIssue(1),
      entityIssue(2),
    ]);
  });
});

describe('parseSketchData – constraints', () => {
  it.each([
    ['not an object', 'x'],
    ['unknown kind', { kind: 'concentric', id: 'x', a: 'a', b: 'b' }],
    ['missing property', { kind: 'horizontal', id: 'x' }],
    ['extra property', { kind: 'fix', id: 'x', point: 'a', value: 1 }],
    ['empty id', { kind: 'fix', id: '', point: 'a' }],
    ['id used by an entity', { kind: 'fix', id: 'ab', point: 'a' }],
    ['coincident on a line', { kind: 'coincident', id: 'x', a: 'a', b: 'ab' }],
    ['coincident a = b', { kind: 'coincident', id: 'x', a: 'a', b: 'a' }],
    ['horizontal on a point', { kind: 'horizontal', id: 'x', line: 'a' }],
    ['vertical on a circle', { kind: 'vertical', id: 'x', line: 'k' }],
    ['parallel with an arc', { kind: 'parallel', id: 'x', a: 'ab', b: 'q' }],
    ['perpendicular a = b', { kind: 'perpendicular', id: 'x', a: 'ab', b: 'ab' }],
    ['equal line and circle', { kind: 'equal', id: 'x', a: 'ab', b: 'k' }],
    ['tangent two lines', { kind: 'tangent', id: 'x', a: 'ab', b: 'bc' }],
    ['tangent with a point', { kind: 'tangent', id: 'x', a: 'a', b: 'k' }],
    ['fix on a line', { kind: 'fix', id: 'x', point: 'ab' }],
    ['fix on a missing entity', { kind: 'fix', id: 'x', point: 'zz' }],
    ['distance between lines', { kind: 'distance', id: 'x', a: 'ab', b: 'bc', value: 1 }],
    ['distance zero', { kind: 'distance', id: 'x', a: 'a', b: 'b', value: 0 }],
    ['distance NaN', { kind: 'distance', id: 'x', a: 'a', b: 'b', value: Number.NaN }],
    ['distance a = b', { kind: 'distance', id: 'x', a: 'a', b: 'a', value: 1 }],
    ['radius on a line', { kind: 'radius', id: 'x', curve: 'ab', value: 1 }],
    ['radius negative', { kind: 'radius', id: 'x', curve: 'k', value: -1 }],
    ['pointOnCurve on a point', { kind: 'pointOnCurve', id: 'x', point: 'c', curve: 'd' }],
    ['pointOnCurve of a line', { kind: 'pointOnCurve', id: 'x', point: 'bc', curve: 'ab' }],
    ['pointOnCurve of an end', { kind: 'pointOnCurve', id: 'x', point: 'a', curve: 'ab' }],
    ['pointOnCurve of a centre', { kind: 'pointOnCurve', id: 'x', point: 'a', curve: 'k' }],
    ['pointOnCurve of an arc end', { kind: 'pointOnCurve', id: 'x', point: 'd', curve: 'q' }],
    ['pointOnCurve missing curve', { kind: 'pointOnCurve', id: 'x', point: 'c', curve: 'zz' }],
    ['midpoint on a circle', { kind: 'midpoint', id: 'x', point: 'c', line: 'k' }],
    ['midpoint of an end', { kind: 'midpoint', id: 'x', point: 'b', line: 'ab' }],
    ['midpoint of a line', { kind: 'midpoint', id: 'x', point: 'bc', line: 'ab' }],
    ['hAlign a = b', { kind: 'hAlign', id: 'x', a: 'c', b: 'c' }],
    ['hAlign with a line', { kind: 'hAlign', id: 'x', a: 'c', b: 'ab' }],
    ['vAlign with a circle', { kind: 'vAlign', id: 'x', a: 'k', b: 'c' }],
    ['vAlign extra property', { kind: 'vAlign', id: 'x', a: 'c', b: 'd', line: 'ab' }],
    ['hDistance between lines', { kind: 'hDistance', id: 'x', a: 'ab', b: 'bc', value: 1 }],
    ['vDistance zero', { kind: 'vDistance', id: 'x', a: 'a', b: 'b', value: 0 }],
    ['vDistance a = b', { kind: 'vDistance', id: 'x', a: 'a', b: 'a', value: 1 }],
    [
      'pointLineDistance to a point',
      { kind: 'pointLineDistance', id: 'x', point: 'c', line: 'a', value: 1 },
    ],
    [
      'pointLineDistance from a line',
      { kind: 'pointLineDistance', id: 'x', point: 'bc', line: 'ab', value: 1 },
    ],
    [
      'pointLineDistance from an end',
      { kind: 'pointLineDistance', id: 'x', point: 'b', line: 'ab', value: 1 },
    ],
    [
      'pointLineDistance negative',
      { kind: 'pointLineDistance', id: 'x', point: 'c', line: 'ab', value: -1 },
    ],
    ['angle a = b', { kind: 'angle', id: 'x', a: 'ab', b: 'ab', value: 1 }],
    ['angle with a circle', { kind: 'angle', id: 'x', a: 'ab', b: 'k', value: 1 }],
    ['angle zero', { kind: 'angle', id: 'x', a: 'ab', b: 'bc', value: 0 }],
    ['angle π', { kind: 'angle', id: 'x', a: 'ab', b: 'bc', value: Math.PI }],
    ['angle over π', { kind: 'angle', id: 'x', a: 'ab', b: 'bc', value: 4 }],
    [
      'angle reverseA false',
      { kind: 'angle', id: 'x', a: 'ab', b: 'bc', value: 1, reverseA: false },
    ],
    [
      'angle reverseB not true',
      { kind: 'angle', id: 'x', a: 'ab', b: 'bc', value: 1, reverseB: 1 },
    ],
    [
      'reverseA on a distance',
      { kind: 'distance', id: 'x', a: 'a', b: 'c', value: 1, reverseA: true },
    ],
    ['diameter on a point', { kind: 'diameter', id: 'x', curve: 'a', value: 1 }],
    ['diameter infinite', { kind: 'diameter', id: 'x', curve: 'k', value: Infinity }],
  ])('reports %s at its index', (_name, bad) => {
    expect(constraintIssues([{ kind: 'fix', id: 'f', point: 'a' }, bad])).toEqual([
      constraintIssue(1),
    ]);
  });

  const LINEAR = { kind: 'linear', offset: 1, along: 0 };
  const RADIAL = { kind: 'radial', angle: 0, distance: 1 };
  const ANGULAR = { kind: 'angular', radius: 1, t: 0.5 };
  const dist = (placement: unknown) => ({
    kind: 'distance',
    id: 'x',
    a: 'a',
    b: 'c',
    value: 1,
    placement,
  });
  const rad = (placement: unknown) => ({
    kind: 'radius',
    id: 'x',
    curve: 'k',
    value: 1,
    placement,
  });
  const ang = (placement: unknown) => ({
    kind: 'angle',
    id: 'x',
    a: 'ab',
    b: 'bc',
    value: 1,
    placement,
  });
  it.each([
    ['placement not an object', dist('linear')],
    ['placement null', dist(null)],
    ['placement undefined', dist(undefined)],
    ['radial on a distance', dist(RADIAL)],
    ['angular on a distance', dist(ANGULAR)],
    ['linear on a radius', rad(LINEAR)],
    ['angular on a diameter', { ...rad(ANGULAR), kind: 'diameter' }],
    ['linear on an angle', ang(LINEAR)],
    [
      'linear on a pointLineDistance',
      { kind: 'pointLineDistance', id: 'x', point: 'c', line: 'ab', value: 1, placement: RADIAL },
    ],
    ['unknown placement kind', dist({ kind: 'polar', offset: 1, along: 0 })],
    ['placement with a missing property', dist({ kind: 'linear', offset: 1 })],
    ['placement with an extra property', dist({ ...LINEAR, side: 1 })],
    ['linear offset NaN', dist({ ...LINEAR, offset: Number.NaN })],
    ['linear along infinite', dist({ ...LINEAR, along: -Infinity })],
    ['linear offset not a number', dist({ ...LINEAR, offset: '1' })],
    ['radial angle infinite', rad({ ...RADIAL, angle: Infinity })],
    ['radial distance zero', rad({ ...RADIAL, distance: 0 })],
    ['radial distance negative', rad({ ...RADIAL, distance: -1 })],
    ['angular radius zero', ang({ ...ANGULAR, radius: 0 })],
    ['angular radius NaN', ang({ ...ANGULAR, radius: Number.NaN })],
    ['angular t below 0', ang({ ...ANGULAR, t: -0.01 })],
    ['angular t above 1', ang({ ...ANGULAR, t: 1.01 })],
    [
      'placement on a geometric constraint',
      { kind: 'fix', id: 'x', point: 'a', placement: LINEAR },
    ],
  ])('reports %s at its index', (_name, bad) => {
    expect(constraintIssues([{ kind: 'fix', id: 'f', point: 'a' }, bad])).toEqual([
      constraintIssue(1),
    ]);
  });

  it('reports a duplicate constraint id at the later occurrence', () => {
    expect(
      constraintIssues([
        { kind: 'fix', id: 'f', point: 'a' },
        { kind: 'fix', id: 'f', point: 'b' },
      ]),
    ).toEqual([constraintIssue(1)]);
  });

  it('reports entity and constraint issues together', () => {
    const r = parseSketchData([P('a'), 5], [{ kind: 'fix', id: 'f', point: 'zz' }]);
    expect(r.ok ? [] : r.error).toEqual([entityIssue(1), constraintIssue(0)]);
  });
});

/**
 * Points of an open polyline a b c d e and two splines on them (both valid): a cubic control
 * point spline s through poles a b c d, a quadratic fit point spline f through c d e; lines ae,
 * bc and bd.
 */
const SPLINE_ENTITIES: readonly unknown[] = [
  P('a', 0, 0),
  P('b', 1, 2),
  P('c', 3, 2),
  P('d', 4, 0),
  P('e', 6, 1),
  { kind: 'line', id: 'ae', p1: 'a', p2: 'e' },
  { kind: 'line', id: 'bc', p1: 'b', p2: 'c' },
  { kind: 'line', id: 'bd', p1: 'b', p2: 'd' },
  { kind: 'circle', id: 'k', center: 'a', radius: 2 },
  {
    kind: 'bspline',
    id: 's',
    degree: 3,
    poles: ['a', 'b', 'c', 'd'],
    knots: [0, 0, 0, 0, 1, 1, 1, 1],
  },
  {
    kind: 'fitSpline',
    id: 'f',
    degree: 2,
    fit: ['c', 'd', 'e'],
    params: [0, 0.4, 1],
    poles: [
      [3, 2],
      [4.5, -0.5],
      [6, 1],
    ],
    knots: [0, 0, 0, 1, 1, 1],
    construction: true,
  },
];

const BSPLINE = {
  kind: 'bspline',
  id: 'x',
  degree: 3,
  poles: ['a', 'b', 'c', 'd', 'e'],
  knots: [0, 0, 0, 0, 0.5, 1, 1, 1, 1],
};
const FIT_SPLINE = {
  kind: 'fitSpline',
  id: 'x',
  degree: 1,
  fit: ['a', 'e'],
  params: [0, 1],
  poles: [
    [0, 0],
    [6, 1],
  ],
  knots: [0, 0, 1, 1],
};

/** A copy of the object without the key (a missing property, not one set to undefined). */
function without(item: Readonly<Record<string, unknown>>, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(item).filter(([k]) => k !== key));
}

function splineConstraintIssues(constraints: unknown): readonly SketchIssue[] {
  const r = parseSketchData(SPLINE_ENTITIES, constraints);
  return r.ok ? [] : r.error;
}

describe('parseSketchData – splines', () => {
  it('accepts a control point spline and a fit point spline', () => {
    expect(entityIssues(SPLINE_ENTITIES)).toEqual([]);
    expect(entityIssues([...SPLINE_ENTITIES.slice(0, 5), BSPLINE])).toEqual([]);
    expect(entityIssues([...SPLINE_ENTITIES.slice(0, 5), FIT_SPLINE])).toEqual([]);
  });

  it('accepts lower degrees and interior knots repeated up to the degree', () => {
    expect(
      entityIssues([
        ...SPLINE_ENTITIES.slice(0, 5),
        { kind: 'bspline', id: 'x1', degree: 1, poles: ['a', 'b'], knots: [0, 0, 1, 1] },
        {
          kind: 'bspline',
          id: 'x2',
          degree: 2,
          poles: ['a', 'b', 'c'],
          knots: [0, 0, 0, 1, 1, 1],
        },
        {
          kind: 'bspline',
          id: 'x3',
          degree: 3,
          poles: ['e', 'd', 'c', 'b', 'a'],
          knots: [0, 0, 0, 0, 0.5, 1, 1, 1, 1],
        },
      ]),
    ).toEqual([]);
    // Six poles of degree 3 have two interior knots: they may coincide (multiplicity 2 ≤ 3).
    expect(
      entityIssues([
        ...SPLINE_ENTITIES.slice(0, 5),
        P('g', 7, 3),
        {
          kind: 'bspline',
          id: 'x',
          degree: 3,
          poles: ['a', 'b', 'c', 'd', 'e', 'g'],
          knots: [0, 0, 0, 0, 0.5, 0.5, 1, 1, 1, 1],
        },
      ]),
    ).toEqual([]);
  });

  it.each([
    ['missing property', without(BSPLINE, 'knots')],
    ['extra property', { ...BSPLINE, params: [0, 1] }],
    ['construction false', { ...BSPLINE, construction: false }],
    [
      'degree not matching the poles',
      { ...BSPLINE, degree: 2, knots: [0, 0, 0, 0.3, 0.6, 1, 1, 1] },
    ],
    ['degree not a number', { ...BSPLINE, degree: '3' }],
    ['poles not an array', { ...BSPLINE, poles: 'abcde' }],
    ['a single pole', { ...BSPLINE, degree: 0, poles: ['a'], knots: [0, 1] }],
    ['a pole to a missing point', { ...BSPLINE, poles: ['a', 'b', 'c', 'd', 'zz'] }],
    ['a pole to a line', { ...BSPLINE, poles: ['a', 'b', 'c', 'd', 'ae'] }],
    ['a pole not a string', { ...BSPLINE, poles: ['a', 'b', 'c', 'd', 5] }],
    ['repeated poles', { ...BSPLINE, poles: ['a', 'b', 'c', 'b', 'e'] }],
    ['knots not an array', { ...BSPLINE, knots: 0 }],
    ['knots too short', { ...BSPLINE, knots: [0, 0, 0, 0, 1, 1, 1, 1] }],
    ['knots too long', { ...BSPLINE, knots: [0, 0, 0, 0, 0.3, 0.6, 1, 1, 1, 1] }],
    ['knots not clamped at 0', { ...BSPLINE, knots: [0, 0, 0, 0.1, 0.5, 1, 1, 1, 1] }],
    ['knots not clamped at 1', { ...BSPLINE, knots: [0, 0, 0, 0, 0.5, 0.9, 1, 1, 1] }],
    ['knots not starting at 0', { ...BSPLINE, knots: [-1, -1, -1, -1, 0.5, 1, 1, 1, 1] }],
    ['knots not ending at 1', { ...BSPLINE, knots: [0, 0, 0, 0, 0.5, 2, 2, 2, 2] }],
    ['an interior knot at an end', { ...BSPLINE, knots: [0, 0, 0, 0, 1, 1, 1, 1, 1] }],
    ['a non-finite knot', { ...BSPLINE, knots: [0, 0, 0, 0, Number.NaN, 1, 1, 1, 1] }],
    ['a knot not a number', { ...BSPLINE, knots: [0, 0, 0, 0, '0.5', 1, 1, 1, 1] }],
  ])('reports a control point spline with %s at its index', (_name, bad) => {
    expect(entityIssues([...SPLINE_ENTITIES.slice(0, 5), bad])).toEqual([entityIssue(5)]);
  });

  it('reports decreasing knots and an interior knot repeated more than the degree', () => {
    const points = SPLINE_ENTITIES.slice(0, 5);
    const g = P('g', 7, 3);
    const six = ['a', 'b', 'c', 'd', 'e', 'g'];
    expect(
      entityIssues([
        ...points,
        g,
        { ...BSPLINE, poles: six, knots: [0, 0, 0, 0, 0.6, 0.4, 1, 1, 1, 1] },
      ]),
    ).toEqual([entityIssue(6)]);
    // Eight poles of degree 3 have four interior knots; all four equal is multiplicity 4 > 3.
    expect(
      entityIssues([
        ...points,
        g,
        P('h', 8, 0),
        P('i', 9, 1),
        {
          ...BSPLINE,
          poles: [...six, 'h', 'i'],
          knots: [0, 0, 0, 0, 0.5, 0.5, 0.5, 0.5, 1, 1, 1, 1],
        },
      ]),
    ).toEqual([entityIssue(8)]);
  });

  it.each([
    ['missing property', without(FIT_SPLINE, 'params')],
    ['extra property', { ...FIT_SPLINE, radius: 1 }],
    ['construction false', { ...FIT_SPLINE, construction: false }],
    ['degree not matching the fit points', { ...FIT_SPLINE, degree: 2 }],
    [
      'a single fit point',
      { ...FIT_SPLINE, degree: 0, fit: ['a'], params: [0], poles: [[0, 0]], knots: [0, 1] },
    ],
    ['a fit point to a missing point', { ...FIT_SPLINE, fit: ['a', 'zz'] }],
    ['a fit point to a line', { ...FIT_SPLINE, fit: ['a', 'ae'] }],
    ['repeated fit points', { ...FIT_SPLINE, fit: ['a', 'a'] }],
    ['params of a wrong length', { ...FIT_SPLINE, params: [0, 0.5, 1] }],
    ['params not starting at 0', { ...FIT_SPLINE, params: [0.1, 1] }],
    ['params not ending at 1', { ...FIT_SPLINE, params: [0, 0.9] }],
    ['a non-finite param', { ...FIT_SPLINE, params: [0, Infinity] }],
    [
      'poles of a wrong length',
      {
        ...FIT_SPLINE,
        poles: [
          [0, 0],
          [3, 0],
          [6, 1],
        ],
      },
    ],
    ['a pole not a pair', { ...FIT_SPLINE, poles: [[0, 0], [6]] }],
    [
      'a pole with three coordinates',
      {
        ...FIT_SPLINE,
        poles: [
          [0, 0],
          [6, 1, 0],
        ],
      },
    ],
    ['a pole not an array', { ...FIT_SPLINE, poles: [[0, 0], 'e'] }],
    [
      'a non-finite pole coordinate',
      {
        ...FIT_SPLINE,
        poles: [
          [0, 0],
          [Number.NaN, 1],
        ],
      },
    ],
    ['knots of a wrong length', { ...FIT_SPLINE, knots: [0, 0, 0.5, 1, 1] }],
    ['knots not clamped', { ...FIT_SPLINE, knots: [0, 0.5, 1, 1] }],
  ])('reports a fit point spline with %s at its index', (_name, bad) => {
    expect(entityIssues([...SPLINE_ENTITIES.slice(0, 5), bad])).toEqual([entityIssue(5)]);
  });

  it('reports params that do not increase', () => {
    const fit = {
      kind: 'fitSpline',
      id: 'x',
      degree: 2,
      fit: ['a', 'b', 'c'],
      poles: [
        [0, 0],
        [1, 3],
        [3, 2],
      ],
      knots: [0, 0, 0, 1, 1, 1],
    };
    const points = SPLINE_ENTITIES.slice(0, 5);
    expect(entityIssues([...points, { ...fit, params: [0, 0.5, 1] }])).toEqual([]);
    expect(entityIssues([...points, { ...fit, params: [0, 0, 1] }])).toEqual([entityIssue(5)]);
    expect(entityIssues([...points, { ...fit, params: [0, 1, 1] }])).toEqual([entityIssue(5)]);
    expect(entityIssues([...points, { ...fit, params: [0, 1.2, 1] }])).toEqual([entityIssue(5)]);
  });

  it('accepts tangent between a line and a spline sharing an end point, in either order', () => {
    expect(
      splineConstraintIssues([
        // ae shares a with the first pole of s, e with the last fit point of f.
        { kind: 'tangent', id: 't1', a: 'ae', b: 's' },
        { kind: 'tangent', id: 't2', a: 'f', b: 'ae' },
        { kind: 'coincident', id: 't3', a: 'a', b: 'd' },
      ]),
    ).toEqual([]);
  });

  it('accepts pointOnCurve of a point that is not a point of the spline', () => {
    expect(
      splineConstraintIssues([
        { kind: 'pointOnCurve', id: 'o1', point: 'e', curve: 's' },
        { kind: 'pointOnCurve', id: 'o2', point: 'a', curve: 'f' },
      ]),
    ).toEqual([]);
  });

  it.each([
    ['pointOnCurve of an end pole', { kind: 'pointOnCurve', id: 'x', point: 'a', curve: 's' }],
    ['pointOnCurve of an interior pole', { kind: 'pointOnCurve', id: 'x', point: 'b', curve: 's' }],
    ['pointOnCurve of a fit point', { kind: 'pointOnCurve', id: 'x', point: 'd', curve: 'f' }],
    [
      'pointOnCurve of a spline on a spline',
      { kind: 'pointOnCurve', id: 'x', point: 'f', curve: 's' },
    ],
  ])('reports %s', (_name, bad) => {
    expect(splineConstraintIssues([{ kind: 'fix', id: 'g', point: 'a' }, bad])).toEqual([
      constraintIssue(1),
    ]);
  });

  it.each([
    // bc shares b and c with s only at interior poles; bd shares d with f at its middle fit point.
    ['tangent with a line not at an end', { kind: 'tangent', id: 'x', a: 'bc', b: 's' }],
    ['tangent with a line at the fit spline middle', { kind: 'tangent', id: 'x', a: 'f', b: 'bd' }],
    ['tangent spline–circle', { kind: 'tangent', id: 'x', a: 's', b: 'k' }],
    ['tangent spline–spline', { kind: 'tangent', id: 'x', a: 's', b: 'f' }],
    ['equal two splines', { kind: 'equal', id: 'x', a: 's', b: 'f' }],
    ['equal line and spline', { kind: 'equal', id: 'x', a: 'ae', b: 's' }],
    ['parallel with a spline', { kind: 'parallel', id: 'x', a: 'ae', b: 's' }],
    ['horizontal on a spline', { kind: 'horizontal', id: 'x', line: 's' }],
    ['radius on a spline', { kind: 'radius', id: 'x', curve: 'f', value: 1 }],
    ['coincident with a spline', { kind: 'coincident', id: 'x', a: 'a', b: 's' }],
  ])('reports %s', (_name, bad) => {
    expect(splineConstraintIssues([{ kind: 'fix', id: 'g', point: 'a' }, bad])).toEqual([
      constraintIssue(1),
    ]);
  });
});

describe('parseSketchData – infinite line (xline, M31)', () => {
  /** The square points, xline x through a and c, line ab, circle k, arc q, spline s from a. */
  const XLINE_ENTITIES: readonly unknown[] = [
    ...ENTITIES,
    P('e', 5, 3),
    { kind: 'xline', id: 'x', p1: 'a', p2: 'c', construction: true },
    { kind: 'xline', id: 'y', p1: 'b', p2: 'd', construction: true },
    { kind: 'bspline', id: 's', degree: 1, poles: ['a', 'e'], knots: [0, 0, 1, 1] },
  ];

  function xlineConstraintIssues(constraints: unknown): readonly SketchIssue[] {
    const r = parseSketchData(XLINE_ENTITIES, constraints);
    return r.ok ? [] : r.error;
  }

  it('accepts an xline through two distinct points', () => {
    expect(entityIssues(XLINE_ENTITIES)).toEqual([]);
  });

  it.each([
    ['without construction', { kind: 'xline', id: 'x', p1: 'a', p2: 'b' }],
    ['with construction false', { kind: 'xline', id: 'x', p1: 'a', p2: 'b', construction: false }],
    ['with p1 = p2', { kind: 'xline', id: 'x', p1: 'a', p2: 'a', construction: true }],
    ['with a missing point', { kind: 'xline', id: 'x', p1: 'a', p2: 'z', construction: true }],
    ['with a non-point p2', { kind: 'xline', id: 'x', p1: 'a', p2: 'k', construction: true }],
    [
      'with an extra field',
      { kind: 'xline', id: 'x', p1: 'a', p2: 'b', construction: true, radius: 1 },
    ],
  ])('reports an xline %s', (_name, bad) => {
    expect(
      entityIssues([P('a'), P('b', 1), { kind: 'circle', id: 'k', center: 'a', radius: 1 }, bad]),
    ).toEqual([entityIssue(3)]);
  });

  it('accepts the constraints that take a line as a carrier line on an xline', () => {
    expect(
      xlineConstraintIssues([
        { kind: 'horizontal', id: 'c1', line: 'x' },
        { kind: 'vertical', id: 'c2', line: 'x' },
        { kind: 'parallel', id: 'c3', a: 'x', b: 'ab' },
        { kind: 'parallel', id: 'c4', a: 'x', b: 'y' },
        { kind: 'perpendicular', id: 'c5', a: 'ab', b: 'x' },
        { kind: 'angle', id: 'c6', a: 'x', b: 'ab', value: 1 },
        { kind: 'pointLineDistance', id: 'c7', point: 'e', line: 'x', value: 1 },
        { kind: 'pointOnCurve', id: 'c8', point: 'e', curve: 'x' },
        { kind: 'tangent', id: 'c9', a: 'x', b: 'k' },
        { kind: 'tangent', id: 'c10', a: 'q', b: 'x' },
      ]),
    ).toEqual([]);
  });

  it.each([
    ['midpoint', { kind: 'midpoint', id: 'z', point: 'e', line: 'x' }],
    ['equal of two xlines', { kind: 'equal', id: 'z', a: 'x', b: 'y' }],
    ['equal of an xline and a line', { kind: 'equal', id: 'z', a: 'x', b: 'ab' }],
    // x shares a with the first pole of s: allowed for a line, not for an xline.
    ['tangent with a spline', { kind: 'tangent', id: 'z', a: 'x', b: 's' }],
    ['tangent of two xlines', { kind: 'tangent', id: 'z', a: 'x', b: 'y' }],
    ['pointOnCurve of its own point', { kind: 'pointOnCurve', id: 'z', point: 'a', curve: 'x' }],
    [
      'pointLineDistance of its own point',
      { kind: 'pointLineDistance', id: 'z', point: 'c', line: 'x', value: 1 },
    ],
    ['radius', { kind: 'radius', id: 'z', curve: 'x', value: 1 }],
    ['coincident', { kind: 'coincident', id: 'z', a: 'e', b: 'x' }],
  ])('reports %s on an xline', (_name, bad) => {
    expect(xlineConstraintIssues([{ kind: 'fix', id: 'g', point: 'a' }, bad])).toEqual([
      constraintIssue(1),
    ]);
  });
});

describe('parseSketchData – mirror and patterns (M36)', () => {
  const DIR = { angle: 0, count: 3, spacing: 5 };
  const MIRROR = { kind: 'mirror', id: 'm', sources: ['ab', 'k'], axis: 'bc' };
  const LINEAR = { kind: 'linearPattern', id: 'lp', sources: ['ab', 'c'], direction1: DIR };
  const CIRCULAR = {
    kind: 'circularPattern',
    id: 'cp',
    sources: ['q', 'ab'],
    center: 'c',
    count: 4,
    angle: 2 * Math.PI,
  };

  it('accepts a mirror, a linear pattern with one and two directions and a circular pattern', () => {
    expect(
      entityIssues([
        ...ENTITIES,
        MIRROR,
        LINEAR,
        {
          ...LINEAR,
          id: 'lp2',
          direction2: { angle: -7, count: 100, spacing: 0.1 },
        },
        CIRCULAR,
        { ...CIRCULAR, id: 'cp2', angle: -Math.PI / 3, count: 2 },
        // A source in more patterns, a pattern before its sources.
        { ...MIRROR, id: 'm2', sources: ['ab'] },
      ]),
    ).toEqual([]);
    expect(entityIssues([{ ...MIRROR, sources: ['ab'] }, ...ENTITIES])).toEqual([]);
  });

  it('accepts a full circle within 1e-9', () => {
    expect(entityIssues([...ENTITIES, { ...CIRCULAR, angle: 2 * Math.PI + 5e-10 }])).toEqual([]);
  });

  it.each([
    ['mirror with construction', { ...MIRROR, construction: true }],
    ['mirror without sources', { kind: 'mirror', id: 'm', axis: 'bc' }],
    ['mirror with an extra property', { ...MIRROR, count: 2 }],
    ['sources not an array', { ...MIRROR, sources: 'ab' }],
    ['empty sources', { ...MIRROR, sources: [] }],
    ['duplicate source', { ...MIRROR, sources: ['ab', 'ab'] }],
    ['missing source', { ...MIRROR, sources: ['zz'] }],
    ['source not a string', { ...MIRROR, sources: [1] }],
    ['source is a pattern', { ...MIRROR, sources: ['lp'] }],
    ['source is the pattern itself', { ...MIRROR, sources: ['m'] }],
    ['source is the axis', { ...MIRROR, sources: ['ab', 'bc'] }],
    ['axis is a point', { ...MIRROR, axis: 'a' }],
    ['axis is a circle', { ...MIRROR, axis: 'k' }],
    ['axis missing', { ...MIRROR, axis: 'zz' }],
    ['pattern id with a colon', { ...MIRROR, id: 'm:1' }],
    ['pattern id with a comma', { ...MIRROR, id: 'm,1' }],
    ['linear without direction1', { kind: 'linearPattern', id: 'lp', sources: ['ab'] }],
    ['direction not an object', { ...LINEAR, direction1: 3 }],
    ['direction with an extra property', { ...LINEAR, direction1: { ...DIR, x: 1 } }],
    ['direction without spacing', { ...LINEAR, direction1: { angle: 0, count: 2 } }],
    ['count 1', { ...LINEAR, direction1: { ...DIR, count: 1 } }],
    ['count above the maximum', { ...LINEAR, direction1: { ...DIR, count: 101 } }],
    ['count not an integer', { ...LINEAR, direction1: { ...DIR, count: 2.5 } }],
    ['spacing zero', { ...LINEAR, direction1: { ...DIR, spacing: 0 } }],
    ['spacing negative', { ...LINEAR, direction1: { ...DIR, spacing: -1 } }],
    ['spacing infinite', { ...LINEAR, direction1: { ...DIR, spacing: Infinity } }],
    ['direction angle NaN', { ...LINEAR, direction1: { ...DIR, angle: Number.NaN } }],
    ['invalid direction2', { ...LINEAR, direction2: { ...DIR, count: 0 } }],
    ['direction2 undefined', { ...LINEAR, direction2: undefined }],
    ['circular center is a line', { ...CIRCULAR, center: 'ab' }],
    ['circular center missing', { ...CIRCULAR, center: 'zz' }],
    ['circular center is a source', { ...CIRCULAR, sources: ['ab', 'c'] }],
    ['circular count 1', { ...CIRCULAR, count: 1 }],
    ['circular count 101', { ...CIRCULAR, count: 101 }],
    ['circular count not an integer', { ...CIRCULAR, count: 3.2 }],
    ['circular angle zero', { ...CIRCULAR, angle: 0 }],
    ['circular angle above 2π', { ...CIRCULAR, angle: 2 * Math.PI + 1e-6 }],
    ['circular angle below −2π', { ...CIRCULAR, angle: -7 }],
    ['circular angle infinite', { ...CIRCULAR, angle: Infinity }],
  ])('reports %s at its index', (_name, bad) => {
    expect(entityIssues([...ENTITIES, LINEAR, bad])).toEqual([entityIssue(ENTITIES.length + 1)]);
  });

  it('reports a pattern whose source id has a colon or a comma', () => {
    const entities = [P('x:1'), P('y,1'), ...ENTITIES];
    expect(
      entityIssues([
        ...entities,
        { ...MIRROR, sources: ['x:1'] },
        { ...LINEAR, id: 'lp', sources: ['y,1'] },
      ]),
    ).toEqual([entityIssue(entities.length), entityIssue(entities.length + 1)]);
  });

  it.each([
    ['a constraint on a pattern', { kind: 'horizontal', id: 'x', line: 'm' }],
    ['an equal of two patterns', { kind: 'equal', id: 'x', a: 'm', b: 'lp' }],
    ['a fix of a pattern', { kind: 'fix', id: 'x', point: 'cp' }],
    ['a pointOnCurve on a pattern', { kind: 'pointOnCurve', id: 'x', point: 'a', curve: 'm' }],
    ['a radius of a pattern', { kind: 'radius', id: 'x', curve: 'cp', value: 1 }],
  ])('reports %s', (_name, bad) => {
    const r = parseSketchData([...ENTITIES, MIRROR, LINEAR, CIRCULAR], [bad]);
    expect(r.ok ? [] : r.error).toEqual([constraintIssue(0)]);
  });
});

describe('parseSketchData – symmetric (M36)', () => {
  it('accepts two points symmetric across a line', () => {
    // c and d are not points of ab.
    expect(constraintIssues([{ kind: 'symmetric', id: 'x', a: 'c', b: 'd', axis: 'ab' }])).toEqual(
      [],
    );
  });

  it.each([
    ['a = b', { kind: 'symmetric', id: 'x', a: 'c', b: 'c', axis: 'ab' }],
    ['a point of the axis as a', { kind: 'symmetric', id: 'x', a: 'a', b: 'd', axis: 'ab' }],
    ['a point of the axis as b', { kind: 'symmetric', id: 'x', a: 'c', b: 'b', axis: 'ab' }],
    ['axis a circle', { kind: 'symmetric', id: 'x', a: 'c', b: 'd', axis: 'k' }],
    ['axis a point', { kind: 'symmetric', id: 'x', a: 'c', b: 'd', axis: 'a' }],
    ['a a line', { kind: 'symmetric', id: 'x', a: 'bc', b: 'd', axis: 'ab' }],
    ['b missing', { kind: 'symmetric', id: 'x', a: 'c', b: 'zz', axis: 'ab' }],
    ['no axis', { kind: 'symmetric', id: 'x', a: 'c', b: 'd' }],
    ['a value', { kind: 'symmetric', id: 'x', a: 'c', b: 'd', axis: 'ab', value: 1 }],
  ])('reports %s', (_name, bad) => {
    expect(constraintIssues([{ kind: 'fix', id: 'f', point: 'a' }, bad])).toEqual([
      constraintIssue(1),
    ]);
  });
});

describe('parseSketchData – text (M37)', () => {
  /** A closed square loop of character `char` (code `code`) from x0, side 1, made of lines. */
  const square = (char: number, code: number, x0 = 0) => ({
    char,
    code,
    segments: [
      [
        [x0, 0],
        [x0 + 1, 0],
      ],
      [
        [x0 + 1, 0],
        [x0 + 1, 1],
      ],
      [
        [x0 + 1, 1],
        [x0, 1],
      ],
      [
        [x0, 1],
        [x0, 0],
      ],
    ],
  });
  /** A loop of one quadratic and one cubic Bézier segment. */
  const curved = (char: number, code: number) => ({
    char,
    code,
    segments: [
      [
        [0, 0],
        [1, 2],
        [2, 0],
      ],
      [
        [2, 0],
        [2, -1],
        [0, -1],
        [0, 0],
      ],
    ],
  });
  const TEXT = {
    kind: 'text',
    id: 't',
    text: 'a b',
    font: 'sans',
    height: 10,
    baseline: 'ab',
    // 'a' has two loops, the space none, 'b' one curved loop.
    contours: [square(0, 97), square(0, 97, 3), curved(2, 98)],
  };
  const withContour = (contour: unknown) => ({ ...TEXT, contours: [contour] });
  const segmentsOf = (...segments: unknown[]) => withContour({ char: 0, code: 97, segments });

  it('accepts a text, a construction text and every font', () => {
    expect(
      entityIssues([
        ...ENTITIES,
        TEXT,
        { ...TEXT, id: 't2', construction: true },
        { ...TEXT, id: 't3', font: 'serif' },
        { ...TEXT, id: 't4', font: 'mono', baseline: 'bc' },
      ]),
    ).toEqual([]);
  });

  it('accepts a text without contours, before its baseline', () => {
    expect(entityIssues([{ ...TEXT, text: '   ', contours: [] }, ...ENTITIES])).toEqual([]);
  });

  it('counts the length in code points, not UTF-16 units', () => {
    // 200 astral code points are 400 UTF-16 units.
    const astral = '😀'.repeat(200);
    expect(entityIssues([...ENTITIES, { ...TEXT, text: astral, contours: [] }])).toEqual([]);
    const contour = { ...square(1, 'ž'.codePointAt(0) ?? 0) };
    expect(entityIssues([...ENTITIES, { ...TEXT, text: '😀ž', contours: [contour] }])).toEqual([]);
  });

  it('accepts continuity and closure within 1e-9 relative to the coordinates', () => {
    const far = 1e6;
    const loop = {
      char: 0,
      code: 97,
      segments: [
        [
          [far, 0],
          [far + 1, 0],
        ],
        [
          [far + 1 + 1e-4, 0],
          [far, 1],
        ],
        [
          [far, 1],
          [far + 5e-4, 0],
        ],
      ],
    };
    expect(entityIssues([...ENTITIES, withContour(loop)])).toEqual([]);
  });

  it.each([
    ['text with an extra property', { ...TEXT, size: 1 }],
    [
      'text without contours',
      { kind: 'text', id: 't', text: 'a', font: 'sans', height: 1, baseline: 'ab' },
    ],
    ['construction false', { ...TEXT, construction: false }],
    ['id with a colon', { ...TEXT, id: 't:1' }],
    ['id with a comma', { ...TEXT, id: 't,1' }],
    ['empty string', { ...TEXT, text: '', contours: [] }],
    ['string not a string', { ...TEXT, text: 5, contours: [] }],
    ['string too long', { ...TEXT, text: 'x'.repeat(201), contours: [] }],
    ['a line break', { ...TEXT, text: 'a\nb', contours: [] }],
    ['a tab', { ...TEXT, text: 'a\tb', contours: [] }],
    ['a DEL character', { ...TEXT, text: 'a\u007f', contours: [] }],
    ['unknown font', { ...TEXT, font: 'comic' }],
    ['height zero', { ...TEXT, height: 0 }],
    ['height negative', { ...TEXT, height: -1 }],
    ['height infinite', { ...TEXT, height: Infinity }],
    ['height NaN', { ...TEXT, height: Number.NaN }],
    ['baseline a circle', { ...TEXT, baseline: 'k' }],
    ['baseline a point', { ...TEXT, baseline: 'a' }],
    ['baseline missing', { ...TEXT, baseline: 'zz' }],
    ['contours not an array', { ...TEXT, contours: {} }],
    ['contour not an object', withContour([])],
    ['contour with an extra property', withContour({ ...square(0, 97), x: 1 })],
    ['contour without segments', withContour({ char: 0, code: 97 })],
    ['char out of range', withContour(square(3, 97))],
    ['char negative', withContour(square(-1, 97))],
    ['char not an integer', withContour(square(0.5, 97))],
    ['code of another character', withContour(square(0, 98))],
    // UTF-16 index 2 would be 'a'; in code points the text has only 2 characters.
    ['char in UTF-16 units', { ...TEXT, text: '😀a', contours: [square(2, 97)] }],
    ['no segments', segmentsOf()],
    ['segments not an array', withContour({ char: 0, code: 97, segments: 'x' })],
    [
      'a segment of one pole',
      segmentsOf(
        [[0, 0]],
        [
          [0, 0],
          [0, 0],
        ],
      ),
    ],
    [
      'a segment of five poles',
      segmentsOf([
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
        [0, 0],
      ]),
    ],
    [
      'a pole not a pair',
      segmentsOf(
        [
          [0, 0, 0],
          [1, 0],
        ],
        [
          [1, 0],
          [0, 0, 0],
        ],
      ),
    ],
    [
      'a pole not finite',
      segmentsOf(
        [
          [0, 0],
          [Number.NaN, 0],
        ],
        [
          [Number.NaN, 0],
          [0, 0],
        ],
      ),
    ],
    [
      'an open loop',
      segmentsOf(
        [
          [0, 0],
          [1, 0],
        ],
        [
          [1, 0],
          [1, 1],
        ],
      ),
    ],
    [
      'segments that do not join',
      segmentsOf(
        [
          [0, 0],
          [1, 0],
        ],
        [
          [1, 1e-6],
          [0, 0],
        ],
      ),
    ],
  ])('reports %s at its index', (_name, bad) => {
    expect(entityIssues([...ENTITIES, TEXT, bad])).toEqual([entityIssue(ENTITIES.length + 1)]);
  });

  it('reports a text as a pattern source', () => {
    expect(
      entityIssues([...ENTITIES, TEXT, { kind: 'mirror', id: 'm', sources: ['t'], axis: 'ab' }]),
    ).toEqual([entityIssue(ENTITIES.length + 1)]);
  });

  it.each([
    ['a horizontal of a text', { kind: 'horizontal', id: 'x', line: 't' }],
    ['an equal of a line and a text', { kind: 'equal', id: 'x', a: 'ab', b: 't' }],
    ['a pointOnCurve on a text', { kind: 'pointOnCurve', id: 'x', point: 'c', curve: 't' }],
    ['a fix of a text', { kind: 'fix', id: 'x', point: 't' }],
    ['a radius of a text', { kind: 'radius', id: 'x', curve: 't', value: 1 }],
  ])('reports %s', (_name, bad) => {
    const r = parseSketchData([...ENTITIES, TEXT], [bad]);
    expect(r.ok ? [] : r.error).toEqual([constraintIssue(0)]);
  });

  it('accepts constraints on the baseline of a text', () => {
    const r = parseSketchData([...ENTITIES, TEXT], [{ kind: 'horizontal', id: 'x', line: 'ab' }]);
    expect(r.ok).toBe(true);
  });
});
