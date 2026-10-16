import { describe, expect, it } from 'vitest';
import type { Vec2 } from '@/core';
import { measure } from '@/sketch/edit';
import { chamferEdit, cornerOf, filletEdit } from '@/sketch/fillet';
import type { FilletRequest } from '@/sketch/fillet';
import { samePoint } from '@/sketch/curve-param';
import { curve2, pointsById } from '@/sketch/geometry';
import type { Curve2 } from '@/sketch/geometry';
import type {
  SketchConstraint,
  SketchConstraintId,
  SketchCurve,
  SketchData,
  SketchEntity,
  SketchEntityId,
} from '@/sketch/model';
import { parseSketchData } from '@/sketch/parse';
import { createFakeSketchGeometry, rectangleData } from '@/sketch/testing';
import type { IdSource, SketchEdit } from '@/sketch/trim';

// Test-only branding of literals: the ids of test data were parsed, these name them.
const id = (s: string): SketchEntityId => s as SketchEntityId;

function sketch(entities: readonly unknown[], constraints: readonly unknown[] = []): SketchData {
  const r = parseSketchData(entities, constraints);
  if (!r.ok) throw new Error(`invalid test sketch: ${JSON.stringify(r.error)}`);
  return r.value;
}

/** New ids n1, n2… for entities and k1, k2… for constraints. */
function idSource(): IdSource {
  let entities = 0;
  let constraints = 0;
  return {
    entity: () => id(`n${String(++entities)}`),
    // Test-only branding, like id().
    constraint: () => `k${String(++constraints)}` as SketchConstraintId,
  };
}

const geometry = createFakeSketchGeometry();

function entity(data: SketchData, name: string): SketchEntity | undefined {
  return data.entities.find((e) => e.id === name);
}

function curveOf(data: SketchData, name: string): Curve2 {
  const c = entity(data, name);
  if (c === undefined || c.kind === 'point') throw new Error(`no curve ${name}`);
  return curve2(c, pointsById(data));
}

function coords(data: SketchData, name: string): Vec2 {
  const p = entity(data, name);
  if (p?.kind !== 'point') throw new Error(`no point ${name}`);
  return [p.x, p.y];
}

function expectPoint(actual: Vec2, expected: Vec2): void {
  expect(actual[0]).toBeCloseTo(expected[0], 9);
  expect(actual[1]).toBeCloseTo(expected[1], 9);
}

/**
 * The edit, checked to be valid sketch data with every point before the curves that use it
 * (the invariant of spec 12, rule 4 of M33).
 */
function valid(edit: SketchEdit | null): SketchEdit {
  expect(edit).not.toBeNull();
  if (edit === null) throw new Error('no edit');
  const r = parseSketchData(edit.data.entities, edit.data.constraints);
  expect(r.ok ? [] : r.error).toEqual([]);
  const seen = new Set<string>();
  for (const e of edit.data.entities) {
    if (e.kind !== 'point') {
      const used =
        e.kind === 'line' ? [e.p1, e.p2] : e.kind === 'arc' ? [e.center, e.start, e.end] : [];
      for (const p of used) expect(seen.has(p), `${p} before ${e.id}`).toBe(true);
    }
    seen.add(e.id);
  }
  return edit;
}

/** The constraints the edit added to the data (not in the original). */
function newConstraints(before: SketchData, after: SketchData): readonly SketchConstraint[] {
  const old = new Set(before.constraints.map((c) => c.id));
  return after.constraints.filter((c) => !old.has(c.id));
}

/** A rectangle 10 × 5 with its width and height dimensioned through the corner b. */
function dimensionedRectangle(): SketchData {
  const r = rectangleData();
  return sketch(r.entities, [
    ...r.constraints,
    { kind: 'distance', id: 'w', a: 'a', b: 'b', value: 10 },
    { kind: 'distance', id: 'h', a: 'b', b: 'c', value: 5 },
  ]);
}

