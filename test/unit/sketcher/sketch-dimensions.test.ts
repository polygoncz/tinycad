import { describe, expect, it } from 'vitest';
import type { Plane, Vec3 } from '@/core';
import { parseSketchData } from '@/sketch';
import type { SketchConstraintDraft, SketchData, SketchEntityId, SketchItemId } from '@/sketch';
import { constraintNumbers, dimensionViews } from '@/sketcher/sketch-dimensions';
import type { DimensionGeometry, SketchDimensionView } from '@/sketcher/sketch-dimensions';

const XY: Plane = { origin: [0, 0, 0], xDir: [1, 0, 0], normal: [0, 0, 1] };
/** A plane lifted to z = 10, so world and plane coordinates differ. */
const TOP: Plane = { origin: [0, 0, 10], xDir: [1, 0, 0], normal: [0, 0, 1] };

/** Valid sketch data from plain values (parse brands the ids). */
function data(entities: readonly unknown[], constraints: readonly unknown[] = []): SketchData {
  const parsed = parseSketchData(entities, constraints);
  if (!parsed.ok) throw new Error(`invalid test data ${JSON.stringify(parsed.error)}`);
  return parsed.value;
}

// Test ids are trusted.
const item = (id: string): SketchItemId => id as SketchItemId;
const eid = (id: string): SketchEntityId => id as SketchEntityId;

const SKETCH = data(
  [
    { kind: 'point', id: 'p', x: 0, y: 0 },
    { kind: 'point', id: 'q', x: 4, y: 3 },
    { kind: 'point', id: 'c', x: 1, y: 1 },
    { kind: 'circle', id: 'k', center: 'c', radius: 2 },
    { kind: 'point', id: 'o', x: 0, y: 0 },
    { kind: 'point', id: 's', x: 3, y: 0 },
    { kind: 'point', id: 'e', x: 0, y: 3 },
    { kind: 'arc', id: 'a', center: 'o', start: 's', end: 'e' },
    { kind: 'line', id: 'pq', p1: 'p', p2: 'q' },
  ],
  [
    { kind: 'horizontal', id: 'h', line: 'pq' },
    { kind: 'distance', id: 'd1', a: 'p', b: 'q', value: 5 },
    { kind: 'radius', id: 'r1', curve: 'k', value: 2 },
    { kind: 'radius', id: 'r2', curve: 'a', value: 3 },
    { kind: 'distance', id: 'd2', a: 'q', b: 'c', value: 3.6 },
  ],
);

/** Two lines: x axis (0,0)→(10,0) and the vertical (2,1)→(2,5); their vertex is (2, 0). */
const LINES = [
  { kind: 'point', id: 'a1', x: 0, y: 0 },
  { kind: 'point', id: 'a2', x: 10, y: 0 },
  { kind: 'line', id: 'la', p1: 'a1', p2: 'a2' },
  { kind: 'point', id: 'b1', x: 2, y: 1 },
  { kind: 'point', id: 'b2', x: 2, y: 5 },
  { kind: 'line', id: 'lb', p1: 'b1', p2: 'b2' },
  { kind: 'point', id: 'm', x: 3, y: 4 },
];

function views(sketch: SketchData = SKETCH, selection: readonly SketchItemId[] = [], plane = XY) {
  return dimensionViews(plane, sketch.entities, sketch.constraints, selection, []);
}

/** The only view of a sketch with one dimension. */
function only(entities: readonly unknown[], constraint: unknown): SketchDimensionView {
  const result = views(data(entities, [constraint]));
  expect(result).toHaveLength(1);
  const [view] = result;
  if (view === undefined) throw new Error('no view');
  return view;
}

function expectClose(actual: Vec3 | null | undefined, expected: Vec3): void {
  expect(actual).not.toBeNull();
  expect(actual).toBeDefined();
  expected.forEach((v, i) => {
    expect(actual?.[i]).toBeCloseTo(v, 12);
  });
}

function geometryOf<K extends DimensionGeometry['kind']>(
  view: SketchDimensionView | undefined,
  kind: K,
): Extract<DimensionGeometry, { kind: K }> {
  const g = view?.geometry;
  if (g?.kind !== kind) throw new Error(`not ${kind}: ${JSON.stringify(g)}`);
  // Narrowed by the check of the kind just above.
  return g as Extract<DimensionGeometry, { kind: K }>;
}

