import { describe, expect, it } from 'vitest';
import type { Plane, Vec3 } from '@/core';
import { parseSketchData } from '@/sketch';
import type { SketchData, SketchItemId } from '@/sketch';
import { glyphViews } from '@/sketcher/sketch-glyphs';
import type { SketchGlyphView } from '@/sketcher/sketch-glyphs';

const XY: Plane = { origin: [0, 0, 0], xDir: [1, 0, 0], normal: [0, 0, 1] };
/** The plane XZ lifted to y = 5: x stays x, y of the plane is +z of the world. */
const XZ: Plane = { origin: [0, 5, 0], xDir: [1, 0, 0], normal: [0, -1, 0] };

/** Valid sketch data from plain values (parse brands the ids). */
function data(entities: readonly unknown[], constraints: readonly unknown[] = []): SketchData {
  const parsed = parseSketchData(entities, constraints);
  if (!parsed.ok) throw new Error(`invalid test data ${JSON.stringify(parsed.error)}`);
  return parsed.value;
}

// Test ids are trusted.
const item = (id: string): SketchItemId => id as SketchItemId;
const set = (...ids: string[]): ReadonlySet<SketchItemId> => new Set(ids.map(item));

const H = Math.SQRT1_2;

const ENTITIES = [
  { kind: 'point', id: 'a', x: 0, y: 0 },
  { kind: 'point', id: 'b', x: 4, y: 0 },
  { kind: 'point', id: 'c', x: 4, y: 3 },
  { kind: 'point', id: 'f', x: 0, y: 7 },
  { kind: 'point', id: 'g', x: 0, y: 0 },
  /** Horizontal: side +y. */
  { kind: 'line', id: 'ab', p1: 'a', p2: 'b' },
  /** Vertical: side −x. */
  { kind: 'line', id: 'bc', p1: 'b', p2: 'c' },
  /** Its raw normal (−4, −4) points down: turned to +y → (+x+y)/√2. */
  { kind: 'line', id: 'cf', p1: 'c', p2: 'f' },
  { kind: 'point', id: 'o', x: 10, y: 0 },
  { kind: 'circle', id: 'k', center: 'o', radius: 2 },
  { kind: 'point', id: 'm', x: 20, y: 0 },
  { kind: 'point', id: 's', x: 23, y: 0 },
  { kind: 'point', id: 'e', x: 20, y: 3 },
  /** Counter-clockwise from 0 to π/2: its middle at π/4. */
  { kind: 'arc', id: 'arc', center: 'm', start: 's', end: 'e' },
];

const SKETCH = data(ENTITIES, [
  { kind: 'horizontal', id: 'h', line: 'ab' },
  { kind: 'vertical', id: 'v', line: 'bc' },
  { kind: 'perpendicular', id: 'perp', a: 'ab', b: 'bc' },
  { kind: 'distance', id: 'd', a: 'a', b: 'b', value: 4 },
  { kind: 'coincident', id: 'co', a: 'a', b: 'g' },
  { kind: 'fix', id: 'fx', point: 'a' },
  { kind: 'equal', id: 'eq', a: 'k', b: 'arc' },
  { kind: 'tangent', id: 't', a: 'cf', b: 'k' },
  { kind: 'parallel', id: 'par', a: 'ab', b: 'cf' },
  { kind: 'radius', id: 'r', curve: 'k', value: 2 },
]);

function views(
  visible: 'all' | ReadonlySet<SketchItemId> = 'all',
  opts: {
    sketch?: SketchData;
    plane?: Plane;
    selection?: readonly SketchItemId[];
    hover?: SketchItemId | null;
    prev?: readonly SketchGlyphView[];
  } = {},
): readonly SketchGlyphView[] {
  return glyphViews(
    opts.plane ?? XY,
    opts.sketch ?? SKETCH,
    visible,
    opts.selection ?? [],
    opts.hover ?? null,
    opts.prev ?? [],
  );
}

const pairs = (glyphs: readonly SketchGlyphView[]) => glyphs.map((g) => [g.constraint, g.entity]);

function glyph(glyphs: readonly SketchGlyphView[], constraint: string, entity: string) {
  const found = glyphs.find((g) => g.constraint === constraint && g.entity === entity);
  if (found === undefined) throw new Error(`no glyph ${constraint} at ${entity}`);
  return found;
}

function expectVec(actual: Vec3, expected: Vec3): void {
  actual.forEach((v, i) => {
    expect(v).toBeCloseTo(expected[i] ?? NaN, 12);
  });
}

