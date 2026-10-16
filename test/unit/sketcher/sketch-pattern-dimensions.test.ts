import { describe, expect, it } from 'vitest';
import type { Plane, Vec3 } from '@/core';
import { parseSketchData } from '@/sketch';
import type {
  SketchCircularPattern,
  SketchData,
  SketchEntityId,
  SketchItemId,
  SketchLinearPattern,
} from '@/sketch';
import {
  patternDimensionViews,
  sourceBox,
  withPatternParam,
} from '@/sketcher/sketch-pattern-dimensions';
import type { SketchPatternDimensionView } from '@/sketcher/sketch-pattern-dimensions';

// The dimensions of the parameters of a selected pattern (spec 12, "Zrcadlení a pole (M36)",
// "Vynesené kóty pole").

const XY: Plane = { origin: [0, 0, 0], xDir: [1, 0, 0], normal: [0, 0, 1] };
/** A plane lifted to z = 10, so world and plane coordinates differ. */
const TOP: Plane = { origin: [0, 0, 10], xDir: [1, 0, 0], normal: [0, 0, 1] };

/** Valid sketch data from plain values (parse brands the ids). */
function data(entities: readonly unknown[]): SketchData {
  const parsed = parseSketchData(entities, []);
  if (!parsed.ok) throw new Error(`invalid test data ${JSON.stringify(parsed.error)}`);
  return parsed.value;
}

// Test ids are trusted.
const item = (id: string): SketchItemId => id as SketchItemId;
const eid = (id: string): SketchEntityId => id as SketchEntityId;

/** The line pq (0,0)–(10,0): its anchor is (5, 0). */
const BASE = [
  { kind: 'point', id: 'p', x: 0, y: 0 },
  { kind: 'point', id: 'q', x: 10, y: 0 },
  { kind: 'line', id: 'pq', p1: 'p', p2: 'q' },
];

function views(
  extra: readonly unknown[],
  selection: readonly string[],
  plane: Plane = XY,
): readonly SketchPatternDimensionView[] {
  const sketch = data([...BASE, ...extra]);
  return patternDimensionViews(plane, sketch.entities, selection.map(item), []);
}

function viewOf(
  list: readonly SketchPatternDimensionView[],
  param: string,
): SketchPatternDimensionView {
  const found = list.find((v) => v.param === param);
  if (found === undefined) throw new Error(`no view ${param}`);
  return found;
}

function expectNear(actual: Vec3 | undefined, expected: Vec3): void {
  expect(actual).toBeDefined();
  expected.forEach((v, i) => {
    expect(actual?.[i]).toBeCloseTo(v, 9);
  });
}

const UP = { angle: Math.PI / 2, count: 3, spacing: 4 };

describe('sourceBox', () => {
  it('spans the defining points of the sources, a circle with its radius', () => {
    const sketch = data([
      ...BASE,
      { kind: 'point', id: 'c', x: 20, y: 0 },
      { kind: 'circle', id: 'k', center: 'c', radius: 2 },
      { kind: 'point', id: 'm', x: 3, y: -4 },
    ]);
    expect(sourceBox(sketch.entities, [eid('pq'), eid('k'), eid('m')])).toEqual({
      min: [0, -4],
      max: [22, 2],
    });
    expect(sourceBox(sketch.entities, [])).toBeNull();
  });
});