describe('dimensionViews: linear dimensions', () => {
  it('a distance without placement: the default placement, laid out in world coordinates', () => {
    const [d1] = dimensionViews(TOP, SKETCH.entities, SKETCH.constraints, [], []);
    expect(d1).toMatchObject({ id: 'd1', kind: 'distance', value: 5, n: 1, selected: false });
    expect(d1?.preview).toBeUndefined();
    // 0.2 · 5 on the left of p→q (+y side).
    expect(d1?.placement).toEqual({ kind: 'linear', offset: 1, along: 0 });
    const g = geometryOf(d1, 'linear');
    expect(g.from).toEqual([0, 0, 10]);
    expect(g.to).toEqual([4, 3, 10]);
    // u = (0.8, 0.6), n = (−0.6, 0.8), M = (2, 1.5).
    expectClose(g.lineFrom, [-0.6, 0.8, 10]);
    expectClose(g.lineTo, [3.4, 3.8, 10]);
    expectClose(g.label, [1.4, 2.3, 10]);
  });

  it('a stored placement: offset along n, the label moved along u', () => {
    const d = only(SKETCH.entities, {
      kind: 'distance',
      id: 'd',
      a: 'p',
      b: 'q',
      value: 5,
      placement: { kind: 'linear', offset: -2, along: 3 },
    });
    expect(d.placement).toEqual({ kind: 'linear', offset: -2, along: 3 });
    const g = geometryOf(d, 'linear');
    expectClose(g.lineFrom, [1.2, -1.6, 0]);
    expectClose(g.lineTo, [5.2, 1.4, 0]);
    // M − 2n + 3u = (2, 1.5) + (1.2, −1.6) + (2.4, 1.8).
    expectClose(g.label, [5.6, 1.7, 0]);
  });

  it('hDistance: the dimension line horizontal at M.y + offset', () => {
    const d = only(SKETCH.entities, {
      kind: 'hDistance',
      id: 'd',
      a: 'p',
      b: 'q',
      value: 4,
      placement: { kind: 'linear', offset: 2, along: 0 },
    });
    expect(d.kind).toBe('hDistance');
    const g = geometryOf(d, 'linear');
    expect(g.from).toEqual([0, 0, 0]);
    expect(g.to).toEqual([4, 3, 0]);
    expectClose(g.lineFrom, [0, 3.5, 0]);
    expectClose(g.lineTo, [4, 3.5, 0]);
    expectClose(g.label, [2, 3.5, 0]);
  });

  it('vDistance: the dimension line vertical at M.x − offset', () => {
    const d = only(SKETCH.entities, {
      kind: 'vDistance',
      id: 'd',
      a: 'p',
      b: 'q',
      value: 3,
      placement: { kind: 'linear', offset: 1, along: 0 },
    });
    const g = geometryOf(d, 'linear');
    expectClose(g.lineFrom, [1, 0, 0]);
    expectClose(g.lineTo, [1, 3, 0]);
    expectClose(g.label, [1, 1.5, 0]);
  });

  it('pointLineDistance: from the foot of the perpendicular to the point, default 0.2 · value', () => {
    const d = only(LINES, { kind: 'pointLineDistance', id: 'd', point: 'm', line: 'la', value: 4 });
    expect(d.placement).toEqual({ kind: 'linear', offset: 0.8, along: 0 });
    const g = geometryOf(d, 'linear');
    expectClose(g.from, [3, 0, 0]);
    expectClose(g.to, [3, 4, 0]);
    // u = (0, 1), n = (−1, 0).
    expectClose(g.lineFrom, [2.2, 0, 0]);
    expectClose(g.lineTo, [2.2, 4, 0]);
    expectClose(g.label, [2.2, 2, 0]);
  });
});

describe('dimensionViews: radial dimensions', () => {
  it('a radius of a circle without placement: at π/4, the label at 1.25 · r', () => {
    const r1 = views().find((d) => d.id === 'r1');
    expect(r1?.kind).toBe('radius');
    expect(r1?.value).toBe(2);
    expect(r1?.placement).toEqual({ kind: 'radial', angle: Math.PI / 4, distance: 2.5 });
    const g = geometryOf(r1, 'radial');
    expect(g.center).toEqual([1, 1, 0]);
    const h = Math.SQRT1_2;
    expectClose(g.near, [1 + 2 * h, 1 + 2 * h, 0]);
    expect(g.far).toBeNull();
    expectClose(g.label, [1 + 2.5 * h, 1 + 2.5 * h, 0]);
  });

  it('a diameter with a stored placement has the opposite point too', () => {
    const d = only(SKETCH.entities, {
      kind: 'diameter',
      id: 'd',
      curve: 'k',
      value: 4,
      placement: { kind: 'radial', angle: 0, distance: 3 },
    });
    expect(d.kind).toBe('diameter');
    const g = geometryOf(d, 'radial');
    expectClose(g.near, [3, 1, 0]);
    expectClose(g.far, [-1, 1, 0]);
    expectClose(g.label, [4, 1, 0]);
  });

  it('a radius of an arc goes from the centre to the middle of the arc', () => {
    const r2 = views().find((d) => d.id === 'r2');
    const g = geometryOf(r2, 'radial');
    expect(g.center).toEqual([0, 0, 0]);
    // The arc runs counter-clockwise from 0 to π/2: its middle is at π/4, radius |start − centre|.
    const h = 3 * Math.SQRT1_2;
    expectClose(g.near, [h, h, 0]);
  });

  it('the middle of an arc over angle 0 follows the counter-clockwise sweep', () => {
    // From π/2 to 0 counter-clockwise = three quarters; the middle is at 5π/4.
    const r = only(
      [
        { kind: 'point', id: 'o', x: 0, y: 0 },
        { kind: 'point', id: 's', x: 0, y: 2 },
        { kind: 'point', id: 'e', x: 2, y: 0 },
        { kind: 'arc', id: 'a', center: 'o', start: 's', end: 'e' },
      ],
      { kind: 'radius', id: 'r', curve: 'a', value: 2 },
    );
    expectClose(geometryOf(r, 'radial').near, [-Math.SQRT2, -Math.SQRT2, 0]);
  });
});