async function cornerFillet(
  data: SketchData,
  corner: string,
  radius: number,
): Promise<FilletRequest> {
  const pair = cornerOf(data, id(corner));
  if (pair === null) throw new Error(`no corner ${corner}`);
  // Inside the angle, like the tool: the corner + r · the unit sum of the directions of the lines.
  const at = coords(data, corner);
  const away = (line: string): Vec2 => {
    const c = curveOf(data, line);
    if (c.kind !== 'line') throw new Error(`not a line ${line}`);
    const end = samePoint(c.from, at) ? c.to : c.from;
    const d = Math.hypot(end[0] - at[0], end[1] - at[1]);
    return [(end[0] - at[0]) / d, (end[1] - at[1]) / d];
  };
  const [u, v] = [away(pair.a), away(pair.b)];
  const sum: Vec2 = [u[0] + v[0], u[1] + v[1]];
  const len = Math.hypot(...sum);
  const near: Vec2 = [at[0] + (radius * sum[0]) / len, at[1] + (radius * sum[1]) / len];
  const arc = await geometry.fillet(curveOf(data, pair.a), curveOf(data, pair.b), radius, near);
  return { a: pair.a, b: pair.b, corner: id(corner), radius, arc };
}

describe('cornerOf', () => {
  it('gives the two lines of a corner of a rectangle in the order of the entities', () => {
    const data = rectangleData();
    expect(cornerOf(data, id('b'))).toEqual({ a: 'ab', b: 'bc' });
    expect(cornerOf(data, id('a'))).toEqual({ a: 'ab', b: 'da' });
  });

  it('takes a line and an arc sharing an end point', () => {
    const data = sketch([
      { kind: 'point', id: 'p', x: 0, y: 0 },
      { kind: 'point', id: 'q', x: 10, y: 0 },
      { kind: 'point', id: 'o', x: 10, y: 5 },
      { kind: 'point', id: 'r', x: 15, y: 5 },
      { kind: 'line', id: 'l', p1: 'p', p2: 'q' },
      { kind: 'arc', id: 'k', center: 'o', start: 'q', end: 'r' },
    ]);
    expect(cornerOf(data, id('q'))).toEqual({ a: 'l', b: 'k' });
  });

  it('is null for a point of one curve, of three curves, a centre, a spline end or no point', () => {
    const data = sketch([
      { kind: 'point', id: 'p', x: 0, y: 0 },
      { kind: 'point', id: 'q', x: 10, y: 0 },
      { kind: 'point', id: 'r', x: 0, y: 10 },
      { kind: 'point', id: 's', x: -10, y: 0 },
      { kind: 'point', id: 't', x: 5, y: 5 },
      { kind: 'line', id: 'l1', p1: 'p', p2: 'q' },
      { kind: 'line', id: 'l2', p1: 'p', p2: 'r' },
      { kind: 'line', id: 'l3', p1: 's', p2: 'p' },
      { kind: 'circle', id: 'c', center: 'q', radius: 1 },
      { kind: 'bspline', id: 'sp', degree: 1, poles: ['r', 't'], knots: [0, 0, 1, 1] },
      { kind: 'line', id: 'l4', p1: 't', p2: 's' },
    ]);
    expect(cornerOf(data, id('p'))).toBeNull(); // three lines
    expect(cornerOf(data, id('q'))).toBeNull(); // one line end, a circle centre
    expect(cornerOf(data, id('t'))).toBeNull(); // a spline end and a line
    expect(cornerOf(data, id('l1'))).toBeNull(); // not a point
    expect(cornerOf(data, id('nope'))).toBeNull();
  });
});

