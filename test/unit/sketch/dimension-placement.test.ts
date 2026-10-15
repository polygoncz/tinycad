import { assert, describe, expect, it } from 'vitest';
import type { Vec2 } from '@/core';
import {
  defaultPlacement,
  dimensionTarget,
  movePlacement,
  placeDimension,
} from '@/sketch/dimension-placement';
import type { DimensionTarget } from '@/sketch/dimension-placement';
import type { DimensionConstraint, SketchData, SketchEntity, SketchEntityId } from '@/sketch/model';
import { parseSketchData } from '@/sketch/parse';

function sketch(entities: readonly unknown[], constraints: readonly unknown[] = []): SketchData {
  const r = parseSketchData(entities, constraints);
  if (!r.ok) throw new Error(`invalid test sketch: ${JSON.stringify(r.error)}`);
  return r.value;
}

/**
 * ab horizontal (0,0)→(10,0); ef slanted (20,0)→(26,8), length 10; gh vertical (40,0)→(40,10);
 * a lone point z (5,5), a2 at a, y0 on the line of ab; circle k (r 3) around o (100,0); arc q
 * around o2 (200,0) from s (204,0) to t (200,4), r 4; arc q2 around o2 from s2 (196,0) to
 * s3 (200,−4); lines la (300,0)→(310,0) and lb (315,−5)→(325,5) meet at (320,0) at π/4;
 * lp (300,10)→(310,10) is parallel to la.
 */
const DATA = sketch([
  { kind: 'point', id: 'a', x: 0, y: 0 },
  { kind: 'point', id: 'b', x: 10, y: 0 },
  { kind: 'line', id: 'ab', p1: 'a', p2: 'b' },
  { kind: 'point', id: 'e', x: 20, y: 0 },
  { kind: 'point', id: 'f', x: 26, y: 8 },
  { kind: 'line', id: 'ef', p1: 'e', p2: 'f' },
  { kind: 'point', id: 'g', x: 40, y: 0 },
  { kind: 'point', id: 'h', x: 40, y: 10 },
  { kind: 'line', id: 'gh', p1: 'g', p2: 'h' },
  { kind: 'point', id: 'z', x: 5, y: 5 },
  { kind: 'point', id: 'a2', x: 0, y: 0 },
  { kind: 'point', id: 'y0', x: 15, y: 0 },
  { kind: 'point', id: 'o', x: 100, y: 0 },
  { kind: 'circle', id: 'k', center: 'o', radius: 3 },
  { kind: 'point', id: 'o2', x: 200, y: 0 },
  { kind: 'point', id: 's', x: 204, y: 0 },
  { kind: 'point', id: 't', x: 200, y: 4 },
  { kind: 'arc', id: 'q', center: 'o2', start: 's', end: 't' },
  { kind: 'point', id: 's2', x: 196, y: 0 },
  { kind: 'point', id: 's3', x: 200, y: -4 },
  { kind: 'arc', id: 'q2', center: 'o2', start: 's2', end: 's3' },
  { kind: 'point', id: 'l1', x: 300, y: 0 },
  { kind: 'point', id: 'l2', x: 310, y: 0 },
  { kind: 'line', id: 'la', p1: 'l1', p2: 'l2' },
  { kind: 'point', id: 'l3', x: 315, y: -5 },
  { kind: 'point', id: 'l4', x: 325, y: 5 },
  { kind: 'line', id: 'lb', p1: 'l3', p2: 'l4' },
  { kind: 'point', id: 'l5', x: 300, y: 10 },
  { kind: 'point', id: 'l6', x: 310, y: 10 },
  { kind: 'line', id: 'lp', p1: 'l5', p2: 'l6' },
]);

function entity(name: string): SketchEntity {
  const found = DATA.entities.find((x) => x.id === name);
  if (found === undefined) throw new Error(`no entity ${name}`);
  return found;
}
const e = (...names: string[]): SketchEntity[] => names.map(entity);
const id = (name: string): SketchEntityId => entity(name).id;

