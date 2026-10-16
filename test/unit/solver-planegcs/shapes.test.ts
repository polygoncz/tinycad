import { beforeAll, describe, expect, it } from 'vitest';
import type { Vec2 } from '@/core';
import {
  arcSlotFrom,
  arcSlotShape,
  parseSketchData,
  rectangle3Shape,
  rectangleCenterShape,
  rectangleFrom3,
  rectangleFromCenter,
  slotFromCenters,
  slotFromEnds,
  slotOverallShape,
  slotShape,
  type ShapeDraft,
  type ShapeIds,
  type SketchConstraintId,
  type SketchData,
  type SketchEntityId,
  type SolveResult,
} from '@/sketch';
import { loadPlanegcs, type PlanegcsModule } from '@/solver-planegcs/planegcs-module';
import { solveSketch } from '@/solver-planegcs/solve';

// The rectangles and slots of M31 (spec 12 "Nové kreslicí nástroje (M31)") against the real
// planegcs in Node: each shape from its position and topology functions has the degrees of
// freedom of the table "Vazby tvarů" without redundant constraints, and stays the shape after one
// dimension changes.

let mod: PlanegcsModule;

beforeAll(async () => {
  mod = await loadPlanegcs();
});

const id = (s: string): SketchEntityId => s as SketchEntityId; // test-only branding of literals

function sequentialIds(): ShapeIds {
  let e = 0;
  let k = 0;
  return {
    entity: () => id(`e${String(++e)}`),
    constraint: () => `k${String(++k)}` as SketchConstraintId, // test-only branding of literals
  };
}

/** The points, the shape and extra constraints through the trusted parser. */
function sketch(
  points: Readonly<Record<string, Vec2>>,
  draft: ShapeDraft,
  extra: readonly unknown[] = [],
): SketchData {
  const entities = [
    ...Object.entries(points).map(([pid, [x, y]]) => ({ kind: 'point', id: pid, x, y })),
    ...draft.curves,
  ];
  const parsed = parseSketchData(entities, [...draft.constraints, ...extra]);
  if (!parsed.ok) throw new Error(`invalid test sketch: ${JSON.stringify(parsed.error)}`);
  return parsed.value;
}

/** The solved point coordinates by id. */
function solved(result: SolveResult): (pid: string) => Vec2 {
  expect(result).toMatchObject({ status: 'ok', conflicting: [], redundant: [] });
  const points = new Map<string, Vec2>();
  for (const e of result.entities ?? []) if (e.kind === 'point') points.set(e.id, [e.x, e.y]);
  return (pid) => {
    const p = points.get(pid);
    if (p === undefined) throw new Error(`no point ${pid}`);
    return p;
  };
}

const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
const dot = (a: Vec2, b: Vec2): number => a[0] * b[0] + a[1] * b[1];
const cross = (a: Vec2, b: Vec2): number => a[0] * b[1] - a[1] * b[0];
const dist = (a: Vec2, b: Vec2): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
const unit = (a: Vec2): Vec2 => [a[0] / Math.hypot(...a), a[1] / Math.hypot(...a)];

const DIGITS = 6;

describe('rectangle by centre', () => {
  const corners = [id('a'), id('b'), id('c'), id('d')] as const;
  const draft = rectangleCenterShape(corners, id('m'), sequentialIds());
  const fit = rectangleFromCenter([1, 2], [4, 4]);
  if (fit === null) throw new Error('no rectangle');
  const points = { a: fit[0], b: fit[1], c: fit[2], d: fit[3], m: [1, 2] as Vec2 };

  it('has 4 degrees of freedom (centre, width, height)', () => {
    expect(solveSketch(mod, sketch(points, draft))).toMatchObject({
      status: 'ok',
      dof: 4,
      redundant: [],
    });
  });

  it('stays an axis-parallel rectangle around its centre after a width dimension', () => {
    const width = { kind: 'hDistance', id: 'w', a: 'a', b: 'b', value: 10 };
    const result = solveSketch(mod, sketch(points, draft, [width]));
    expect(result.dof).toBe(3);
    const p = solved(result);
    expect(Math.abs(p('b')[0] - p('a')[0])).toBeCloseTo(10, DIGITS);
    expect(p('b')[1]).toBeCloseTo(p('a')[1], DIGITS);
    expect(p('c')[0]).toBeCloseTo(p('b')[0], DIGITS);
    expect(p('d')[1]).toBeCloseTo(p('c')[1], DIGITS);
    expect(p('a')[0]).toBeCloseTo(p('d')[0], DIGITS);
    expect(p('m')[0]).toBeCloseTo((p('a')[0] + p('c')[0]) / 2, DIGITS);
    expect(p('m')[1]).toBeCloseTo((p('a')[1] + p('c')[1]) / 2, DIGITS);
  });
});