describe('patternDimensionViews: a linear pattern', () => {
  const ONE = [{ kind: 'linearPattern', id: 'lp', sources: ['pq'], direction1: UP }];

  it('per direction count, spacing and angle; count2 1× without the second direction', () => {
    const list = views(ONE, ['lp']);
    expect(list.map((v) => [v.pattern, v.param, v.format, v.value])).toEqual([
      ['lp', 'count1', 'count', 3],
      ['lp', 'spacing1', 'length', 4],
      ['lp', 'angle1', 'angle', Math.PI / 2],
      ['lp', 'count2', 'count', 1],
    ]);
  });

  it('count at the last instance, spacing from the anchor to the first instance', () => {
    const list = views(ONE, ['lp']);
    expectNear(viewOf(list, 'count1').label, [5, 8, 0]);
    expect(viewOf(list, 'count1').guide).toEqual([]);
    expectNear(viewOf(list, 'spacing1').label, [5, 2, 0]);
    expect(viewOf(list, 'spacing1').guide).toHaveLength(2);
    expectNear(viewOf(list, 'spacing1').guide[0], [5, 0, 0]);
    expectNear(viewOf(list, 'spacing1').guide[1], [5, 4, 0]);
  });

  it('the angle on an arc of radius s/2 around the anchor from the x axis to the direction', () => {
    const angle = viewOf(views(ONE, ['lp']), 'angle1');
    expect(angle.guide).toHaveLength(33);
    expectNear(angle.guide[0], [7, 0, 0]);
    expectNear(angle.guide[32], [5, 2, 0]);
    expectNear(angle.label, [5 + Math.SQRT2, Math.SQRT2, 0]);
  });

  it('count2 without the second direction lies across direction 1 at spacing 1', () => {
    const count2 = viewOf(views(ONE, ['lp']), 'count2');
    // u1 = (0, 1), across = (−1, 0).
    expectNear(count2.label, [1, 0, 0]);
    expect(count2.guide).toEqual([]);
  });

  it('with the second direction its count, spacing and angle too', () => {
    const list = views(
      [
        {
          kind: 'linearPattern',
          id: 'lp',
          sources: ['pq'],
          direction1: UP,
          direction2: { angle: 0, count: 2, spacing: 6 },
        },
      ],
      ['lp'],
    );
    expect(list.map((v) => v.param)).toEqual([
      'count1',
      'spacing1',
      'angle1',
      'count2',
      'spacing2',
      'angle2',
    ]);
    expect(viewOf(list, 'count2').value).toBe(2);
    expectNear(viewOf(list, 'count2').label, [11, 0, 0]);
    expectNear(viewOf(list, 'spacing2').label, [8, 0, 0]);
    expect(viewOf(list, 'spacing2').value).toBe(6);
    expect(viewOf(list, 'angle2').value).toBe(0);
  });

  it('is in world coordinates of the plane', () => {
    expectNear(viewOf(views(ONE, ['lp'], TOP), 'count1').label, [5, 8, 10]);
  });
});

describe('patternDimensionViews: a circular pattern', () => {
  const center = { kind: 'point', id: 'o', x: 5, y: -10 };

  it('a full circle: count at the image of the anchor in the last instance, angle on the arc', () => {
    const list = views(
      [
        center,
        {
          kind: 'circularPattern',
          id: 'cp',
          sources: ['pq'],
          center: 'o',
          count: 4,
          angle: 2 * Math.PI,
        },
      ],
      ['cp'],
    );
    expect(list.map((v) => [v.param, v.format, v.value])).toEqual([
      ['count', 'count', 4],
      ['angle', 'angle', 2 * Math.PI],
    ]);
    // r = 10, the anchor at π/2; the step π/2, the last instance at 2π.
    expectNear(viewOf(list, 'count').label, [15, -10, 0]);
    expectNear(viewOf(list, 'angle').label, [5, -20, 0]);
    expect(viewOf(list, 'angle').guide).toHaveLength(33);
    expectNear(viewOf(list, 'angle').guide[0], [5, 0, 0]);
  });

  it('a partial angle steps by angle / (count − 1)', () => {
    const list = views(
      [
        center,
        {
          kind: 'circularPattern',
          id: 'cp',
          sources: ['pq'],
          center: 'o',
          count: 3,
          angle: Math.PI,
        },
      ],
      ['cp'],
    );
    expectNear(viewOf(list, 'count').label, [5, -20, 0]);
    expectNear(viewOf(list, 'angle').label, [-5, -10, 0]);
    expectNear(viewOf(list, 'angle').guide[32], [5, -20, 0]);
  });

  it('an anchor in the centre (r ≈ 0) takes r = 10 mm from the x axis', () => {
    const list = views(
      [
        { kind: 'point', id: 'o', x: 5, y: 0 },
        {
          kind: 'circularPattern',
          id: 'cp',
          sources: ['pq'],
          center: 'o',
          count: 4,
          angle: 2 * Math.PI,
        },
      ],
      ['cp'],
    );
    expectNear(viewOf(list, 'angle').guide[0], [15, 0, 0]);
    expectNear(viewOf(list, 'angle').label, [-5, 0, 0]);
    expectNear(viewOf(list, 'count').label, [5, -10, 0]);
  });
});