describe('filletEdit', () => {
  it('rounds a corner of a rectangle: a tangent arc, the corner stays virtual', async () => {
    const data = dimensionedRectangle();
    const req = await cornerFillet(data, 'b', 1);
    const edit = valid(filletEdit(data, req, idSource()));
    const next = edit.data;

    // n1 = the point of contact on ab, n2 on bc, n3 the centre, n4 the arc.
    expectPoint(coords(next, 'n1'), [9, 0]);
    expectPoint(coords(next, 'n2'), [10, 1]);
    expectPoint(coords(next, 'n3'), [9, 1]);
    expect(entity(next, 'ab')).toMatchObject({ p1: 'a', p2: 'n1' });
    expect(entity(next, 'bc')).toMatchObject({ p1: 'n2', p2: 'c' });
    // Counter-clockwise from the contact on ab to the one on bc: a quarter turn.
    expect(entity(next, 'n4')).toEqual({
      kind: 'arc',
      id: 'n4',
      center: 'n3',
      start: 'n1',
      end: 'n2',
    });

    // The corner is a point no curve uses, held on both carriers; the dimensions survive.
    expectPoint(coords(next, 'b'), [10, 0]);
    const added = newConstraints(data, next);
    expect(added).toEqual([
      { kind: 'pointOnCurve', id: 'k1', point: 'b', curve: 'ab' },
      { kind: 'pointOnCurve', id: 'k2', point: 'b', curve: 'bc' },
      { kind: 'tangent', id: 'k3', a: 'n4', b: 'ab' },
      { kind: 'tangent', id: 'k4', a: 'n4', b: 'bc' },
      { kind: 'radius', id: 'k5', curve: 'n4', value: 1 },
    ]);
    expect(next.constraints.map((c) => c.id)).toEqual(
      expect.arrayContaining(['h1', 'v1', 'h2', 'v2', 'w', 'h']),
    );
    expect(edit.edit).toBe('k5');
    expect([...edit.added].sort()).toEqual(['k1', 'k2', 'k3', 'k4']);
  });

  it('turns the arc counter-clockwise whatever the order of the curves', async () => {
    const data = rectangleData();
    const arc = await geometry.fillet(curveOf(data, 'bc'), curveOf(data, 'ab'), 1, [9.5, 0.5]);
    const req = { a: id('bc'), b: id('ab'), corner: id('b'), radius: 1, arc };
    const next = valid(filletEdit(data, req, idSource())).data;
    // n1 = the contact on bc (the curve a), n2 on ab: the arc runs from n2 round to n1.
    expectPoint(coords(next, 'n1'), [10, 1]);
    expectPoint(coords(next, 'n2'), [9, 0]);
    expect(entity(next, 'n4')).toMatchObject({ center: 'n3', start: 'n2', end: 'n1' });
  });

  it('rounds the corner of a rectangle at d (the lines c → d → a)', async () => {
    const data = rectangleData();
    const next = valid(filletEdit(data, await cornerFillet(data, 'd', 2), idSource())).data;
    expectPoint(coords(next, 'n3'), [2, 3]);
    expect(entity(next, 'n4')).toMatchObject({ center: 'n3', start: 'n1', end: 'n2' });
    expectPoint(coords(next, 'n1'), [2, 5]);
    expectPoint(coords(next, 'n2'), [0, 3]);
  });

  it('rounds a corner of a line and an arc', async () => {
    // A line up the x = 10 into q = (10, 0), then an arc around (10, 10) from q counter-clockwise
    // (leaving q along +x): a corner of 90°.
    const corner = sketch([
      { kind: 'point', id: 'p', x: 10, y: -10 },
      { kind: 'point', id: 'q', x: 10, y: 0 },
      { kind: 'point', id: 'o', x: 10, y: 10 },
      { kind: 'point', id: 'r', x: 20, y: 10 },
      { kind: 'line', id: 'l', p1: 'p', p2: 'q' },
      { kind: 'arc', id: 'k', center: 'o', start: 'q', end: 'r' },
    ]);
    const pair = cornerOf(corner, id('q'));
    expect(pair).toEqual({ a: 'l', b: 'k' });
    const arc = await geometry.fillet(curveOf(corner, 'l'), curveOf(corner, 'k'), 1, [11, -1]);
    const edit = valid(
      filletEdit(corner, { a: id('l'), b: id('k'), corner: id('q'), radius: 1, arc }, idSource()),
    );
    const next = edit.data;
    // The centre 1 from the line x = 10 and 11 from the centre of the arc (outside it).
    const c = coords(next, 'n3');
    expect(c[0]).toBeCloseTo(11, 9);
    expect(Math.hypot(c[0] - 10, c[1] - 10)).toBeCloseTo(11, 9);
    expect(entity(next, 'l')).toMatchObject({ p1: 'p', p2: 'n1' });
    expect(entity(next, 'k')).toMatchObject({ start: 'n2', end: 'r' });
    expect(newConstraints(corner, next).map((k) => k.kind)).toEqual([
      'pointOnCurve',
      'pointOnCurve',
      'tangent',
      'tangent',
      'radius',
    ]);
    // The fillet arc is short and on the side of the corner.
    const fillet = entity(next, 'n4');
    if (fillet?.kind !== 'arc') throw new Error('no fillet arc');
    const sweep = sweepOf(next, fillet.id);
    expect(sweep).toBeGreaterThan(0);
    expect(sweep).toBeLessThan(Math.PI);
  });

  it('extends two lines that do not meet to the points of contact', async () => {
    // A horizontal line ending at x = 5 and a vertical one starting at y = 2 on x = 10.
    const data = sketch(
      [
        { kind: 'point', id: 'p', x: 0, y: 0 },
        { kind: 'point', id: 'q', x: 5, y: 0 },
        { kind: 'point', id: 'r', x: 10, y: 2 },
        { kind: 'point', id: 's', x: 10, y: 8 },
        { kind: 'line', id: 'h', p1: 'p', p2: 'q' },
        { kind: 'line', id: 'v', p1: 'r', p2: 's' },
      ],
      [
        { kind: 'fix', id: 'fq', point: 'q' },
        { kind: 'horizontal', id: 'hh', line: 'h' },
      ],
    );
    const arc = await geometry.fillet(curveOf(data, 'h'), curveOf(data, 'v'), 1, [8, 1]);
    expect(arc.ta).toBeCloseTo(9 / 5, 9); // on the extension of h
    expect(arc.tb).toBeCloseTo(-1 / 6, 9); // on the extension of v
    const edit = valid(filletEdit(data, { a: id('h'), b: id('v'), radius: 1, arc }, idSource()));
    const next = edit.data;
    expect(entity(next, 'h')).toMatchObject({ p1: 'p', p2: 'n1' });
    expect(entity(next, 'v')).toMatchObject({ p1: 'n2', p2: 's' });
    expectPoint(coords(next, 'n1'), [9, 0]);
    expectPoint(coords(next, 'n2'), [10, 1]);
    // The old ends nothing uses any more are gone (rule 2 of M33), with their constraints.
    expect(entity(next, 'q')).toBeUndefined();
    expect(entity(next, 'r')).toBeUndefined();
    expect(next.constraints.map((c) => c.id)).toEqual(['hh', 'k1', 'k2', 'k3']);
    expect(newConstraints(data, next).map((c) => c.kind)).toEqual(['tangent', 'tangent', 'radius']);
    expect(edit.edit).toBe('k3');
  });

  it('keeps an old end another curve still uses', async () => {
    const data = sketch([
      { kind: 'point', id: 'p', x: 0, y: 0 },
      { kind: 'point', id: 'q', x: 5, y: 0 },
      { kind: 'point', id: 'r', x: 10, y: 2 },
      { kind: 'point', id: 's', x: 10, y: 8 },
      { kind: 'point', id: 't', x: 5, y: -5 },
      { kind: 'line', id: 'h', p1: 'p', p2: 'q' },
      { kind: 'line', id: 'v', p1: 'r', p2: 's' },
      { kind: 'line', id: 'w', p1: 'q', p2: 't' },
    ]);
    const arc = await geometry.fillet(curveOf(data, 'h'), curveOf(data, 'v'), 1, [8, 1]);
    const next = valid(
      filletEdit(data, { a: id('h'), b: id('v'), radius: 1, arc }, idSource()),
    ).data;
    expect(entity(next, 'q')).toBeDefined();
    expect(entity(next, 'r')).toBeUndefined();
  });

  it('drops equal of an edited line (its length changed, rule 3 of M33)', async () => {
    const r = rectangleData();
    const data = sketch(r.entities, [
      ...r.constraints,
      { kind: 'equal', id: 'eq', a: 'ab', b: 'cd' },
    ]);
    const next = valid(filletEdit(data, await cornerFillet(data, 'b', 1), idSource())).data;
    expect(next.constraints.find((c) => c.id === 'eq')).toBeUndefined();
  });

  it('is null for a radius that eats a whole line, and for a wrong request', async () => {
    const data = rectangleData();
    // 10 × 5: a radius of 6 puts the contact on bc above c.
    expect(filletEdit(data, await cornerFillet(data, 'b', 6), idSource())).toBeNull();
    // A radius of 5 shortens bc to nothing.
    expect(filletEdit(data, await cornerFillet(data, 'b', 5), idSource())).toBeNull();

    const ok = await cornerFillet(data, 'b', 1);
    expect(filletEdit(data, { ...ok, corner: id('d') }, idSource())).toBeNull();
    expect(filletEdit(data, { ...ok, b: id('nope') }, idSource())).toBeNull();
    expect(filletEdit(data, { ...ok, b: ok.a }, idSource())).toBeNull();
    expect(filletEdit(data, { ...ok, radius: 0 }, idSource())).toBeNull();
  });

  it('makes a construction arc only between two construction curves', async () => {
    const r = rectangleData();
    const entities = r.entities.map((e) =>
      e.kind === 'line' ? { ...e, construction: true as const } : e,
    );
    const data = sketch(entities, r.constraints);
    const next = valid(filletEdit(data, await cornerFillet(data, 'b', 1), idSource())).data;
    expect(entity(next, 'n4')).toMatchObject({ kind: 'arc', construction: true });

    const mixed = sketch(
      r.entities.map((e) => (e.id === 'ab' ? { ...e, construction: true as const } : e)),
      r.constraints,
    );
    const plain = valid(filletEdit(mixed, await cornerFillet(mixed, 'b', 1), idSource())).data;
    expect(entity(plain, 'n4')).not.toHaveProperty('construction');
  });
});