describe('rectangle by 3 points', () => {
  const draft = rectangle3Shape([id('a'), id('b'), id('c'), id('d')], sequentialIds());
  const fit = rectangleFrom3([1, 1], [4, 5], [3, 7]);
  if (fit === null) throw new Error('no rectangle');
  const points = { a: fit[0], b: fit[1], c: fit[2], d: fit[3] };

  it('has 5 degrees of freedom (+ rotation)', () => {
    expect(solveSketch(mod, sketch(points, draft))).toMatchObject({
      status: 'ok',
      dof: 5,
      redundant: [],
    });
  });

  it('keeps its right angles after a length dimension', () => {
    const length = { kind: 'distance', id: 'w', a: 'a', b: 'b', value: 8 };
    const result = solveSketch(mod, sketch(points, draft, [length]));
    expect(result.dof).toBe(4);
    const p = solved(result);
    const ab = unit(sub(p('b'), p('a')));
    const bc = unit(sub(p('c'), p('b')));
    const cd = unit(sub(p('d'), p('c')));
    const da = unit(sub(p('a'), p('d')));
    expect(dist(p('a'), p('b'))).toBeCloseTo(8, DIGITS);
    expect(dot(ab, bc)).toBeCloseTo(0, DIGITS);
    expect(dot(bc, cd)).toBeCloseTo(0, DIGITS);
    expect(dot(cd, da)).toBeCloseTo(0, DIGITS);
    expect(dot(da, ab)).toBeCloseTo(0, DIGITS);
  });
});

/** The straight slot invariants: equal radii r, tangent sides (radius ⟂ side in each shared point). */
function expectStraightSlot(p: (pid: string) => Vec2, r: number): void {
  for (const [c, q] of [
    ['c1', 'l1'],
    ['c1', 'r1'],
    ['c2', 'l2'],
    ['c2', 'r2'],
  ] as const)
    expect(dist(p(c), p(q))).toBeCloseTo(r, DIGITS);
  const left = sub(p('l2'), p('l1'));
  const right = sub(p('r1'), p('r2'));
  for (const [c, q, side] of [
    ['c1', 'l1', left],
    ['c2', 'l2', left],
    ['c2', 'r2', right],
    ['c1', 'r1', right],
  ] as const)
    expect(dot(sub(p(q), p(c)), side)).toBeCloseTo(0, DIGITS);
}

describe('slot centre to centre', () => {
  const draft = slotShape(
    { c1: id('c1'), c2: id('c2'), l1: id('l1'), l2: id('l2'), r2: id('r2'), r1: id('r1') },
    sequentialIds(),
  );
  const fit = slotFromCenters([1, 1], [9, 4], [4, 6]);
  if (fit === null) throw new Error('no slot');
  const points = { c1: fit.c1, c2: fit.c2, l1: fit.l1, l2: fit.l2, r2: fit.r2, r1: fit.r1 };

  it('has 5 degrees of freedom (2 centres, radius)', () => {
    expect(solveSketch(mod, sketch(points, draft))).toMatchObject({
      status: 'ok',
      dof: 5,
      redundant: [],
    });
  });

  it('stays a slot after a radius dimension', () => {
    const radius = { kind: 'radius', id: 'r', curve: draft.curves[3]?.id, value: 1.5 };
    const result = solveSketch(mod, sketch(points, draft, [radius]));
    expect(result.dof).toBe(4);
    expectStraightSlot(solved(result), 1.5);
  });
});

