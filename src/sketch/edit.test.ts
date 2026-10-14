import { describe, expect, it } from 'vitest';
import { constraintFor, dimensionFor, measure, removeItems, toggleConstruction } from './edit';
import type { SketchConstraint, SketchData, SketchEntity, SketchItemId } from './model';
import { parseSketchData } from './parse';

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

  it('does not change the input', () => {
    const before = JSON.stringify(DATA);
    removeItems(DATA, ids('a', 'h1'));
    expect(JSON.stringify(DATA)).toBe(before);
  });
});

describe('toggleConstruction', () => {
  const construction = (data: SketchData) =>
    data.entities.filter((x) => x.kind !== 'point' && x.construction === true).map((x) => x.id);

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
