import { beforeAll, describe, expect, it } from 'vitest';
import { parseSketchData, type SketchData, type SketchEntity } from '@/sketch';
import { loadPlanegcs, type PlanegcsModule } from '@/solver-planegcs/planegcs-module';
import { solveSketch } from '@/solver-planegcs/solve';

// The offset constraint (M35) against the real planegcs in Node (spec 12 "Offset (M35)", Vazba
// offset, Řešič): a line pair is two point–line distances, an arc or circle pair a signed
// difference of the radii; the copy follows the value and the original.

let mod: PlanegcsModule;

beforeAll(async () => {
  mod = await loadPlanegcs();
});

/** Brands raw data through the trusted parser; invalid test data is a test bug. */
function sketch(entities: readonly unknown[], constraints: readonly unknown[]): SketchData {
  const parsed = parseSketchData(entities, constraints);
  if (!parsed.ok) throw new Error(`invalid test sketch: ${JSON.stringify(parsed.error)}`);
  return parsed.value;
}

type XY = readonly [number, number];

function points(at: Readonly<Record<string, XY>>): unknown[] {
  return Object.entries(at).map(([id, [x, y]]) => ({ kind: 'point', id, x, y }));
}

function line(id: string, p1: string, p2: string): unknown {
  return { kind: 'line', id, p1, p2 };
}

function arc(id: string, center: string, start: string, end: string): unknown {
  return { kind: 'arc', id, center, start, end };
}

function fix(...ids: readonly string[]): unknown[] {
  return ids.map((id) => ({ kind: 'fix', id: `f${id}`, point: id }));
}

function offset(value: number, pairs: readonly (readonly [string, string])[]): unknown {
  return {
    kind: 'offset',
    id: 'off',
    pairs: pairs.map(([source, copy]) => ({ source, copy })),
    value,
  };
}

function solved(data: SketchData): readonly SketchEntity[] {
  const result = solveSketch(mod, data);
  expect(result).toMatchObject({ status: 'ok', conflicting: [], redundant: [] });
  if (result.entities === null) throw new Error('no entities');
  return result.entities;
}

function expectPoints(
  entities: readonly SketchEntity[],
  expected: Readonly<Record<string, XY>>,
): void {
  for (const [id, [x, y]] of Object.entries(expected)) {
    const p = entities.find((e) => e.id === id);
    if (p?.kind !== 'point') throw new Error(`no point ${id}`);
    expect(p.x, `${id}.x`).toBeCloseTo(x, 7);
    expect(p.y, `${id}.y`).toBeCloseTo(y, 7);
  }
}

function radiusOf(entities: readonly SketchEntity[], id: string): number {
  const c = entities.find((e) => e.id === id);
  if (c?.kind !== 'circle') throw new Error(`no circle ${id}`);
  return c.radius;
}

/** The corners of an axis-aligned rectangle a b c d (counter-clockwise from bottom left). */
function corners(
  names: readonly [string, string, string, string],
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): Record<string, XY> {
  const [a, b, c, d] = names;
  return { [a]: [x0, y0], [b]: [x1, y0], [c]: [x1, y1], [d]: [x0, y1] };
}

const RECT_PAIRS = [
  ['ab', 'AB'],
  ['bc', 'BC'],
  ['cd', 'CD'],
  ['da', 'DA'],
] as const;

/**
 * Rectangle a b c d 10 × 5 from the origin, fully defined (h/v, width W, height H, a fixed), and
 * its copy A B C D at `copy` with no constraints of its own: the copy corners are shared.
 */