describe('slot by overall length', () => {
  const draft = slotOverallShape(
    {
      e1: id('p1'),
      e2: id('p2'),
      c1: id('c1'),
      c2: id('c2'),
      l1: id('l1'),
      l2: id('l2'),
      r2: id('r2'),
      r1: id('r1'),
    },
    sequentialIds(),
  );
  const fit = slotFromEnds([0, 0], [12, 5], [3, 3]);
  if (fit === null) throw new Error('no slot');
  const points = {
    p1: [0, 0] as Vec2,
    p2: [12, 5] as Vec2,
    c1: fit.c1,
    c2: fit.c2,
    l1: fit.l1,
    l2: fit.l2,
    r2: fit.r2,
    r1: fit.r1,
  };

  it('has 5 degrees of freedom', () => {
    expect(solveSketch(mod, sketch(points, draft))).toMatchObject({
      status: 'ok',
      dof: 5,
      redundant: [],
    });
  });

  it('stays a slot with its ends on the axis after a length dimension', () => {
    const length = { kind: 'distance', id: 'L', a: 'p1', b: 'p2', value: 20 };
    const result = solveSketch(mod, sketch(points, draft, [length]));
    expect(result.dof).toBe(4);
    const p = solved(result);
    const r = dist(p('c1'), p('l1'));
    expectStraightSlot(p, r);
    expect(dist(p('p1'), p('p2'))).toBeCloseTo(20, DIGITS);
    const axis = sub(p('p2'), p('p1'));
    expect(cross(axis, sub(p('c1'), p('p1')))).toBeCloseTo(0, DIGITS);
    expect(cross(axis, sub(p('c2'), p('p1')))).toBeCloseTo(0, DIGITS);
    expect(dist(p('p1'), p('c1'))).toBeCloseTo(r, DIGITS);
    expect(dist(p('p2'), p('c2'))).toBeCloseTo(r, DIGITS);
  });
});

describe('arc slot', () => {
  const draft = arcSlotShape(
    {
      center: id('o'),
      start: id('s'),
      end: id('e'),
      innerStart: id('is'),
      innerEnd: id('ie'),
      outerStart: id('os'),
      outerEnd: id('oe'),
    },
    sequentialIds(),
  );
  const fit = arcSlotFrom([1, 2], [11, 2], [1, 30], [1, 11]);
  if (fit === null) throw new Error('no slot');
  const points = {
    o: fit.center,
    s: fit.start,
    e: fit.end,
    is: fit.innerStart,
    ie: fit.innerEnd,
    os: fit.outerStart,
    oe: fit.outerEnd,
  };

  it('has 6 degrees of freedom (centre, radius, 2 angles, width)', () => {
    expect(solveSketch(mod, sketch(points, draft))).toMatchObject({
      status: 'ok',
      dof: 6,
      redundant: [],
    });
  });

  it('stays an arc slot of the new width after an end arc radius dimension', () => {
    const half = { kind: 'radius', id: 'w', curve: draft.curves[2]?.id, value: 2 };
    const result = solveSketch(mod, sketch(points, draft, [half]));
    expect(result.dof).toBe(5);
    const p = solved(result);
    const inner = dist(p('o'), p('is'));
    const outer = dist(p('o'), p('os'));
    expect(dist(p('o'), p('ie'))).toBeCloseTo(inner, DIGITS);
    expect(dist(p('o'), p('oe'))).toBeCloseTo(outer, DIGITS);
    expect(outer - inner).toBeCloseTo(4, DIGITS);
    // Both end arcs have the half width as radius and are tangent: their centres lie on the ray
    // from the centre through their shared points, in the middle of the axis circle.
    for (const [c, a, b] of [
      ['s', 'is', 'os'],
      ['e', 'ie', 'oe'],
    ] as const) {
      expect(dist(p(c), p(a))).toBeCloseTo(2, DIGITS);
      expect(dist(p(c), p(b))).toBeCloseTo(2, DIGITS);
      expect(cross(sub(p(a), p('o')), sub(p(c), p('o')))).toBeCloseTo(0, DIGITS);
      expect(dist(p('o'), p(c))).toBeCloseTo((inner + outer) / 2, DIGITS);
    }
  });
});