describe('glyphViews: which constraints', () => {
  it("'all' shows every geometric constraint, a glyph at each of its entities, no dimensions", () => {
    expect(pairs(views('all'))).toEqual([
      ['h', 'ab'],
      ['v', 'bc'],
      ['perp', 'ab'],
      ['perp', 'bc'],
      ['co', 'a'],
      ['fx', 'a'],
      ['eq', 'k'],
      ['eq', 'arc'],
      ['t', 'cf'],
      ['t', 'k'],
      ['par', 'ab'],
      ['par', 'cf'],
    ]);
  });

  it('a set shows the constraints referring to one of its entities, at all their entities', () => {
    expect(pairs(views(set('bc')))).toEqual([
      ['v', 'bc'],
      ['perp', 'ab'],
      ['perp', 'bc'],
    ]);
  });

  it('coincident has one glyph at point a, shown also for point b', () => {
    expect(pairs(views(set('g')))).toEqual([['co', 'a']]);
    expect(pairs(views(set('a')))).toEqual([
      ['co', 'a'],
      ['fx', 'a'],
    ]);
  });

  it('pointOnCurve and midpoint have one glyph at the point, hAlign and vAlign one at each', () => {
    const sketch = data(
      [...ENTITIES, { kind: 'point', id: 'p', x: 2, y: 0 }, { kind: 'point', id: 'q', x: 2, y: 5 }],
      [
        { kind: 'pointOnCurve', id: 'on', point: 'p', curve: 'k' },
        { kind: 'midpoint', id: 'mid', point: 'p', line: 'ab' },
        { kind: 'hAlign', id: 'ha', a: 'q', b: 'f' },
        { kind: 'vAlign', id: 'va', a: 'p', b: 'q' },
      ],
    );
    const glyphs = views('all', { sketch });
    expect(glyphs.map((g) => [g.constraint, g.kind, g.entity])).toEqual([
      ['on', 'pointOnCurve', 'p'],
      ['mid', 'midpoint', 'p'],
      ['ha', 'hAlign', 'q'],
      ['ha', 'hAlign', 'f'],
      ['va', 'vAlign', 'p'],
      ['va', 'vAlign', 'q'],
    ]);
    // Shown also for the curve; anchored like a point glyph, stacked at the shared point.
    expect(pairs(views(set('k'), { sketch }))).toEqual([['on', 'p']]);
    expect(glyph(glyphs, 'mid', 'p')).toMatchObject({ anchor: [2, 0, 0], slot: 1 });
    expectVec(glyph(glyphs, 'mid', 'p').side, [H, H, 0]);
    expect(glyph(glyphs, 'va', 'q')).toMatchObject({ anchor: [2, 5, 0], slot: 1 });
  });

  it('an empty set shows nothing', () => {
    expect(views(set())).toEqual([]);
  });

  it('marks the hovered and the selected constraints', () => {
    const glyphs = views(set('ab'), { selection: [item('perp'), item('ab')], hover: item('h') });

    expect(glyph(glyphs, 'h', 'ab')).toMatchObject({ hover: true, selected: false });
    expect(glyph(glyphs, 'perp', 'ab')).toMatchObject({ hover: false, selected: true });
    expect(glyph(glyphs, 'perp', 'bc')).toMatchObject({ hover: false, selected: true });
    expect(glyph(glyphs, 'par', 'cf')).toMatchObject({ hover: false, selected: false });
  });

  it('leaves out a glyph whose entity is missing', () => {
    const sketch = { entities: SKETCH.entities.filter((e) => e.id !== 'k'), constraints: [] };
    const withEqual = {
      ...sketch,
      constraints: SKETCH.constraints.filter((c) => c.id === 'eq'),
    };

    expect(pairs(views('all', { sketch: withEqual }))).toEqual([['eq', 'arc']]);
  });
});

