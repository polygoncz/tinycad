import { describe, expect, it } from 'vitest';
import type { Plane } from '@/core';
import { parseSketchData } from '@/sketch';
import type { SketchData, SketchEntityId, SketchItemId } from '@/sketch';
import { constraintNumbers, dimensionViews } from './sketch-dimensions';

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

function views(sketch: SketchData = SKETCH, selection: readonly SketchItemId[] = [], plane = XY) {
  return dimensionViews(plane, sketch.entities, sketch.constraints, selection, []);
}

describe('dimensionViews', () => {
  it('a distance goes from point a to point b in world coordinates', () => {
    const [d1] = dimensionViews(TOP, SKETCH.entities, SKETCH.constraints, [], []);
    expect(d1).toEqual({
      id: 'd1',
      kind: 'distance',
      value: 5,
      from: [0, 0, 10],
      to: [4, 3, 10],
      n: 1,
      selected: false,
    });
  });

  it('a radius of a circle goes from the centre to the point at π/4 on the circle', () => {
    const r1 = views().find((d) => d.id === 'r1');
    expect(r1?.kind).toBe('radius');
    expect(r1?.value).toBe(2);
    expect(r1?.from).toEqual([1, 1, 0]);
    const h = 2 * Math.SQRT1_2;
    expect(r1?.to[0]).toBeCloseTo(1 + h, 12);
    expect(r1?.to[1]).toBeCloseTo(1 + h, 12);
    expect(r1?.to[2]).toBe(0);
  });

  it('a radius of an arc goes from the centre to the middle of the arc', () => {
    const r2 = views().find((d) => d.id === 'r2');
    expect(r2?.from).toEqual([0, 0, 0]);
    // The arc runs counter-clockwise from 0 to π/2: its middle is at π/4, radius |start − centre|.
    const h = 3 * Math.SQRT1_2;
    expect(r2?.to[0]).toBeCloseTo(h, 12);
    expect(r2?.to[1]).toBeCloseTo(h, 12);
  });

  it('the middle of an arc over angle 0 follows the counter-clockwise sweep', () => {
    // From π/2 to 0 counter-clockwise = three quarters; the middle is at 5π/4.
    const sketch = data(
      [
        { kind: 'point', id: 'o', x: 0, y: 0 },
        { kind: 'point', id: 's', x: 0, y: 2 },
        { kind: 'point', id: 'e', x: 2, y: 0 },
        { kind: 'arc', id: 'a', center: 'o', start: 's', end: 'e' },
      ],
      [{ kind: 'radius', id: 'r', curve: 'a', value: 2 }],
    );
    const [r] = views(sketch);
    expect(r?.to[0]).toBeCloseTo(-Math.SQRT2, 12);
    expect(r?.to[1]).toBeCloseTo(-Math.SQRT2, 12);
  });

  it('only distance and radius, numbered within their kind like the panel rows', () => {
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
    expect(next.find((d) => d.id === 'd1')?.from).toEqual([-1, 0, 0]);
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
