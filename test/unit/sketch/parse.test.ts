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
    ['unknown kind', { kind: 'symmetric', id: 'x', a: 'a', b: 'b' }],
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