/** A dimension of the test data (parsed, so the ids are branded). */
function dim(c: Record<string, unknown>): DimensionConstraint {
  const parsed = sketch(DATA.entities, [{ id: 'dim', ...c }]).constraints[0];
  if (parsed === undefined || !('value' in parsed)) throw new Error('not a dimension');
  return parsed;
}

const close = (n: number): unknown => expect.closeTo(n, 9);

/** The vertex of la and lb. */
const X: Vec2 = [320, 0];
const at = (dx: number, dy: number): Vec2 => [X[0] + dx, X[1] + dy];
/** The angle between the ray (±1, 0) and the cursor direction (±5, ±1). */
const SMALL = Math.atan2(1, 5);

describe('dimensionTarget', () => {
  it.each<[string, string[], DimensionTarget | null]>([
    ['1 line → its points', ['ef'], { kind: 'points', a: id('e'), b: id('f') }],
    ['2 points in selection order', ['z', 'a'], { kind: 'points', a: id('z'), b: id('a') }],
    ['point + line', ['z', 'ab'], { kind: 'pointLine', point: id('z'), line: id('ab') }],
    ['line + point', ['ab', 'z'], { kind: 'pointLine', point: id('z'), line: id('ab') }],
    ['point that is an end of the line', ['a', 'ab'], null],
    ['line + its end point', ['ab', 'b'], null],
    ['2 lines in selection order', ['lb', 'la'], { kind: 'lines', a: id('lb'), b: id('la') }],
    ['2 parallel lines', ['la', 'lp'], { kind: 'lines', a: id('la'), b: id('lp') }],
    ['1 circle', ['k'], { kind: 'round', curve: id('k') }],
    ['1 arc', ['q'], { kind: 'round', curve: id('q') }],
    ['nothing', [], null],
    ['1 point', ['z'], null],
    ['circle + point', ['k', 'z'], null],
    ['line + circle', ['ab', 'k'], null],
    ['2 circles', ['k', 'q'], null],
    ['3 points', ['a', 'b', 'z'], null],
  ])('%s', (_, names, expected) => {
    expect(dimensionTarget(e(...names))).toEqual(expected);
  });
});

