import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  parseSketchData,
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

/** Line L from p [0, 0] to q [10, 0] with p fixed, plus extra entities and constraints. */
function withLine(entities: readonly unknown[], constraints: readonly unknown[]): SketchData {
  return sketch(
    [
      { kind: 'point', id: 'p', x: 0, y: 0 },
      { kind: 'point', id: 'q', x: 10, y: 0 },
      { kind: 'line', id: 'L', p1: 'p', p2: 'q' },
      ...entities,
    ],
    [{ kind: 'fix', id: 'fp', point: 'p' }, ...constraints],
  );
}

/** Circle C (r 5) and arc A (r 5, quarter from a fixed [5, 0] to [0, 5]) around a fixed centre o. */
function withRounds(entities: readonly unknown[], constraints: readonly unknown[]): SketchData {
  return sketch(
    [
      { kind: 'point', id: 'o', x: 0, y: 0 },
      { kind: 'circle', id: 'C', center: 'o', radius: 5 },
      { kind: 'point', id: 'as', x: 5, y: 0 },
      { kind: 'point', id: 'ae', x: 0, y: 5 },
      { kind: 'arc', id: 'A', center: 'o', start: 'as', end: 'ae' },
      ...entities,
    ],
    [
      { kind: 'fix', id: 'fo', point: 'o' },
      { kind: 'fix', id: 'fs', point: 'as' },
      { kind: 'radius', id: 'rc', curve: 'C', value: 5 },
      ...constraints,
    ],
  );
}

/** The signed distance of x from the line through a and b. */
function offLine(
  x: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  return ((b.x - a.x) * (x.y - a.y) - (b.y - a.y) * (x.x - a.x)) / Math.hypot(b.x - a.x, b.y - a.y);
}

describe('solveSketch – M26 constraints', () => {
  it('a point on a line stays on it when the line is dragged', () => {
    const data = withLine(
      [{ kind: 'point', id: 'm', x: 4, y: 0 }],
      [{ kind: 'pointOnCurve', id: 'on', point: 'm', curve: 'L' }],
    );
    const result = solveSketch(mod, { ...data, drag: { point: idOf(data, 'q'), to: [6, 8] } });
    expect(result.status).toBe('ok');
    const q = point(result.entities, 'q');
    expectPoint(q, 6, 8);
    expect(offLine(point(result.entities, 'm'), { x: 0, y: 0 }, q)).toBeCloseTo(0, 6);
  });

  it('a point on a line may leave the segment: it stays on the whole carrier line', () => {
    const data = withLine(
      [{ kind: 'point', id: 'm', x: 4, y: 0 }],
      [
        { kind: 'pointOnCurve', id: 'on', point: 'm', curve: 'L' },
        { kind: 'fix', id: 'fq', point: 'q' },
      ],
    );
    const result = solveSketch(mod, { ...data, drag: { point: idOf(data, 'm'), to: [20, 3] } });
    expect(result.status).toBe('ok');
    expectPoint(point(result.entities, 'm'), 20, 0);
  });

  it('a midpoint stays in the middle of its line', () => {
    const data = withLine(
      [{ kind: 'point', id: 'm', x: 3, y: 2 }],
      [{ kind: 'midpoint', id: 'mid', point: 'm', line: 'L' }],
    );
    const result = solveSketch(mod, { ...data, drag: { point: idOf(data, 'q'), to: [8, 6] } });
    expect(result.status).toBe('ok');
    expectPoint(point(result.entities, 'q'), 8, 6);
    expectPoint(point(result.entities, 'm'), 4, 3);
  });

  it('hAlign gives two points the same y, vAlign the same x', () => {
    const data = sketch(
      [
        { kind: 'point', id: 'a', x: 0, y: 0 },
        { kind: 'point', id: 'b', x: 7, y: 3 },
        { kind: 'point', id: 'c', x: 2, y: 9 },
      ],
      [
        { kind: 'fix', id: 'fa', point: 'a' },
        { kind: 'hAlign', id: 'h', a: 'a', b: 'b' },
        { kind: 'vAlign', id: 'v', a: 'c', b: 'a' },
      ],
    );
    const result = solveSketch(mod, data);
    expect(result.status).toBe('ok');
    // 6 coordinates − fix 2 − 1 − 1.
    expect(result.dof).toBe(2);
    expect(point(result.entities, 'b').y).toBeCloseTo(0, 6);
    expect(point(result.entities, 'b').x).toBeCloseTo(7, 6);
    expect(point(result.entities, 'c').x).toBeCloseTo(0, 6);
    expect(point(result.entities, 'c').y).toBeCloseTo(9, 6);
  });

  it('a point on a circle lies on it', () => {
    const data = withRounds(
      [{ kind: 'point', id: 'm', x: 1, y: 1 }],
      [{ kind: 'pointOnCurve', id: 'on', point: 'm', curve: 'C' }],
    );
    const result = solveSketch(mod, { ...data, drag: { point: idOf(data, 'm'), to: [0, -9] } });
    expect(result.status).toBe('ok');
    expectPoint(point(result.entities, 'm'), 0, -5);
  });

  it('a point on an arc lies on its whole circle, also outside the arc', () => {
    const data = withRounds(
      [{ kind: 'point', id: 'm', x: 1, y: 1 }],
      [{ kind: 'pointOnCurve', id: 'on', point: 'm', curve: 'A' }],
    );
    // The arc spans the first quadrant only; [-5, 0] is on its circle, outside its range.
    const result = solveSketch(mod, { ...data, drag: { point: idOf(data, 'm'), to: [-9, 0] } });
    expect(result.status).toBe('ok');
    expectPoint(point(result.entities, 'm'), -5, 0);
    // The arc itself did not grow to reach the point.
    expectPoint(point(result.entities, 'ae'), 0, 5);
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