function offsetRectangle(
  copy: readonly [number, number, number, number],
  value: number,
  width = 10,
): SketchData {
  return sketch(
    [
      ...points(corners(['a', 'b', 'c', 'd'], 0, 0, 10, 5)),
      line('ab', 'a', 'b'),
      line('bc', 'b', 'c'),
      line('cd', 'c', 'd'),
      line('da', 'd', 'a'),
      ...points(corners(['A', 'B', 'C', 'D'], ...copy)),
      line('AB', 'A', 'B'),
      line('BC', 'B', 'C'),
      line('CD', 'C', 'D'),
      line('DA', 'D', 'A'),
    ],
    [
      { kind: 'horizontal', id: 'h1', line: 'ab' },
      { kind: 'vertical', id: 'v1', line: 'bc' },
      { kind: 'horizontal', id: 'h2', line: 'cd' },
      { kind: 'vertical', id: 'v2', line: 'da' },
      { kind: 'distance', id: 'W', a: 'a', b: 'b', value: width },
      { kind: 'distance', id: 'H', a: 'b', b: 'c', value: 5 },
      ...fix('a'),
      offset(value, RECT_PAIRS),
    ],
  );
}

describe('solveSketch – offset of a rectangle', () => {
  it('the value moves every side of the copy', () => {
    const entities = solved(offsetRectangle([-1, -1, 11, 6], 2));
    expectPoints(entities, corners(['A', 'B', 'C', 'D'], -2, -2, 12, 7));
  });

  // A small step: p2l_distance is unsigned, so a large change of the original (10 → 15) may
  // flip a copy side over to the other side of its source, like pointLineDistance (accepted).
  it('the copy follows a changed width of the original', () => {
    const entities = solved(offsetRectangle([-1, -1, 11, 6], 1, 12));
    expectPoints(entities, corners(['a', 'b', 'c', 'd'], 0, 0, 12, 5));
    expectPoints(entities, corners(['A', 'B', 'C', 'D'], -1, -1, 13, 6));
  });

  it('fully defines the copy: dof 0 with the original fully defined', () => {
    expect(solveSketch(mod, offsetRectangle([-1, -1, 11, 6], 1)).dof).toBe(0);
  });

  it('inward: the copy stays inside and shrinks with the value', () => {
    const entities = solved(offsetRectangle([1, 1, 9, 4], 2));
    expectPoints(entities, corners(['A', 'B', 'C', 'D'], 2, 2, 8, 3));
  });

  it('a conflict with another constraint on the copy reports the offset id', () => {
    const data = offsetRectangle([-1, -1, 11, 6], 1);
    const conflicting = sketch(data.entities, [
      ...data.constraints,
      { kind: 'distance', id: 'Wc', a: 'A', b: 'B', value: 30 },
    ]);
    const result = solveSketch(mod, conflicting);
    expect(result.status).toBe('conflict');
    expect(result.conflicting).toContain('off');
    expect(result.conflicting.every((id) => !id.includes(':'))).toBe(true);
  });
});

/**
 * A rounded rectangle 12 × 8 with corner radius 2 (counter-clockwise: bottom line, arc, right
 * line, …), the centres and the arc starts fixed, a tangent at every arc end: dof 0. `prefix`
 * names the points, lines and arcs; the centres are always o1–o4 (shared by a copy).
 */
function roundedRectangle(prefix: string, r: number): { entities: unknown[]; names: string[] } {
  const n = (s: string) => `${prefix}${s}`;
  const at: Record<string, XY> = {
    [n('b1')]: [2, 2 - r],
    [n('b2')]: [10, 2 - r],
    [n('r1')]: [10 + r, 2],
    [n('r2')]: [10 + r, 6],
    [n('t1')]: [10, 6 + r],
    [n('t2')]: [2, 6 + r],
    [n('l1')]: [2 - r, 6],
    [n('l2')]: [2 - r, 2],
  };
  return {
    entities: [
      ...points(at),
      line(n('B'), n('b1'), n('b2')),
      arc(n('SE'), 'o2', n('b2'), n('r1')),
      line(n('R'), n('r1'), n('r2')),
      arc(n('NE'), 'o3', n('r2'), n('t1')),
      line(n('T'), n('t1'), n('t2')),
      arc(n('NW'), 'o4', n('t2'), n('l1')),
      line(n('L'), n('l1'), n('l2')),
      arc(n('SW'), 'o1', n('l2'), n('b1')),
    ],
    names: Object.keys(at),
  };
}

