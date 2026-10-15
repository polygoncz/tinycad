import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  measure,
  parseSketchData,
  type DimensionConstraint,
  type SketchData,
  type SketchEntity,
  type SketchEntityId,
  type SolveInput,
} from '@/sketch';
import { rectangleData } from '@/sketch/testing';
import { loadPlanegcs, type PlanegcsModule } from '@/solver-planegcs/planegcs-module';
import { solveSketch } from '@/solver-planegcs/solve';
import { isWasmTrap } from '@/solver-planegcs/wasm-trap';

// solveSketch against the real planegcs in Node (spec 12 "Testy", solver-planegcs).

let mod: PlanegcsModule;

beforeAll(async () => {
  mod = await loadPlanegcs();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Brands raw data through the trusted parser; invalid test data is a test bug. */
function sketch(entities: readonly unknown[], constraints: readonly unknown[]): SketchData {
  const parsed = parseSketchData(entities, constraints);
  if (!parsed.ok) throw new Error(`invalid test sketch: ${JSON.stringify(parsed.error)}`);
  return parsed.value;
}

/** The rectangle 10 × 5 from [0, 0] plus extra constraints. */
function rectangle(...extra: readonly unknown[]): SketchData {
  const r = rectangleData();
  return sketch(r.entities, [...r.constraints, ...extra]);
}

const WIDTH = { kind: 'distance', id: 'W', a: 'a', b: 'b', value: 10 };
const HEIGHT = { kind: 'distance', id: 'H', a: 'b', b: 'c', value: 5 };
const FIX_A = { kind: 'fix', id: 'fa', point: 'a' };

/** The branded id of an entity of the data. */
function idOf(data: SketchData, id: string): SketchEntityId {
  const e = data.entities.find((x) => x.id === id);
  if (e === undefined) throw new Error(`no entity ${id}`);
  return e.id;
}

function point(entities: readonly SketchEntity[] | null, id: string): { x: number; y: number } {
  const p = entities?.find((e) => e.id === id);
  if (p?.kind !== 'point') throw new Error(`no point ${id}`);
  return { x: p.x, y: p.y };
}

function expectPoint(input: { x: number; y: number }, x: number, y: number): void {
  expect(input.x).toBeCloseTo(x, 6);
  expect(input.y).toBeCloseTo(y, 6);
}

describe('solveSketch – degrees of freedom', () => {
  it('a rectangle without dimensions has 4 degrees of freedom', () => {
    const result = solveSketch(mod, rectangle());
    expect(result).toMatchObject({ status: 'ok', dof: 4, conflicting: [], redundant: [] });
  });

  it('two dimensions leave 2, a fix 0', () => {
    expect(solveSketch(mod, rectangle(WIDTH, HEIGHT)).dof).toBe(2);
    expect(solveSketch(mod, rectangle(WIDTH, HEIGHT, FIX_A))).toMatchObject({
      status: 'ok',
      dof: 0,
    });
  });

  it('a drag does not change the degrees of freedom', () => {
    const data = rectangle(WIDTH, FIX_A);
    const withoutDrag = solveSketch(mod, data);
    const withDrag = solveSketch(mod, { ...data, drag: { point: idOf(data, 'c'), to: [7, 8] } });
    expect(withoutDrag.dof).toBe(1);
    expect(withDrag.dof).toBe(1);
  });
});

describe('solveSketch – positions', () => {
  it('a changed dimension moves the points', () => {
    const result = solveSketch(mod, rectangle({ ...WIDTH, value: 20 }, HEIGHT, FIX_A));
    expect(result.status).toBe('ok');
    expectPoint(point(result.entities, 'a'), 0, 0);
    expectPoint(point(result.entities, 'b'), 20, 0);
    expectPoint(point(result.entities, 'c'), 20, 5);
    expectPoint(point(result.entities, 'd'), 0, 5);
  });

  it('a fix keeps the point on its coordinates', () => {
    const r = rectangleData({ x: 3, y: -2 });
    const data = sketch(r.entities, [...r.constraints, WIDTH, HEIGHT, FIX_A]);
    const result = solveSketch(mod, { ...data, drag: { point: idOf(data, 'a'), to: [50, 50] } });
    expectPoint(point(result.entities, 'a'), 3, -2);
  });

  it('entities keep their order, ids and fields', () => {
    const r = rectangleData();
    const entities = r.entities.map((e) =>
      e.kind === 'line' && e.id === 'cd' ? { ...e, construction: true } : e,
    );
    const data = sketch(entities, [...r.constraints, { ...WIDTH, value: 12 }, FIX_A]);
    const result = solveSketch(mod, data);
    expect(result.status).toBe('ok');
    expect(result.entities?.map((e) => e.id)).toEqual(data.entities.map((e) => e.id));
    for (const [i, e] of (result.entities ?? []).entries()) {
      expect(Object.keys(e).sort()).toEqual(Object.keys(data.entities[i] ?? {}).sort());
    }
    expect(result.entities?.[6]).toEqual(data.entities[6]);
  });

  it('a circle gets its radius', () => {
    const data = sketch(
      [
        { kind: 'point', id: 'c', x: 3, y: 4 },
        { kind: 'circle', id: 'C', center: 'c', radius: 1.7 },
      ],
      [
        { kind: 'fix', id: 'f', point: 'c' },
        { kind: 'radius', id: 'r', curve: 'C', value: 2.5 },
      ],
    );
    const result = solveSketch(mod, data);
    expect(result).toMatchObject({ status: 'ok', dof: 0 });
    expect(result.entities?.[1]).toMatchObject({ kind: 'circle', id: 'C', center: 'c' });
    const circle = result.entities?.[1];
    expect(circle?.kind === 'circle' ? circle.radius : NaN).toBeCloseTo(2.5, 6);
    expectPoint(point(result.entities, 'c'), 3, 4);
  });

  it('an arc tangent to a line touches it', () => {
    const data = sketch(
      [
        { kind: 'point', id: 'p', x: -5, y: -3 },
        { kind: 'point', id: 'q', x: 5, y: -3 },
        { kind: 'line', id: 'L', p1: 'p', p2: 'q' },
        { kind: 'point', id: 'ac', x: 0, y: 0 },
        { kind: 'point', id: 'as', x: 2, y: 0 },
        { kind: 'point', id: 'ae', x: 0, y: 2 },
        { kind: 'arc', id: 'A', center: 'ac', start: 'as', end: 'ae' },
      ],
      [
        { kind: 'fix', id: 'fp', point: 'p' },
        { kind: 'fix', id: 'fq', point: 'q' },
        { kind: 'fix', id: 'fc', point: 'ac' },
        { kind: 'tangent', id: 't', a: 'L', b: 'A' },
      ],
    );
    const result = solveSketch(mod, data);
    expect(result.status).toBe('ok');
    const center = point(result.entities, 'ac');
    const start = point(result.entities, 'as');
    const end = point(result.entities, 'ae');
    expectPoint(center, 0, 0);
    expect(Math.hypot(start.x, start.y)).toBeCloseTo(3, 6);
    expect(Math.hypot(end.x, end.y)).toBeCloseTo(3, 6);
  });
});

describe('solveSketch – drag', () => {
  it('with free degrees the dragged point follows the target', () => {
    const data = rectangle(WIDTH, FIX_A);
    const result = solveSketch(mod, { ...data, drag: { point: idOf(data, 'c'), to: [7, 8] } });
    expect(result.status).toBe('ok');
    expectPoint(point(result.entities, 'c'), 10, 8);
    expectPoint(point(result.entities, 'd'), 0, 8);
  });

  it('in a fully defined sketch nothing moves', () => {
    const data = rectangle(WIDTH, HEIGHT, FIX_A);
    const result = solveSketch(mod, {
      ...data,
      drag: { point: idOf(data, 'c'), to: [20, 20] },
    });
    expect(result).toMatchObject({ status: 'ok', dof: 0, conflicting: [] });
    expectPoint(point(result.entities, 'c'), 10, 5);
  });

  it('dragging a point that does not exist fails', () => {
    const data = rectangle();
    const ghost = parseSketchData([{ kind: 'point', id: 'ghost', x: 0, y: 0 }], []);
    if (!ghost.ok) throw new Error('ghost');
    const result = solveSketch(mod, {
      ...data,
      drag: { point: idOf(ghost.value, 'ghost'), to: [1, 1] },
    });
    expect(result).toEqual({
      status: 'failed',
      entities: null,
      dof: null,
      conflicting: [],
      redundant: [],
    });
  });
});

describe('solveSketch – conflicts and redundancy', () => {
  it('a third dimension on the diagonal is a conflict with its id', () => {
    const diagonal = { kind: 'distance', id: 'diag', a: 'a', b: 'c', value: 30 };
    const result = solveSketch(mod, rectangle(WIDTH, HEIGHT, FIX_A, diagonal));
    expect(result.status).toBe('conflict');
    expect(result.entities).toBeNull();
    expect(result.conflicting).toContain('diag');
  });

  it('a dimension between two fixed points with a wrong value is a conflict', () => {
    const fixB = { kind: 'fix', id: 'fb', point: 'b' };
    const result = solveSketch(mod, rectangle(FIX_A, fixB, { ...WIDTH, value: 12 }));
    expect(result.status).toBe('conflict');
    expect(result.conflicting).toContain('W');
    // Fix ids come back without the :x/:y suffix, once each.
    for (const id of result.conflicting) expect(id).not.toContain(':');
    expect(new Set(result.conflicting).size).toBe(result.conflicting.length);
  });

  it('a second horizontal on the same line is ok with a redundancy', () => {
    const twice = { kind: 'horizontal', id: 'h1bis', line: 'ab' };
    const result = solveSketch(mod, rectangle(twice));
    expect(result.status).toBe('ok');
    expect(result.entities).not.toBeNull();
    expect(result.redundant.length).toBeGreaterThan(0);
    for (const id of result.redundant) expect(['h1', 'h1bis']).toContain(id);
  });
});

describe('solveSketch – failures', () => {
  it('a reference to a missing entity is a failed solve, not an exception', () => {
    const r = rectangleData();
    const broken = parseSketchData(
      [...r.entities, { kind: 'point', id: 'x', x: 1, y: 1 }],
      [{ kind: 'distance', id: 'dx', a: 'a', b: 'x', value: 3 }],
    );
    if (!broken.ok) throw new Error('broken');
    const input: SolveInput = { entities: r.entities, constraints: broken.value.constraints };
    expect(solveSketch(mod, input)).toMatchObject({ status: 'failed', entities: null, dof: null });
  });

  it('prints nothing while solving', () => {
    const spies = [
      vi.spyOn(console, 'log'),
      vi.spyOn(console, 'info'),
      vi.spyOn(console, 'warn'),
      vi.spyOn(console, 'error'),
      vi.spyOn(console, 'debug'),
      vi.spyOn(process.stdout, 'write'),
      vi.spyOn(process.stderr, 'write'),
    ];
    // Redundant and conflicting systems are the ones planegcs reports on in debug mode.
    solveSketch(mod, rectangle({ kind: 'horizontal', id: 'h1bis', line: 'ab' }));
    solveSketch(mod, rectangle(WIDTH, HEIGHT, FIX_A, { ...WIDTH, id: 'W2', value: 12 }));
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it('a WASM abort (out of memory) is thrown as WebAssembly.RuntimeError', async () => {
    // A module of its own: after the abort the instance is dead.
    const doomed = await loadPlanegcs();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const thrown = (() => {
      try {
        solveSketch(doomed, manyRectangles(1000));
        return undefined;
      } catch (e) {
        return e;
      }
    })();
    expect(isWasmTrap(thrown)).toBe(true);
  });
});

/** Two points: `a` fixed in the origin, `b` free at [x, y]. */
function twoPoints(x: number, y: number, ...constraints: readonly unknown[]): SketchData {
  return sketch(
    [
      { kind: 'point', id: 'a', x: 0, y: 0 },
      { kind: 'point', id: 'b', x, y },
    ],
    [{ kind: 'fix', id: 'fa', point: 'a' }, ...constraints],
  );
}

/** The dimension `id` of the data (the parser keeps the kind). */
function dimensionOf(data: SketchData, id: string): DimensionConstraint {
  const c = data.constraints.find((x) => x.id === id);
  if (c === undefined || !('value' in c)) throw new Error(`no dimension ${id}`);
  return c;
}

/** The solved data: the input constraints with the solved entities. */
function solvedData(data: SketchData, drag?: SolveInput['drag']): SketchData {
  const result = solveSketch(mod, drag === undefined ? data : { ...data, drag });
  expect(result.status).toBe('ok');
  if (result.entities === null) throw new Error('no entities');
  return { entities: result.entities, constraints: data.constraints };
}

describe('solveSketch – M28 dimensions', () => {
  it('hDistance moves b to the value on its side and holds it while dragging', () => {
    const data = twoPoints(3, 1, { kind: 'hDistance', id: 'h', a: 'a', b: 'b', value: 5 });
    expectPoint(point(solvedData(data).entities, 'b'), 5, 1);
    const dragged = solvedData(data, { point: idOf(data, 'b'), to: [9, 4] });
    expectPoint(point(dragged.entities, 'b'), 5, 4);
    expect(solveSketch(mod, data).dof).toBe(1);
  });

  it('hDistance keeps b on the left when it is on the left, + when level', () => {
    const left = twoPoints(-3, 1, { kind: 'hDistance', id: 'h', a: 'a', b: 'b', value: 5 });
    expectPoint(point(solvedData(left).entities, 'b'), -5, 1);
    const dragged = solvedData(left, { point: idOf(left, 'b'), to: [-1, 2] });
    expectPoint(point(dragged.entities, 'b'), -5, 2);
    const level = twoPoints(0, 1, { kind: 'hDistance', id: 'h', a: 'a', b: 'b', value: 5 });
    expectPoint(point(solvedData(level).entities, 'b'), 5, 1);
  });

  it('vDistance keeps b above or below a and holds the value while dragging', () => {
    const above = twoPoints(1, 3, { kind: 'vDistance', id: 'v', a: 'a', b: 'b', value: 5 });
    expectPoint(point(solvedData(above).entities, 'b'), 1, 5);
    const dragged = solvedData(above, { point: idOf(above, 'b'), to: [7, 1] });
    expectPoint(point(dragged.entities, 'b'), 7, 5);
    const below = twoPoints(1, -3, { kind: 'vDistance', id: 'v', a: 'a', b: 'b', value: 5 });
    expectPoint(point(solvedData(below).entities, 'b'), 1, -5);
  });

  it('pointLineDistance holds the distance to the line while dragging', () => {
    const data = sketch(
      [
        { kind: 'point', id: 'p', x: 0, y: 0 },
        { kind: 'point', id: 'q', x: 10, y: 0 },
        { kind: 'line', id: 'L', p1: 'p', p2: 'q' },
        { kind: 'point', id: 'x', x: 3, y: 2 },
      ],
      [
        { kind: 'fix', id: 'fp', point: 'p' },
        { kind: 'fix', id: 'fq', point: 'q' },
        { kind: 'pointLineDistance', id: 'd', point: 'x', line: 'L', value: 4 },
      ],
    );
    expect(point(solvedData(data).entities, 'x').y).toBeCloseTo(4, 6);
    const dragged = solvedData(data, { point: idOf(data, 'x'), to: [6, 9] });
    expectPoint(point(dragged.entities, 'x'), 6, 4);
    expect(measure(dragged, dimensionOf(dragged, 'd'))).toBeCloseTo(4, 6);
  });

  it('diameter of a circle sets the radius to half and holds it while dragging the center', () => {
    const data = sketch(
      [
        { kind: 'point', id: 'c', x: 3, y: 4 },
        { kind: 'circle', id: 'C', center: 'c', radius: 1.7 },
      ],
      [{ kind: 'diameter', id: 'd', curve: 'C', value: 6 }],
    );
    const dragged = solvedData(data, { point: idOf(data, 'c'), to: [8, -1] });
    const circle = dragged.entities[1];
    expect(circle?.kind === 'circle' ? circle.radius : NaN).toBeCloseTo(3, 6);
    expectPoint(point(dragged.entities, 'c'), 8, -1);
    expect(measure(dragged, dimensionOf(dragged, 'd'))).toBeCloseTo(6, 6);
  });

  it('diameter of an arc holds the radius while dragging an end point', () => {
    const data = sketch(
      [
        { kind: 'point', id: 'ac', x: 0, y: 0 },
        { kind: 'point', id: 'as', x: 2, y: 0 },
        { kind: 'point', id: 'ae', x: 0, y: 2 },
        { kind: 'arc', id: 'A', center: 'ac', start: 'as', end: 'ae' },
      ],
      [
        { kind: 'fix', id: 'fc', point: 'ac' },
        { kind: 'diameter', id: 'd', curve: 'A', value: 6 },
      ],
    );
    const dragged = solvedData(data, { point: idOf(data, 'as'), to: [1, 5] });
    const start = point(dragged.entities, 'as');
    const end = point(dragged.entities, 'ae');
    expect(Math.hypot(start.x, start.y)).toBeCloseTo(3, 6);
    expect(Math.hypot(end.x, end.y)).toBeCloseTo(3, 6);
    expect(measure(dragged, dimensionOf(dragged, 'd'))).toBeCloseTo(6, 6);
  });

  describe('angle stays in its quadrant', () => {
    /** Line A fixed along +x, line B from the origin to [x, y] with the free end. */
    function twoLines(x: number, y: number, angle: Record<string, unknown>): SketchData {
      return sketch(
        [
          { kind: 'point', id: 'a1', x: 0, y: 0 },
          { kind: 'point', id: 'a2', x: 10, y: 0 },
          { kind: 'line', id: 'A', p1: 'a1', p2: 'a2' },
          { kind: 'point', id: 'b1', x: 0, y: 0 },
          { kind: 'point', id: 'b2', x, y },
          { kind: 'line', id: 'B', p1: 'b1', p2: 'b2' },
        ],
        [
          { kind: 'fix', id: 'fa1', point: 'a1' },
          { kind: 'fix', id: 'fa2', point: 'a2' },
          { kind: 'fix', id: 'fb1', point: 'b1' },
          { kind: 'angle', id: 'g', a: 'A', b: 'B', ...angle },
        ],
      );
    }

    /** The cross product of the directions of A and B, reversed by the flags of `g`. */
    function orientedCross(data: SketchData): number {
      const g = dimensionOf(data, 'g');
      if (g.kind !== 'angle') throw new Error('g is not an angle');
      const a = point(data.entities, 'a2');
      const b = point(data.entities, 'b2');
      const sa = g.reverseA === true ? -1 : 1;
      const sb = g.reverseB === true ? -1 : 1;
      return sa * sb * (a.x * b.y - a.y * b.x);
    }

    const flags = [
      { name: 'no flags', flags: {} },
      { name: 'reverseA', flags: { reverseA: true } },
      { name: 'reverseB', flags: { reverseB: true } },
      { name: 'both flags', flags: { reverseA: true, reverseB: true } },
    ] as const;
    const orientations = [
      { name: 'counter-clockwise', b2: [5, 5] },
      { name: 'clockwise', b2: [5, -5] },
    ] as const;

    for (const f of flags) {
      for (const o of orientations) {
        it(`${f.name}, ${o.name} from a to b`, () => {
          // Measure the current value first, then ask for a bit more.
          const start = twoLines(o.b2[0], o.b2[1], { value: 1, ...f.flags });
          const current = measure(start, dimensionOf(start, 'g'));
          const value = current + 0.2;
          const data = twoLines(o.b2[0], o.b2[1], { value, ...f.flags });

          const solved = solvedData(data);
          expect(measure(solved, dimensionOf(solved, 'g'))).toBeCloseTo(value, 6);
          expect(Math.sign(orientedCross(solved))).toBe(Math.sign(orientedCross(data)));

          const far: readonly [number, number] = [o.b2[0] * 3, o.b2[1] * 3];
          const dragged = solvedData(data, { point: idOf(data, 'b2'), to: far });
          expect(measure(dragged, dimensionOf(dragged, 'g'))).toBeCloseTo(value, 6);
          expect(Math.sign(orientedCross(dragged))).toBe(Math.sign(orientedCross(data)));
        });
      }
    }
  });

  it('placement does not enter the solve', () => {
    const constraints = [
      { kind: 'hDistance', id: 'h', a: 'a', b: 'b', value: 5 },
      { kind: 'vDistance', id: 'v', a: 'a', b: 'b', value: 2 },
    ];
    const placement = { kind: 'linear', offset: 3, along: -1 };
    const without = twoPoints(3, 1, ...constraints);
    const withPlacement = twoPoints(3, 1, ...constraints.map((c) => ({ ...c, placement })));
    const drag = { point: idOf(without, 'b'), to: [9, 9] as const };
    expect(solveSketch(mod, withPlacement)).toEqual(solveSketch(mod, without));
    expect(solveSketch(mod, { ...withPlacement, drag })).toEqual(
      solveSketch(mod, { ...without, drag }),
    );

    const round = (extra: Record<string, unknown>) =>
      sketch(
        [
          { kind: 'point', id: 'c', x: 0, y: 0 },
          { kind: 'circle', id: 'C', center: 'c', radius: 1 },
        ],
        [{ kind: 'diameter', id: 'd', curve: 'C', value: 4, ...extra }],
      );
    const radial = { kind: 'radial', angle: 0.5, distance: 3 };
    expect(solveSketch(mod, round({ placement: radial }))).toEqual(solveSketch(mod, round({})));
  });
});

/** `n` fully defined rectangles side by side: far more unknowns than the WASM memory holds. */
function manyRectangles(n: number): SketchData {
  const parts = Array.from({ length: n }, (_, i) => {
    const r = rectangleData({ x: i * 30, prefix: `r${String(i)}_` });
    const id = (name: string) => `r${String(i)}_${name}`;
    const extra = parseSketchData(r.entities, [
      { kind: 'distance', id: id('W'), a: id('a'), b: id('b'), value: 10 },
      { kind: 'distance', id: id('H'), a: id('b'), b: id('c'), value: 5 },
      { kind: 'fix', id: id('f'), point: id('a') },
    ]);
    if (!extra.ok) throw new Error('manyRectangles');
    return { entities: r.entities, constraints: [...r.constraints, ...extra.value.constraints] };
  });
  return {
    entities: parts.flatMap((p) => p.entities),
    constraints: parts.flatMap((p) => p.constraints),
  };
}