describe('chamferEdit', () => {
  it('cuts a corner of a rectangle with two equal distances', () => {
    const data = dimensionedRectangle();
    const edit = valid(
      chamferEdit(
        data,
        {
          corner: id('b'),
          a: id('ab'),
          b: id('bc'),
          pointA: [8, 0],
          pointB: [10, 2],
          distance: 2,
        },
        idSource(),
      ),
    );
    const next = edit.data;
    expectPoint(coords(next, 'n1'), [8, 0]);
    expectPoint(coords(next, 'n2'), [10, 2]);
    expect(entity(next, 'ab')).toMatchObject({ p1: 'a', p2: 'n1' });
    expect(entity(next, 'bc')).toMatchObject({ p1: 'n2', p2: 'c' });
    expect(entity(next, 'n3')).toEqual({ kind: 'line', id: 'n3', p1: 'n1', p2: 'n2' });
    expectPoint(coords(next, 'b'), [10, 0]);
    expect(newConstraints(data, next)).toEqual([
      { kind: 'pointOnCurve', id: 'k1', point: 'b', curve: 'ab' },
      { kind: 'pointOnCurve', id: 'k2', point: 'b', curve: 'bc' },
      { kind: 'distance', id: 'k3', a: 'b', b: 'n1', value: 2 },
      { kind: 'distance', id: 'k4', a: 'b', b: 'n2', value: 2 },
    ]);
    expect(next.constraints.map((c) => c.id)).toEqual(
      expect.arrayContaining(['h1', 'v1', 'h2', 'v2', 'w', 'h']),
    );
    expect(edit.edit).toBe('k3');
    expect([...edit.added].sort()).toEqual(['k1', 'k2']);
  });

  it('cuts a corner with a distance and an angle to the reference line', () => {
    const data = rectangleData();
    // Reference ab (its corner end is p2): 2 along ab, 30° from it up to bc.
    const up = 2 * Math.tan(Math.PI / 6);
    const edit = valid(
      chamferEdit(
        data,
        {
          corner: id('b'),
          a: id('ab'),
          b: id('bc'),
          pointA: [8, 0],
          pointB: [10, up],
          distance: 2,
          angle: Math.PI / 6,
        },
        idSource(),
      ),
    );
    const angle = edit.data.constraints.find((c) => c.kind === 'angle');
    expect(angle).toMatchObject({ kind: 'angle', id: 'k4', a: 'n3', b: 'ab', value: Math.PI / 6 });
    if (angle?.kind !== 'angle') return;
    expect(measure(edit.data, angle)).toBeCloseTo(Math.PI / 6, 9);
    expect(edit.edit).toBe('k3');

    // Reference bc (its corner end is p1): the angle reverses it.
    const turned = valid(
      chamferEdit(
        data,
        {
          corner: id('b'),
          a: id('bc'),
          b: id('ab'),
          pointA: [10, 2],
          pointB: [10 - up, 0],
          distance: 2,
          angle: Math.PI / 6,
        },
        idSource(),
      ),
    );
    const other = turned.data.constraints.find((c) => c.kind === 'angle');
    expect(other).toMatchObject({ a: 'n3', b: 'bc', reverseB: true });
    if (other?.kind !== 'angle') return;
    expect(measure(turned.data, other)).toBeCloseTo(Math.PI / 6, 9);
    expect(entity(turned.data, 'bc')).toMatchObject({ p1: 'n1', p2: 'c' });
  });

  it('cuts a corner of a line and an arc', () => {
    const data = sketch([
      { kind: 'point', id: 'p', x: 10, y: -10 },
      { kind: 'point', id: 'q', x: 10, y: 0 },
      { kind: 'point', id: 'o', x: 10, y: 10 },
      { kind: 'point', id: 'r', x: 20, y: 10 },
      { kind: 'line', id: 'l', p1: 'p', p2: 'q' },
      { kind: 'arc', id: 'k', center: 'o', start: 'q', end: 'r' },
    ]);
    const onArc: Vec2 = [10 + 10 * Math.sin(0.2), 10 - 10 * Math.cos(0.2)];
    const next = valid(
      chamferEdit(
        data,
        { corner: id('q'), a: id('l'), b: id('k'), pointA: [10, -2], pointB: onArc, distance: 2 },
        idSource(),
      ),
    ).data;
    expect(entity(next, 'k')).toMatchObject({ center: 'o', start: 'n2', end: 'r' });
    expect(entity(next, 'n3')).toMatchObject({ kind: 'line', p1: 'n1', p2: 'n2' });
  });

  it('is null for a point off the curve, past its end, an arc reference with an angle', () => {
    const data = rectangleData();
    const req = {
      corner: id('b'),
      a: id('ab'),
      b: id('bc'),
      pointA: [8, 0] as Vec2,
      pointB: [10, 2] as Vec2,
      distance: 2,
    };
    expect(chamferEdit(data, { ...req, pointB: [10, 6] }, idSource())).toBeNull(); // past c
    expect(chamferEdit(data, { ...req, pointB: [10, 5] }, idSource())).toBeNull(); // at c
    expect(chamferEdit(data, { ...req, pointA: [8, 1] }, idSource())).toBeNull(); // off ab
    expect(chamferEdit(data, { ...req, pointA: [10, 0] }, idSource())).toBeNull(); // the corner
    expect(chamferEdit(data, { ...req, corner: id('a') }, idSource())).toBeNull();
    expect(chamferEdit(data, { ...req, distance: 0 }, idSource())).toBeNull();
    expect(chamferEdit(data, { ...req, angle: Math.PI }, idSource())).toBeNull();

    const arcCorner = sketch([
      { kind: 'point', id: 'p', x: 10, y: -10 },
      { kind: 'point', id: 'q', x: 10, y: 0 },
      { kind: 'point', id: 'o', x: 10, y: 10 },
      { kind: 'point', id: 'r', x: 20, y: 10 },
      { kind: 'line', id: 'l', p1: 'p', p2: 'q' },
      { kind: 'arc', id: 'k', center: 'o', start: 'q', end: 'r' },
    ]);
    const onArc: Vec2 = [10 + 10 * Math.sin(0.2), 10 - 10 * Math.cos(0.2)];
    expect(
      chamferEdit(
        arcCorner,
        {
          corner: id('q'),
          a: id('k'),
          b: id('l'),
          pointA: onArc,
          pointB: [10, -2],
          distance: 2,
          angle: Math.PI / 4,
        },
        idSource(),
      ),
    ).toBeNull();
  });
});

/** The swept angle of an arc of the data, counter-clockwise from start to end, in (0, 2π). */
function sweepOf(data: SketchData, arcId: string): number {
  const c = entity(data, arcId) as SketchCurve | undefined;
  if (c?.kind !== 'arc') throw new Error(`no arc ${arcId}`);
  const o = coords(data, c.center);
  const s = coords(data, c.start);
  const e = coords(data, c.end);
  const a = Math.atan2(e[1] - o[1], e[0] - o[0]) - Math.atan2(s[1] - o[1], s[0] - o[0]);
  return ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
}