const CENTRES: Record<string, XY> = { o1: [2, 2], o2: [10, 2], o3: [10, 6], o4: [2, 6] };

const ROUND_PAIRS = ['B', 'SE', 'R', 'NE', 'T', 'NW', 'L', 'SW'].map(
  (id) => [id, `x${id}`] as const,
);

function offsetRounded(copyRadius: number, value: number): SketchData {
  const original = roundedRectangle('', 2);
  const copy = roundedRectangle('x', copyRadius);
  const tangent = (id: string, a: string, b: string) => ({ kind: 'tangent', id, a, b });
  return sketch(
    [...points(CENTRES), ...original.entities, ...copy.entities],
    [
      ...fix('o1', 'o2', 'o3', 'o4', 'b2', 'r2', 't2', 'l2'),
      tangent('g1', 'SE', 'R'),
      tangent('g2', 'NE', 'T'),
      tangent('g3', 'NW', 'L'),
      tangent('g4', 'SW', 'B'),
      offset(value, ROUND_PAIRS),
    ],
  );
}

/** The copy points of a rounded rectangle with radius r around the fixed centres. */
function roundedCopy(r: number): Record<string, XY> {
  return {
    xb1: [2, 2 - r],
    xb2: [10, 2 - r],
    xr1: [10 + r, 2],
    xr2: [10 + r, 6],
    xt1: [10, 6 + r],
    xt2: [2, 6 + r],
    xl1: [2 - r, 6],
    xl2: [2 - r, 2],
  };
}

// The copy lines are tangent to the copy arcs in their shared ends: tangents there instead of
// distances (no double root). Known limit, not tested: two copy arcs tangent in a shared point
// stay degenerate (a point on two tangent circles).
describe('solveSketch – offset of a rounded rectangle', () => {
  it('fully defines the copy without a redundancy: dof 0', () => {
    expect(solveSketch(mod, offsetRounded(3, 1))).toMatchObject({
      status: 'ok',
      dof: 0,
      redundant: [],
    });
  });

  it('outward: the value moves the lines and grows the arcs around the shared centres', () => {
    const entities = solved(offsetRounded(3, 1.5));
    expectPoints(entities, roundedCopy(3.5));
  });

  it('inward: the copy arcs keep the smaller radius', () => {
    const entities = solved(offsetRounded(1, 0.5));
    expectPoints(entities, roundedCopy(1.5));
  });
});

/** Circle C (r 5) around a fixed o with a radius dimension, and its copy K around o. */
function offsetCircle(copyRadius: number, value: number, radius = 5): SketchData {
  return sketch(
    [
      ...points({ o: [0, 0] }),
      { kind: 'circle', id: 'C', center: 'o', radius: 5 },
      { kind: 'circle', id: 'K', center: 'o', radius: copyRadius },
    ],
    [
      ...fix('o'),
      { kind: 'radius', id: 'r', curve: 'C', value: radius },
      offset(value, [['C', 'K']]),
    ],
  );
}

describe('solveSketch – offset of a circle', () => {
  it('outward: the copy radius is the source radius plus the value', () => {
    const entities = solved(offsetCircle(6, 2));
    expect(radiusOf(entities, 'K')).toBeCloseTo(7, 6);
  });

  it('inward: the copy radius is the source radius minus the value', () => {
    const entities = solved(offsetCircle(4, 2));
    expect(radiusOf(entities, 'K')).toBeCloseTo(3, 6);
  });

  it('the copy follows the source radius and has no degree of freedom', () => {
    const data = offsetCircle(6, 1, 8);
    expect(radiusOf(solved(data), 'K')).toBeCloseTo(9, 6);
    expect(solveSketch(mod, data).dof).toBe(0);
  });
});