describe('glyphViews: slots', () => {
  it('numbers the glyphs at one entity in the order of the constraints', () => {
    const glyphs = views('all');

    expect(['h', 'perp', 'par'].map((c) => glyph(glyphs, c, 'ab').slot)).toEqual([0, 1, 2]);
    expect(['v', 'perp'].map((c) => glyph(glyphs, c, 'bc').slot)).toEqual([0, 1]);
    expect(['co', 'fx'].map((c) => glyph(glyphs, c, 'a').slot)).toEqual([0, 1]);
    expect(glyph(glyphs, 'eq', 'arc').slot).toBe(0);
  });

  it('glyphs at coincident points share one row (anchors within 1e-6 mm)', () => {
    const sketch = data(
      [
        { kind: 'point', id: 'p', x: 1, y: 1 },
        { kind: 'point', id: 'q', x: 1 + 1e-7, y: 1 },
      ],
      [
        { kind: 'coincident', id: 'co', a: 'p', b: 'q' },
        { kind: 'fix', id: 'fx', point: 'q' },
      ],
    );
    const glyphs = views('all', { sketch });

    expect(glyph(glyphs, 'co', 'p').slot).toBe(0);
    expect(glyph(glyphs, 'fx', 'q').slot).toBe(1);
  });

  it('anchors farther apart than 1e-6 mm make two rows', () => {
    const sketch = data(
      [
        { kind: 'point', id: 'p', x: 1, y: 1 },
        { kind: 'point', id: 'q', x: 1 + 1e-5, y: 1 },
      ],
      [
        { kind: 'fix', id: 'f1', point: 'p' },
        { kind: 'fix', id: 'f2', point: 'q' },
      ],
    );
    const glyphs = views('all', { sketch });

    expect(glyph(glyphs, 'f1', 'p').slot).toBe(0);
    expect(glyph(glyphs, 'f2', 'q').slot).toBe(0);
  });

  it('counts only the shown glyphs', () => {
    const glyphs = views(set('cf'));

    expect(glyph(glyphs, 'par', 'ab').slot).toBe(0);
    expect(glyph(glyphs, 't', 'cf').slot).toBe(0);
    expect(glyph(glyphs, 'par', 'cf').slot).toBe(1);
  });
});

describe('glyphViews: anchors and sides', () => {
  const glyphs = views('all');

  it('a horizontal line: its middle, side +y', () => {
    const g = glyph(glyphs, 'h', 'ab');
    expectVec(g.anchor, [2, 0, 0]);
    expectVec(g.side, [0, 1, 0]);
  });

  it('a vertical line: its middle, side −x', () => {
    const g = glyph(glyphs, 'v', 'bc');
    expectVec(g.anchor, [4, 1.5, 0]);
    expectVec(g.side, [-1, 0, 0]);
  });

  it('a vertical line drawn downwards has the side −x too', () => {
    const down = data(
      [
        { kind: 'point', id: 'p', x: 1, y: 5 },
        { kind: 'point', id: 'q', x: 1, y: 1 },
        { kind: 'line', id: 'pq', p1: 'p', p2: 'q' },
      ],
      [{ kind: 'vertical', id: 'v', line: 'pq' }],
    );
    expectVec(glyph(views('all', { sketch: down }), 'v', 'pq').side, [-1, 0, 0]);
  });

  it('a slanted line: the normal turned to +y', () => {
    const g = glyph(glyphs, 't', 'cf');
    expectVec(g.anchor, [2, 5, 0]);
    expectVec(g.side, [H, H, 0]);
  });

  it('a point: the point, side +x+y normalised', () => {
    const g = glyph(glyphs, 'fx', 'a');
    expectVec(g.anchor, [0, 0, 0]);
    expectVec(g.side, [H, H, 0]);
  });

  it('a circle: its top, side +y', () => {
    const g = glyph(glyphs, 'eq', 'k');
    expectVec(g.anchor, [10, 2, 0]);
    expectVec(g.side, [0, 1, 0]);
  });

  it('an arc: the middle of the arc, side from the centre', () => {
    const g = glyph(glyphs, 'eq', 'arc');
    expectVec(g.anchor, [20 + 3 * H, 3 * H, 0]);
    expectVec(g.side, [H, H, 0]);
  });

  it('anchors and sides are in world coordinates of the plane', () => {
    const onXz = views('all', { plane: XZ });
    const h = glyph(onXz, 'h', 'ab');
    expectVec(h.anchor, [2, 5, 0]);
    expectVec(h.side, [0, 0, 1]);
    const v = glyph(onXz, 'v', 'bc');
    expectVec(v.anchor, [4, 5, 1.5]);
    expectVec(v.side, [-1, 0, 0]);
  });
});

describe('glyphViews: immutability', () => {
  it('is frozen, items too', () => {
    const glyphs = views('all');
    expect(Object.isFrozen(glyphs)).toBe(true);
    expect(glyphs.every((g) => Object.isFrozen(g))).toBe(true);
  });

  it('an unchanged result is the same array', () => {
    const before = views('all');
    expect(views('all', { prev: before })).toBe(before);
  });

  it('unchanged items stay the same objects, changed ones are new', () => {
    const before = views('all');
    const after = views('all', { prev: before, selection: [item('h')] });

    expect(after).not.toBe(before);
    expect(glyph(after, 'h', 'ab')).not.toBe(glyph(before, 'h', 'ab'));
    expect(glyph(after, 'h', 'ab').selected).toBe(true);
    expect(glyph(after, 'perp', 'ab')).toBe(glyph(before, 'perp', 'ab'));
  });

  it('a glyph keeps its object when another one disappears before it', () => {
    const before = views('all');
    const after = views(set('cf'), { prev: before });

    expect(glyph(after, 't', 'cf')).toBe(glyph(before, 't', 'cf'));
  });
});