describe('placeDimension', () => {
  const points = (a: string, b: string): DimensionTarget => ({
    kind: 'points',
    a: id(a),
    b: id(b),
  });

  it.each<[string, DimensionTarget, Vec2, unknown]>([
    [
      'slanted line, cursor in the band → aligned distance',
      points('e', 'f'),
      [22, 6],
      { kind: 'distance', a: 'e', b: 'f', value: close(10), placement: lin(2, 1) },
    ],
    [
      'slanted line, cursor above → horizontal',
      points('e', 'f'),
      [23, 20],
      { kind: 'hDistance', a: 'e', b: 'f', value: close(6), placement: lin(16, 0) },
    ],
    [
      'slanted line, cursor below → horizontal',
      points('e', 'f'),
      [23, -20],
      { kind: 'hDistance', a: 'e', b: 'f', value: close(6), placement: lin(-24, 0) },
    ],
    [
      'slanted line, cursor beside → vertical',
      points('e', 'f'),
      [40, 5],
      { kind: 'vDistance', a: 'e', b: 'f', value: close(8), placement: lin(-17, 1) },
    ],
    [
      'horizontal line, cursor in the band → horizontal, no aligned',
      points('a', 'b'),
      [6, 3],
      { kind: 'hDistance', a: 'a', b: 'b', value: close(10), placement: lin(3, 1) },
    ],
    [
      'vertical line, cursor in the band → vertical, no aligned',
      points('g', 'h'),
      [45, 6],
      { kind: 'vDistance', a: 'g', b: 'h', value: close(10), placement: lin(-5, 1) },
    ],
    [
      'horizontal line, cursor beside → the other axis (horizontal), not zero vertical',
      points('a', 'b'),
      [20, 1],
      { kind: 'hDistance', a: 'a', b: 'b', value: close(10), placement: lin(1, 15) },
    ],
    [
      'vertical line, cursor above → the other axis (vertical), not zero horizontal',
      points('g', 'h'),
      [41, 20],
      { kind: 'vDistance', a: 'g', b: 'h', value: close(10), placement: lin(-1, 15) },
    ],
    [
      'two points in selection order',
      points('z', 'a'),
      [2.5, 2.5],
      { kind: 'distance', a: 'z', b: 'a', value: close(Math.hypot(5, 5)), placement: lin(0, 0) },
    ],
    [
      'point and line → distance to the line',
      { kind: 'pointLine', point: id('z'), line: id('ab') },
      [8, 3],
      {
        kind: 'pointLineDistance',
        point: 'z',
        line: 'ab',
        value: close(5),
        placement: lin(-3, 0.5),
      },
    ],
    [
      'inside a circle → radius',
      { kind: 'round', curve: id('k') },
      [101, 1],
      { kind: 'radius', curve: 'k', value: close(3), placement: rad(Math.PI / 4, Math.SQRT2) },
    ],
    [
      'outside a circle → diameter',
      { kind: 'round', curve: id('k') },
      [100, -5],
      { kind: 'diameter', curve: 'k', value: close(6), placement: rad(-Math.PI / 2, 5) },
    ],
    [
      'inside an arc → radius',
      { kind: 'round', curve: id('q') },
      [200, 2],
      { kind: 'radius', curve: 'q', value: close(4), placement: rad(Math.PI / 2, 2) },
    ],
    [
      'outside an arc → diameter',
      { kind: 'round', curve: id('q') },
      [210, 0],
      { kind: 'diameter', curve: 'q', value: close(8), placement: rad(0, 10) },
    ],
    [
      'angle, quadrant of both directions',
      { kind: 'lines', a: id('la'), b: id('lb') },
      at(5, 1),
      {
        kind: 'angle',
        a: 'la',
        b: 'lb',
        value: close(Math.PI / 4),
        placement: ang(Math.hypot(5, 1), SMALL / (Math.PI / 4)),
      },
    ],
    [
      'angle, a reversed',
      { kind: 'lines', a: id('la'), b: id('lb') },
      at(-5, 1),
      {
        kind: 'angle',
        a: 'la',
        b: 'lb',
        value: close((3 * Math.PI) / 4),
        reverseA: true,
        placement: ang(Math.hypot(5, 1), SMALL / ((3 * Math.PI) / 4)),
      },
    ],
    [
      'angle, both reversed',
      { kind: 'lines', a: id('la'), b: id('lb') },
      at(-5, -1),
      {
        kind: 'angle',
        a: 'la',
        b: 'lb',
        value: close(Math.PI / 4),
        reverseA: true,
        reverseB: true,
        placement: ang(Math.hypot(5, 1), SMALL / (Math.PI / 4)),
      },
    ],
    [
      'angle, b reversed',
      { kind: 'lines', a: id('la'), b: id('lb') },
      at(5, -1),
      {
        kind: 'angle',
        a: 'la',
        b: 'lb',
        value: close((3 * Math.PI) / 4),
        reverseB: true,
        placement: ang(Math.hypot(5, 1), SMALL / ((3 * Math.PI) / 4)),
      },
    ],
    [
      'angle, t measured from line a towards line b (selection order b, a)',
      { kind: 'lines', a: id('lb'), b: id('la') },
      at(5, 1),
      {
        kind: 'angle',
        a: 'lb',
        b: 'la',
        value: close(Math.PI / 4),
        placement: ang(Math.hypot(5, 1), (Math.PI / 4 - SMALL) / (Math.PI / 4)),
      },
    ],
  ])('%s', (_, target, cursor, expected) => {
    expect(placeDimension(target, cursor, DATA)).toEqual(expected);
  });

  it.each<[string, DimensionTarget, Vec2]>([
    ['coincident points', points('a', 'a2'), [3, 4]],
    [
      'point on the line of the line',
      { kind: 'pointLine', point: id('y0'), line: id('ab') },
      [15, 3],
    ],
    ['cursor at the circle centre', { kind: 'round', curve: id('k') }, [100, 0]],
    ['parallel lines', { kind: 'lines', a: id('la'), b: id('lp') }, [305, 5]],
    ['cursor at the vertex', { kind: 'lines', a: id('la'), b: id('lb') }, X],
  ])('degenerate: %s → null', (_, target, cursor) => {
    expect(placeDimension(target, cursor, DATA)).toBeNull();
  });
});