describe('patternDimensionViews: selection', () => {
  const PATTERNS = [
    { kind: 'linearPattern', id: 'lp', sources: ['pq'], direction1: UP },
    { kind: 'point', id: 'a', x: 0, y: 5 },
    { kind: 'point', id: 'b', x: 10, y: 5 },
    { kind: 'line', id: 'ab', p1: 'a', p2: 'b' },
    { kind: 'mirror', id: 'm', sources: ['pq'], axis: 'ab' },
    { kind: 'point', id: 'o', x: 5, y: -10 },
    { kind: 'circularPattern', id: 'cp', sources: ['pq'], center: 'o', count: 4, angle: 1 },
  ];

  it('only selected patterns, in selection order; a mirror and other items have none', () => {
    expect(views(PATTERNS, [])).toEqual([]);
    expect(views(PATTERNS, ['m', 'pq', 'p'])).toEqual([]);
    expect(views(PATTERNS, ['cp', 'lp']).map((v) => `${v.pattern}/${v.param}`)).toEqual([
      'cp/count',
      'cp/angle',
      'lp/count1',
      'lp/spacing1',
      'lp/angle1',
      'lp/count2',
    ]);
  });

  it('frozen; an unchanged result is the previous array, an unchanged view the same object', () => {
    const sketch = data([...BASE, ...PATTERNS]);
    const first = patternDimensionViews(XY, sketch.entities, [item('lp')], []);
    expect(Object.isFrozen(first)).toBe(true);
    expect(first.every((v) => Object.isFrozen(v) && Object.isFrozen(v.guide))).toBe(true);
    expect(patternDimensionViews(XY, sketch.entities, [item('lp')], first)).toBe(first);

    const changed = data([
      ...BASE,
      ...PATTERNS.map((e) => (e.id === 'lp' ? { ...e, direction1: { ...UP, count: 5 } } : e)),
    ]);
    const next = patternDimensionViews(XY, changed.entities, [item('lp')], first);
    expect(next).not.toBe(first);
    expect(next[1]).toBe(first[1]);
    expect(next[0]).not.toBe(first[0]);
  });
});

describe('withPatternParam', () => {
  const LP: SketchLinearPattern = {
    kind: 'linearPattern',
    id: eid('lp'),
    sources: [eid('pq')],
    direction1: { angle: 0, count: 3, spacing: 4 },
  };
  const CP: SketchCircularPattern = {
    kind: 'circularPattern',
    id: eid('cp'),
    sources: [eid('pq')],
    center: eid('p'),
    count: 3,
    angle: Math.PI,
  };

  it('sets a parameter; count2 adds the second direction across direction 1, 1 removes it', () => {
    expect(withPatternParam(LP, 'spacing1', 7)).toEqual({
      ...LP,
      direction1: { angle: 0, count: 3, spacing: 7 },
    });
    const grid = withPatternParam(LP, 'count2', 4);
    expect(grid).toEqual({
      ...LP,
      direction2: { angle: Math.PI / 2, count: 4, spacing: 4 },
    });
    expect(grid === null ? null : withPatternParam(grid, 'count2', 1)).toEqual(LP);
    expect(withPatternParam(CP, 'angle', -2 * Math.PI)).toEqual({ ...CP, angle: -2 * Math.PI });
  });

  it('null for an invalid value or a parameter the pattern does not have', () => {
    expect(withPatternParam(LP, 'count1', 1)).toBeNull();
    expect(withPatternParam(LP, 'count2', 0)).toBeNull();
    expect(withPatternParam(LP, 'count2', 2.5)).toBeNull();
    expect(withPatternParam(LP, 'spacing1', 0)).toBeNull();
    expect(withPatternParam(LP, 'spacing2', 3)).toBeNull();
    expect(withPatternParam(LP, 'count', 3)).toBeNull();
    expect(withPatternParam(CP, 'count', 101)).toBeNull();
    expect(withPatternParam(CP, 'angle', 0)).toBeNull();
    expect(withPatternParam(CP, 'spacing1', 3)).toBeNull();
  });

  it('the result is frozen with its sources and directions', () => {
    const grid = withPatternParam(LP, 'count2', 3);
    expect(grid?.kind).toBe('linearPattern');
    if (grid?.kind !== 'linearPattern') return;
    expect(Object.isFrozen(grid)).toBe(true);
    expect(Object.isFrozen(grid.sources)).toBe(true);
    expect(Object.isFrozen(grid.direction1)).toBe(true);
    expect(Object.isFrozen(grid.direction2)).toBe(true);
    const circular = withPatternParam(CP, 'count', 5);
    expect(Object.isFrozen(circular)).toBe(true);
    expect(circular === null || Object.isFrozen(circular.sources)).toBe(true);
  });
});