describe('dimensionViews: angles', () => {
  it('without placement: an arc of half the shorter line around the vertex, the label halfway', () => {
    const d = only(LINES, { kind: 'angle', id: 'd', a: 'la', b: 'lb', value: Math.PI / 2 });
    expect(d.kind).toBe('angle');
    expect(d.placement).toEqual({ kind: 'angular', radius: 2, t: 0.5 });
    const g = geometryOf(d, 'angular');
    expectClose(g.vertex, [2, 0, 0]);
    expect(g.arc).toHaveLength(33);
    expectClose(g.arc[0], [4, 0, 0]);
    expectClose(g.arc[32], [2, 2, 0]);
    expectClose(g.arc[16], [2 + Math.SQRT2, Math.SQRT2, 0]);
    expectClose(g.label, [2 + Math.SQRT2, Math.SQRT2, 0]);
  });

  it('a reversed line turns its ray; the arc runs the shorter way from ray A to ray B', () => {
    const d = only(LINES, {
      kind: 'angle',
      id: 'd',
      a: 'la',
      b: 'lb',
      value: Math.PI / 2,
      reverseA: true,
      placement: { kind: 'angular', radius: 3, t: 0.25 },
    });
    const g = geometryOf(d, 'angular');
    // Ray A = −x, ray B = +y: clockwise from π to π/2.
    expectClose(g.arc[0], [-1, 0, 0]);
    expectClose(g.arc[32], [2, 3, 0]);
    const at = Math.PI - Math.PI / 8;
    expectClose(g.label, [2 + 3 * Math.cos(at), 3 * Math.sin(at), 0]);
  });

  it('both reversed: from −x to −y', () => {
    const d = only(LINES, {
      kind: 'angle',
      id: 'd',
      a: 'la',
      b: 'lb',
      value: Math.PI / 2,
      reverseA: true,
      reverseB: true,
      placement: { kind: 'angular', radius: 1, t: 1 },
    });
    const g = geometryOf(d, 'angular');
    expectClose(g.arc[0], [1, 0, 0]);
    expectClose(g.label, [2, -1, 0]);
  });

  it('parallel lines have no vertex: left out', () => {
    const parallel = LINES.map((e) =>
      e.id === 'b1' ? { ...e, x: 0, y: 1 } : e.id === 'b2' ? { ...e, x: 5, y: 1 } : e,
    );
    const sketch = data(parallel, [{ kind: 'angle', id: 'd', a: 'la', b: 'lb', value: 1 }]);
    expect(views(sketch)).toEqual([]);
  });
});

describe('dimensionViews: the preview', () => {
  const draft: SketchConstraintDraft = {
    kind: 'hDistance',
    a: eid('p'),
    b: eid('q'),
    value: 4,
    placement: { kind: 'linear', offset: 2, along: 0 },
  };

  it('comes last with the id __preview, preview true, n 0, not selected', () => {
    const result = dimensionViews(XY, SKETCH.entities, SKETCH.constraints, [], [], draft);
    const last = result.at(-1);
    expect(result).toHaveLength(5);
    expect(last).toMatchObject({
      id: '__preview',
      kind: 'hDistance',
      value: 4,
      n: 0,
      selected: false,
      preview: true,
      placement: { kind: 'linear', offset: 2, along: 0 },
    });
    expectClose(geometryOf(last, 'linear').lineTo, [4, 3.5, 0]);
  });

  it('the same preview again → the same array', () => {
    const prev = dimensionViews(XY, SKETCH.entities, SKETCH.constraints, [], [], draft);
    const next = dimensionViews(XY, SKETCH.entities, SKETCH.constraints, [], prev, { ...draft });
    expect(next).toBe(prev);
  });

  it('a geometric draft is no dimension: nothing more', () => {
    const geometric: SketchConstraintDraft = { kind: 'horizontal', line: eid('pq') };
    const result = dimensionViews(XY, SKETCH.entities, SKETCH.constraints, [], [], geometric);
    expect(result.map((d) => d.id)).toEqual(['d1', 'r1', 'r2', 'd2']);
  });
});