describe('movePlacement', () => {
  it.each<[string, Record<string, unknown>, Vec2, unknown]>([
    ['distance', { kind: 'distance', a: 'e', b: 'f', value: 10 }, [22, 6], lin(2, 1)],
    [
      'distance with a placement keeps only the cursor',
      {
        kind: 'distance',
        a: 'e',
        b: 'f',
        value: 10,
        placement: { kind: 'linear', offset: 7, along: 7 },
      },
      [23, 20],
      lin(16 * 0.6, 16 * 0.8),
    ],
    [
      'zero-length distance uses u = (1, 0)',
      { kind: 'distance', a: 'a', b: 'a2', value: 1 },
      [3, 4],
      lin(4, 3),
    ],
    [
      'hDistance stays horizontal in the band',
      { kind: 'hDistance', a: 'e', b: 'f', value: 6 },
      [22, 6],
      lin(2, -1),
    ],
    ['vDistance', { kind: 'vDistance', a: 'e', b: 'f', value: 8 }, [23, 20], lin(0, 16)],
    [
      'pointLineDistance',
      { kind: 'pointLineDistance', point: 'z', line: 'ab', value: 5 },
      [8, 3],
      lin(-3, 0.5),
    ],
    [
      'point on the line of the line: zero-length AB uses u = (1, 0)',
      { kind: 'pointLineDistance', point: 'y0', line: 'ab', value: 1 },
      [16, 3],
      lin(3, 1),
    ],
    [
      'radius stays radius outside',
      { kind: 'radius', curve: 'k', value: 3 },
      [100, -5],
      rad(-Math.PI / 2, 5),
    ],
    [
      'diameter stays diameter inside',
      { kind: 'diameter', curve: 'k', value: 6 },
      [101, 1],
      rad(Math.PI / 4, Math.SQRT2),
    ],
    [
      'angle in its quadrant',
      { kind: 'angle', a: 'la', b: 'lb', value: Math.PI / 4 },
      at(5, 1),
      ang(Math.hypot(5, 1), SMALL / (Math.PI / 4)),
    ],
    [
      'angle keeps its flags in another quadrant, t clipped to 0',
      { kind: 'angle', a: 'la', b: 'lb', value: Math.PI / 4 },
      at(-5, -1),
      ang(Math.hypot(5, 1), 0),
    ],
    [
      'angle, t clipped to 1',
      { kind: 'angle', a: 'la', b: 'lb', value: Math.PI / 4 },
      at(0, 5),
      ang(5, 1),
    ],
    [
      'reversed angle keeps its flags',
      { kind: 'angle', a: 'la', b: 'lb', value: (3 * Math.PI) / 4, reverseA: true },
      at(-5, 1),
      ang(Math.hypot(5, 1), SMALL / ((3 * Math.PI) / 4)),
    ],
  ])('%s', (_, c, cursor, expected) => {
    const constraint = dim(c);
    const before = structuredClone(constraint);
    expect(movePlacement(constraint, cursor, DATA)).toEqual(expected);
    expect(constraint).toEqual(before);
  });

  it.each<[string, Record<string, unknown>, Vec2, unknown]>([
    [
      'cursor at the vertex → the placement',
      {
        kind: 'angle',
        a: 'la',
        b: 'lb',
        value: Math.PI / 4,
        placement: { kind: 'angular', radius: 3, t: 0.2 },
      },
      X,
      { kind: 'angular', radius: 3, t: 0.2 },
    ],
    [
      'cursor at the vertex → the default',
      { kind: 'angle', a: 'la', b: 'lb', value: Math.PI / 4 },
      X,
      ang(5, 0.5),
    ],
    [
      'cursor at the centre → the placement',
      {
        kind: 'radius',
        curve: 'k',
        value: 3,
        placement: { kind: 'radial', angle: 1, distance: 2 },
      },
      [100, 0],
      { kind: 'radial', angle: 1, distance: 2 },
    ],
    [
      'cursor at the centre → the default',
      { kind: 'diameter', curve: 'k', value: 6 },
      [100, 0],
      rad(Math.PI / 4, 3.75),
    ],
  ])('degenerate: %s', (_, c, cursor, expected) => {
    expect(movePlacement(dim(c), cursor, DATA)).toEqual(expected);
  });
});

