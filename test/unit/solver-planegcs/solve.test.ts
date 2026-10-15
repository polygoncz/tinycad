import { DebugMode, GcsWrapper, type SketchPrimitive } from '@salusoft89/planegcs';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { bspline, type BSplineShape, type Vec2 } from '@/core';
import {
  endTangent,
  measure,
  tangentArcFrom,
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

describe('solveSketch – M27 tangent arcs', () => {
  // What sketch.arcTangent writes (spec 12, "Oblouky a kružnice (M27)"): an arc from the end point
  // of a line or an arc, placed by tangentArcFrom, sharing that point, with tangent(arc, curve).

  /** The line l (10, 10)–(30, 10) and the ccw quarter arc a around (100, 100), (110, 100)–(100, 110). */
  const CURVES = [
    { kind: 'point', id: 'l1', x: 10, y: 10 },
    { kind: 'point', id: 'l2', x: 30, y: 10 },
    { kind: 'line', id: 'l', p1: 'l1', p2: 'l2' },
    { kind: 'point', id: 'ac', x: 100, y: 100 },
    { kind: 'point', id: 'as', x: 110, y: 100 },
    { kind: 'point', id: 'ae', x: 100, y: 110 },
    { kind: 'arc', id: 'a', center: 'ac', start: 'as', end: 'ae' },
  ];

  /** The tangent arc from the end point `from` of `curve` to `to`, as the tool writes it. */
  function tangentArc(curve: 'l' | 'a', from: 'l2' | 'ae', to: Vec2): SketchData {
    const base = sketch(CURVES, []);
    const c = base.entities.find((e) => e.id === curve);
    const at = point(base.entities, from);
    const direction =
      c?.kind === 'line' || c?.kind === 'arc' ? endTangent(c, idOf(base, from), base) : null;
    const fit = direction === null ? null : tangentArcFrom([at.x, at.y], direction, to);
    if (fit === null) throw new Error('no tangent arc');
    const [start, end] = fit.ccw ? [from, 'e'] : ['e', from];
    return sketch(
      [
        ...CURVES,
        { kind: 'point', id: 'c', x: fit.center[0], y: fit.center[1] },
        { kind: 'point', id: 'e', x: to[0], y: to[1] },
        { kind: 'arc', id: 'T', center: 'c', start, end },
      ],
      [{ kind: 'tangent', id: 't', a: 'T', b: curve }],
    );
  }

  const CASES = [
    { name: 'a line', curve: 'l', from: 'l2', to: [40, 20] },
    { name: 'an arc, inside (same sense)', curve: 'a', from: 'ae', to: [80, 90] },
    { name: 'an arc, outside (an S)', curve: 'a', from: 'ae', to: [80, 125] },
  ] as const;

  for (const c of CASES) {
    it(`an arc tangent to ${c.name} from its end point solves ok`, () => {
      const result = solveSketch(mod, tangentArc(c.curve, c.from, c.to));

      expect(result.status).toBe('ok');
      expect(result.conflicting).toEqual([]);
    });

    // A known hole (reported to the main session): with the shared end point the tangency of
    // tangent_la / tangent_aa is degenerate (on the curves through the shared point the distance of
    // the centre from the other curve never exceeds the radius, so the gradient of the tangency is
    // dependent), planegcs reports it redundant and addGeometry leaves it out, required or not.
    it.fails(
      `the tangent of an arc tangent to ${c.name} from its end point is not redundant`,
      () => {
        const result = solveSketch(mod, tangentArc(c.curve, c.from, c.to));

        expect(result.redundant).toEqual([]);
      },
    );
  }
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

/** Four points for a cubic spline. */
const FIT: readonly Vec2[] = [
  [0, 0],
  [1, 1],
  [3, 0],
  [4, 2],
];

/** Sketch points `<prefix>0…` at the coordinates. */
function points(prefix: string, at: readonly Vec2[]): unknown[] {
  return at.map(([x, y], i) => ({ kind: 'point', id: `${prefix}${String(i)}`, x, y }));
}

/** A cubic bspline 'S' with control points p0…p3 at FIT. */
function controlSpline(): unknown[] {
  return [
    ...points('p', FIT),
    {
      kind: 'bspline',
      id: 'S',
      degree: 3,
      poles: ['p0', 'p1', 'p2', 'p3'],
      knots: [0, 0, 0, 0, 1, 1, 1, 1],
    },
  ];
}

/** A fitSpline 'F' through the fit points f0… at `at` (default FIT). */
function fitSpline(at: readonly Vec2[] = FIT): unknown[] {
  const { degree, params, knots, poles } = bspline.interpolate(at);
  return [
    ...points('f', at),
    {
      kind: 'fitSpline',
      id: 'F',
      degree,
      fit: at.map((_, i) => `f${String(i)}`),
      params,
      poles,
      knots,
    },
  ];
}

/** The curve of a solved spline entity, with the control point coordinates looked up. */
function curveOf(entities: readonly SketchEntity[] | null, id: string): BSplineShape {
  const e = entities?.find((x) => x.id === id);
  if (e?.kind === 'fitSpline') return { degree: e.degree, poles: e.poles, knots: e.knots };
  if (e?.kind === 'bspline') {
    const poles = e.poles.map((p): Vec2 => {
      const { x, y } = point(entities, p);
      return [x, y];
    });
    return { degree: e.degree, poles, knots: e.knots };
  }
  throw new Error(`no spline ${id}`);
}

/** The cross product of two directions normalised; 0 when they are parallel. */
function sine(a: Vec2, b: readonly [number, number]): number {
  return (a[0] * b[1] - a[1] * b[0]) / (Math.hypot(...a) * Math.hypot(...b));
}

describe('solveSketch – splines', () => {
  it('a bspline adds only its control points: dof = 2 · control points', () => {
    expect(solveSketch(mod, sketch(controlSpline(), []))).toMatchObject({ status: 'ok', dof: 8 });
  });

  it('a dragged control point follows the target, the rest stays', () => {
    const data = sketch(controlSpline(), []);
    const result = solveSketch(mod, { ...data, drag: { point: idOf(data, 'p1'), to: [5, 5] } });
    expect(result).toMatchObject({ status: 'ok', dof: 8 });
    expectPoint(point(result.entities, 'p1'), 5, 5);
    expectPoint(point(result.entities, 'p2'), 3, 0);
    expect(result.entities?.[4]).toEqual(data.entities[4]);
  });

  it('a fitSpline has 2 degrees of freedom per fit point', () => {
    expect(solveSketch(mod, sketch(fitSpline(), []))).toMatchObject({ status: 'ok', dof: 8 });
    const three = solveSketch(mod, sketch(fitSpline(FIT.slice(0, 3)), []));
    expect(three).toMatchObject({ status: 'ok', dof: 6 });
    const two = solveSketch(mod, sketch(fitSpline(FIT.slice(0, 2)), []));
    expect(two).toMatchObject({ status: 'ok', dof: 4 });
  });

  it('a dragged fit point: the spline passes through it and through the other fit points', () => {
    const data = sketch(fitSpline(), [{ kind: 'fix', id: 'f0fix', point: 'f0' }]);
    const result = solveSketch(mod, { ...data, drag: { point: idOf(data, 'f1'), to: [2, 3] } });
    expect(result).toMatchObject({ status: 'ok', dof: 6 });
    expectPoint(point(result.entities, 'f1'), 2, 3);
    expectPoint(point(result.entities, 'f0'), 0, 0);
    const before = data.entities[4];
    const after = result.entities?.[4];
    if (before?.kind !== 'fitSpline' || after?.kind !== 'fitSpline') throw new Error('no F');
    // New poles, every other field unchanged.
    expect(after.poles).not.toEqual(before.poles);
    expect({ ...after, poles: before.poles }).toEqual(before);
    const curve = curveOf(result.entities, 'F');
    for (const [i, t] of after.params.entries()) {
      const [x, y] = bspline.evaluate(curve, t);
      expectPoint(point(result.entities, `f${String(i)}`), x, y);
    }
  });

  it('planegcs adds 4 unused parameters per spline a constraint refers to (the dof correction)', () => {
    // Raw planegcs, without the adapter: if this changes, the correction in solve.ts must go.
    const { degree, params, knots, poles } = bspline.interpolate(FIT);
    const unique = [...new Set(knots)];
    const primitives: SketchPrimitive[] = [
      ...FIT.map(([x, y], i): SketchPrimitive => ({
        id: `f${String(i)}`,
        type: 'point',
        x,
        y,
        fixed: false,
      })),
      ...poles.map(([x, y], i): SketchPrimitive => ({
        id: `F:pole${String(i)}`,
        type: 'point',
        x,
        y,
        fixed: false,
      })),
      {
        id: 'F',
        type: 'bspline',
        pole_ids: poles.map((_, i) => `F:pole${String(i)}`),
        weights: poles.map(() => 1),
        knots: unique,
        mult: unique.map((k) => knots.filter((x) => x === k).length),
        degree,
        periodic: false,
      },
      ...params.map((t, i): SketchPrimitive => ({
        id: `F:fit${String(i)}`,
        type: 'point_on_bspline',
        p_id: `f${String(i)}`,
        b_id: 'F',
        pointparam: t,
      })),
    ];
    const w = new GcsWrapper(new mod.GcsSystem(), mod);
    try {
      w.debug_mode = DebugMode.NoDebug;
      w.push_primitives_and_params(primitives);
      w.solve();
      expect(w.gcs.dof()).toBe(2 * FIT.length + 4);
    } finally {
      w.destroy_gcs_module();
    }
  });

  it('a line tangent at the start of a bspline follows the end tangent', () => {
    const data = sketch(
      [...controlSpline(), { kind: 'point', id: 'q', x: -3, y: 1 }, line('L', 'q', 'p0')],
      [
        { kind: 'fix', id: 'fq', point: 'q' },
        { kind: 'tangent', id: 't', a: 'S', b: 'L' },
      ],
    );
    const result = solveSketch(mod, data);
    expect(result).toMatchObject({ status: 'ok', dof: 7 });
    const q = point(result.entities, 'q');
    const p0 = point(result.entities, 'p0');
    const d = bspline.derivative(curveOf(result.entities, 'S'), 0);
    expect(sine(d, [p0.x - q.x, p0.y - q.y])).toBeCloseTo(0, 6);
  });

  it('a line tangent at the end of a fitSpline follows the end tangent', () => {
    const data = sketch(
      [...fitSpline(), { kind: 'point', id: 'q', x: 6, y: 1 }, line('L', 'f3', 'q')],
      [
        { kind: 'fix', id: 'fq', point: 'q' },
        { kind: 'tangent', id: 't', a: 'L', b: 'F' },
      ],
    );
    const result = solveSketch(mod, data);
    expect(result).toMatchObject({ status: 'ok', dof: 7 });
    const q = point(result.entities, 'q');
    const f3 = point(result.entities, 'f3');
    const curve = curveOf(result.entities, 'F');
    const d = bspline.derivative(curve, 1);
    expect(sine(d, [q.x - f3.x, q.y - f3.y])).toBeCloseTo(0, 6);
    const [x, y] = bspline.evaluate(curve, 1);
    expectPoint(f3, x, y);
  });

  it('a point coincident with the end of a fitSpline lies on the end of the curve', () => {
    const data = sketch(
      [...fitSpline(), { kind: 'point', id: 'x', x: 9, y: 9 }],
      [
        { kind: 'fix', id: 'fx', point: 'x' },
        { kind: 'coincident', id: 'c', a: 'x', b: 'f3' },
      ],
    );
    const result = solveSketch(mod, data);
    expect(result).toMatchObject({ status: 'ok', dof: 6 });
    const [x, y] = bspline.evaluate(curveOf(result.entities, 'F'), 1);
    expectPoint(point(result.entities, 'f3'), 9, 9);
    expect(x).toBeCloseTo(9, 6);
    expect(y).toBeCloseTo(9, 6);
  });

  it('the fit point constraints come back as the id of the spline', () => {
    // Fixed fit points determine the curve; a tangent through a fixed point contradicts it.
    const data = sketch(
      [...fitSpline(), { kind: 'point', id: 'q', x: -3, y: 1 }, line('L', 'q', 'f0')],
      [
        ...['f0', 'f1', 'f2', 'f3', 'q'].map((p) => ({ kind: 'fix', id: `fix-${p}`, point: p })),
        { kind: 'tangent', id: 't', a: 'L', b: 'F' },
      ],
    );
    const result = solveSketch(mod, data);
    expect(result.status).toBe('conflict');
    expect(result.conflicting).toContain('F');
    for (const id of [...result.conflicting, ...result.redundant]) expect(id).not.toContain(':');
    expect(new Set(result.conflicting).size).toBe(result.conflicting.length);
  });

  it('prints nothing while solving splines', () => {
    const spies = [
      vi.spyOn(console, 'log'),
      vi.spyOn(console, 'warn'),
      vi.spyOn(console, 'error'),
      vi.spyOn(process.stdout, 'write'),
      vi.spyOn(process.stderr, 'write'),
    ];
    solveSketch(mod, sketch([...controlSpline(), ...fitSpline()], []));
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});

function line(id: string, p1: string, p2: string): unknown {
  return { kind: 'line', id, p1, p2 };
}

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