describe('dimensionViews', () => {
  it('only dimensions, numbered within their kind like the panel rows', () => {
    expect(views().map((d) => [d.id, d.n])).toEqual([
      ['d1', 1],
      ['r1', 1],
      ['r2', 2],
      ['d2', 2],
    ]);
  });

  it('a dimension with a missing entity is left out, the numbering stays', () => {
    // Without the point q: d1 and d2 lose an end. The data stays as read (no parse checks it).
    const entities = SKETCH.entities.filter((e) => e.id !== 'q');
    const result = dimensionViews(XY, entities, SKETCH.constraints, [], []);
    expect(result.map((d) => [d.id, d.n])).toEqual([
      ['r1', 1],
      ['r2', 2],
    ]);
  });

  it('a radius on something else than a circle or an arc is left out', () => {
    const constraints = SKETCH.constraints.map((c) =>
      c.id === 'r1' && c.kind === 'radius' ? { ...c, curve: eid('pq') } : c,
    );
    // pq is a line: a radius on it has no circle.
    const result = dimensionViews(XY, SKETCH.entities, constraints, [], []);
    expect(result.map((d) => d.id)).toEqual(['d1', 'r2', 'd2']);
  });

  it('selected follows the selection', () => {
    const selected = views(SKETCH, [item('r1')]).filter((d) => d.selected);
    expect(selected.map((d) => d.id)).toEqual(['r1']);
  });

  it('the result and its items are frozen', () => {
    const result = views();
    expect(Object.isFrozen(result)).toBe(true);
    expect(result.every((d) => Object.isFrozen(d))).toBe(true);
  });

  it('nothing changed → the same array', () => {
    const prev = views();
    const next = dimensionViews(XY, SKETCH.entities, SKETCH.constraints, [], prev);
    expect(next).toBe(prev);
  });

  it('another dimension changed → the unchanged items stay the same objects', () => {
    const prev = views();
    const changed = data(
      SKETCH.entities,
      SKETCH.constraints.map((c) => (c.id === 'r1' ? { ...c, value: 2.5 } : c)),
    );
    const next = dimensionViews(XY, changed.entities, changed.constraints, [], prev);
    expect(next).not.toBe(prev);
    expect(next.find((d) => d.id === 'r1')?.value).toBe(2.5);
    for (const id of ['d1', 'r2', 'd2']) {
      expect(next.find((d) => d.id === id)).toBe(prev.find((d) => d.id === id));
    }
  });

  it('a moved point → a new item for the dimensions on it only', () => {
    const prev = views();
    const moved = data(
      SKETCH.entities.map((e) => (e.id === 'p' ? { ...e, x: -1 } : e)),
      SKETCH.constraints,
    );
    const next = dimensionViews(XY, moved.entities, moved.constraints, [], prev);
    expect(next.find((d) => d.id === 'd1')).not.toBe(prev.find((d) => d.id === 'd1'));
    expect(
      geometryOf(
        next.find((d) => d.id === 'd1'),
        'linear',
      ).from,
    ).toEqual([-1, 0, 0]);
    expect(next.find((d) => d.id === 'd2')).toBe(prev.find((d) => d.id === 'd2'));
  });

  it('a new placement → a new item for that dimension only', () => {
    const prev = views();
    const placed = data(
      SKETCH.entities,
      SKETCH.constraints.map((c) =>
        c.id === 'd1' ? { ...c, placement: { kind: 'linear', offset: 3, along: 0 } } : c,
      ),
    );
    const next = dimensionViews(XY, placed.entities, placed.constraints, [], prev);
    expect(next.find((d) => d.id === 'd1')?.placement).toEqual({
      kind: 'linear',
      offset: 3,
      along: 0,
    });
    expect(next.find((d) => d.id === 'd1')).not.toBe(prev.find((d) => d.id === 'd1'));
    expect(next.find((d) => d.id === 'd2')).toBe(prev.find((d) => d.id === 'd2'));
  });

  it('a change of the selection → a new item for that dimension only', () => {
    const prev = views();
    const next = dimensionViews(XY, SKETCH.entities, SKETCH.constraints, [item('d2')], prev);
    expect(next.find((d) => d.id === 'd2')?.selected).toBe(true);
    expect(next.find((d) => d.id === 'd1')).toBe(prev.find((d) => d.id === 'd1'));
  });
});

describe('constraintNumbers', () => {
  it('numbers the constraints within their kind, in their order', () => {
    expect(constraintNumbers(SKETCH.constraints)).toEqual([1, 1, 1, 2, 2]);
  });

  it('is empty for no constraints', () => {
    expect(constraintNumbers([])).toEqual([]);
  });
});