describe('defaultPlacement', () => {
  it.each<[string, Record<string, unknown>, unknown]>([
    [
      'distance, slanted to the right → +y side',
      { kind: 'distance', a: 'e', b: 'f', value: 10 },
      lin(2, 0),
    ],
    [
      'distance, slanted to the left → +y side',
      { kind: 'distance', a: 'f', b: 'e', value: 10 },
      lin(-2, 0),
    ],
    ['distance, horizontal', { kind: 'distance', a: 'a', b: 'b', value: 10 }, lin(2, 0)],
    ['distance, horizontal reversed', { kind: 'distance', a: 'b', b: 'a', value: 10 }, lin(-2, 0)],
    ['distance, vertical up → left', { kind: 'distance', a: 'g', b: 'h', value: 10 }, lin(2, 0)],
    ['distance, vertical down → left', { kind: 'distance', a: 'h', b: 'g', value: 10 }, lin(-2, 0)],
    ['hDistance', { kind: 'hDistance', a: 'f', b: 'e', value: 6 }, lin(1.2, 0)],
    ['vDistance', { kind: 'vDistance', a: 'f', b: 'e', value: 8 }, lin(1.6, 0)],
    [
      'pointLineDistance',
      { kind: 'pointLineDistance', point: 'z', line: 'ab', value: 5 },
      lin(1, 0),
    ],
    ['radius of a circle', { kind: 'radius', curve: 'k', value: 3 }, rad(Math.PI / 4, 3.75)],
    ['diameter of a circle', { kind: 'diameter', curve: 'k', value: 6 }, rad(Math.PI / 4, 3.75)],
    [
      'radius of an arc → its middle',
      { kind: 'radius', curve: 'q', value: 4 },
      rad(Math.PI / 4, 5),
    ],
    [
      'diameter of an arc across ±π',
      { kind: 'diameter', curve: 'q2', value: 8 },
      rad((-3 * Math.PI) / 4, 5),
    ],
    ['angle', { kind: 'angle', a: 'la', b: 'lb', value: Math.PI / 4 }, ang(5, 0.5)],
  ])('%s', (_, c, expected) => {
    expect(defaultPlacement(dim(c), DATA)).toEqual(expected);
  });

  it('a distance to a zero-length line gets a finite offset (0), never NaN', () => {
    const data = sketch(
      [
        ...DATA.entities,
        { kind: 'point', id: 'n1', x: 330, y: 0 },
        { kind: 'point', id: 'n2', x: 330, y: 0 },
        { kind: 'line', id: 'ln', p1: 'n1', p2: 'n2' },
      ],
      [{ kind: 'pointLineDistance', id: 'c', point: 'z', line: 'ln', value: 5 }],
    );
    const [c] = data.constraints;
    assert(c?.kind === 'pointLineDistance');
    expect(defaultPlacement(c, data)).toEqual({ kind: 'linear', offset: 0, along: 0 });
  });

  it('keeps the angular radius valid (1 mm) for a zero-length line', () => {
    const data = sketch(
      [
        ...DATA.entities,
        { kind: 'point', id: 'n1', x: 330, y: 0 },
        { kind: 'point', id: 'n2', x: 330, y: 0 },
        { kind: 'line', id: 'ln', p1: 'n1', p2: 'n2' },
      ],
      [{ kind: 'angle', id: 'c', a: 'la', b: 'ln', value: Math.PI / 4 }],
    );
    const [c] = data.constraints;
    assert(c?.kind === 'angle');
    expect(defaultPlacement(c, data)).toEqual({ kind: 'angular', radius: 1, t: 0.5 });
  });
});

function lin(offset: number, along: number): unknown {
  return { kind: 'linear', offset: close(offset), along: close(along) };
}
function rad(angle: number, distance: number): unknown {
  return { kind: 'radial', angle: close(angle), distance: close(distance) };
}
function ang(radius: number, t: number): unknown {
  return { kind: 'angular', radius: close(radius), t: close(t) };
}
