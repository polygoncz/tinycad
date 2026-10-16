// Test-only entry point of sketch: the FakeSolver, the FakeSketchGeometry and data builders for
// tests in this and other modules. dependency-cruiser allows importing it only from *.test.ts, so
// it never reaches the production bundle.

import type { Vec2 } from '@/core';
import { nearestParam, paramRange, pointAt, pointTolerance, samePoint } from './curve-param';
import type { Curve2 } from './geometry';
import type { SketchConstraint, SketchData, SketchEntity } from './model';
import { parseSketchData } from './parse';
import type { ConstraintSolver, SolveInput, SolveResult } from './solver';
import type { CurveHit, SketchGeometry } from './geometry-port';

export interface FakeSolver extends ConstraintSolver {
  /** The next solve returns the echo overridden by these fields (a queue: one per call). */
  next(result: Partial<SolveResult>): void;
  /** Holds back answers (concurrency tests); release settles all waiting ones in order and stops holding. */
  hold(): void;
  release(): void;
  readonly calls: readonly SolveInput[];
}

/** Weights of constraints in the naive degrees of freedom (spec 12); the rest weigh 1. */
const WEIGHTS: Partial<Record<SketchConstraint['kind'], number>> = {
  coincident: 2,
  midpoint: 2,
  fix: 2,
};

/**
 * A solver that echoes its input: status 'ok', the entities with the dragged point moved to the
 * target, dof = max(0, 2·points + circles − Σ weights − arcs). Answers in a microtask; the result
 * is computed when solve is called (the input is read synchronously, like the real port).
 */
export function createFakeSolver(): FakeSolver {
  const calls: SolveInput[] = [];
  const overrides: Partial<SolveResult>[] = [];
  const held: (() => void)[] = [];
  let holding = false;

  return {
    calls,
    next(result) {
      overrides.push(result);
    },
    hold() {
      holding = true;
    },
    release() {
      holding = false;
      for (const settle of held.splice(0)) settle();
    },
    solve(input) {
      calls.push(input);
      const result: SolveResult = { ...echo(input), ...overrides.shift() };
      return new Promise((resolve) => {
        const settle = () => {
          resolve(result);
        };
        if (holding) held.push(settle);
        // A microtask like the real port's async answer (queueMicrotask is not in the ES lib).
        else void Promise.resolve().then(settle);
      });
    },
  };
}

function echo(input: SolveInput): SolveResult {
  const { drag } = input;
  const entities = input.entities.map((e): SketchEntity =>
    drag !== undefined && e.kind === 'point' && e.id === drag.point
      ? { ...e, x: drag.to[0], y: drag.to[1] }
      : e,
  );
  return { status: 'ok', entities, dof: naiveDof(input), conflicting: [], redundant: [] };
}

function naiveDof(data: SketchData): number {
  const count = (kind: SketchEntity['kind']) => data.entities.filter((e) => e.kind === kind).length;
  const weight = data.constraints.reduce((sum, c) => sum + (WEIGHTS[c.kind] ?? 1), 0);
  return Math.max(0, 2 * count('point') + count('circle') - weight - count('arc'));
}

export interface RectangleOptions {
  readonly x?: number;
  readonly y?: number;
  readonly width?: number;
  readonly height?: number;
  readonly prefix?: string;
}

/**
 * A rectangle: points a, b, c, d (counter-clockwise from [x, y]), lines ab, bc, cd, da,
 * 2× horizontal (h1 on ab, h2 on cd), 2× vertical (v1 on bc, v2 on da); every id has the prefix.
 * Defaults: [0, 0], 10 × 5, no prefix. Frozen.
 */
export function rectangleData(opts: RectangleOptions = {}): SketchData {
  const { x = 0, y = 0, width = 10, height = 5, prefix = '' } = opts;
  const id = (name: string) => `${prefix}${name}`;
  const point = (name: string, px: number, py: number) => ({
    kind: 'point',
    id: id(name),
    x: px,
    y: py,
  });
  const line = (p1: string, p2: string) => ({
    kind: 'line',
    id: id(p1 + p2),
    p1: id(p1),
    p2: id(p2),
  });
  const entities = [
    point('a', x, y),
    point('b', x + width, y),
    point('c', x + width, y + height),
    point('d', x, y + height),
    line('a', 'b'),
    line('b', 'c'),
    line('c', 'd'),
    line('d', 'a'),
  ];
  const constraints = [
    { kind: 'horizontal', id: id('h1'), line: id('ab') },
    { kind: 'vertical', id: id('v1'), line: id('bc') },
    { kind: 'horizontal', id: id('h2'), line: id('cd') },
    { kind: 'vertical', id: id('v2'), line: id('da') },
  ];
  // Parsing is the trusted way to brand the ids; a bad option (NaN) is a test bug.
  const parsed = parseSketchData(entities, constraints);
  if (!parsed.ok) throw new Error(`rectangleData: invalid options ${JSON.stringify(opts)}`);
  return deepFreeze(parsed.value);
}

/** Freezes plain data recursively. */
function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

/**
 * The SketchGeometry of tests (M33): analytic intersections of lines, arcs and circles and pieces
 * of them, with the parameter t of spec 12 (curve-param.ts). A spline is not supported: any call
 * with one rejects, like a failing kernel. Every curve of `intersections` needs a unique id.
 */
export function createFakeSketchGeometry(): SketchGeometry {
  return Object.freeze({
    intersections: (curves: readonly Curve2[]) =>
      settle(() => {
        const named = curves.map((c): Analytic => {
          if (c.id === undefined) throw new Error('FakeSketchGeometry: a curve without an id');
          if (c.kind === 'bspline') throw new Error('FakeSketchGeometry: splines not supported');
          return { ...c, id: c.id };
        });
        if (new Set(named.map((c) => c.id)).size !== named.length) {
          throw new Error('FakeSketchGeometry: duplicate curve ids');
        }
        const hits: CurveHit[] = [];
        for (const [i, a] of named.entries()) {
          for (const b of named.slice(i + 1)) hits.push(...pairHits(a, b));
        }
        return Object.freeze(hits);
      }),
    segment: (curve: Curve2, from: number, to: number) =>
      settle((): Curve2 => {
        if (curve.kind === 'bspline') throw new Error('FakeSketchGeometry: splines not supported');
        const [lo, hi] = paramRange(curve);
        const end = curve.kind === 'circle' ? from + 2 * Math.PI : hi;
        if (!(from < to) || from < lo - PARAM_EPS || to > end + PARAM_EPS) {
          throw new Error(`FakeSketchGeometry: bad piece [${String(from)}, ${String(to)}]`);
        }
        const id = curve.id === undefined ? {} : { id: curve.id };
        const p = pointAt(curve, from);
        const q = pointAt(curve, to);
        if (curve.kind === 'line') return Object.freeze({ kind: 'line', from: p, to: q, ...id });
        const ccw = curve.kind === 'circle' || curve.ccw;
        return Object.freeze({ kind: 'arc', center: curve.center, from: p, to: q, ccw, ...id });
      }),
  });
}

/** Slack of parameters at the ends of a range (rounding of the caller's arithmetic). */
const PARAM_EPS = 1e-9;

type Analytic = Exclude<Curve2, { kind: 'bspline' }> & { readonly id: string };
type AnalyticLine = Extract<Analytic, { kind: 'line' }>;
type AnalyticRound = Exclude<Analytic, { kind: 'line' }>;
interface Candidate {
  readonly point: Vec2;
  readonly overlap: boolean;
}
interface Circle {
  readonly center: Vec2;
  readonly radius: number;
}

/** Runs `compute` in a microtask: a thrown error rejects, like an asynchronous port. */
function settle<T>(compute: () => T): Promise<T> {
  return Promise.resolve().then(compute);
}

/** The intersections of two analytic curves in the order of ta; an overlap by the ends of the common stretch. */
function pairHits(a: Analytic, b: Analytic): CurveHit[] {
  let candidates: readonly Candidate[];
  if (a.kind === 'line' && b.kind === 'line') candidates = lineLine(a, b);
  else if (a.kind === 'line' && b.kind !== 'line') candidates = lineCircle(a, carrier(b));
  else if (a.kind !== 'line' && b.kind === 'line') candidates = lineCircle(b, carrier(a));
  else if (a.kind !== 'line' && b.kind !== 'line') candidates = roundRound(a, b);
  else candidates = [];
  const hits: CurveHit[] = [];
  for (const { point, overlap } of candidates) {
    if (!onCurve(a, point) || !onCurve(b, point)) continue;
    if (hits.some((h) => samePoint(h.point, point))) continue;
    const hit = { a: a.id, b: b.id, point, ta: nearestParam(a, point), tb: nearestParam(b, point) };
    hits.push(Object.freeze(overlap ? { ...hit, overlap: true as const } : hit));
  }
  return hits.sort((x, y) => x.ta - y.ta);
}

function carrier(c: AnalyticRound): Circle {
  if (c.kind === 'circle') return c;
  return { center: c.center, radius: Math.hypot(c.from[0] - c.center[0], c.from[1] - c.center[1]) };
}

/** Whether a point of the carrier lies within the range of the curve. */
function onCurve(c: Analytic, p: Vec2): boolean {
  return samePoint(pointAt(c, nearestParam(c, p)), p);
}

/** Points that are distinct within the point tolerance, the first of each group. */
function distinct(points: readonly Vec2[]): Vec2[] {
  return points.filter((p, i) => !points.slice(0, i).some((q) => samePoint(p, q)));
}

function lineLine(a: AnalyticLine, b: AnalyticLine): Candidate[] {
  const d1: Vec2 = [a.to[0] - a.from[0], a.to[1] - a.from[1]];
  const d2: Vec2 = [b.to[0] - b.from[0], b.to[1] - b.from[1]];
  const w: Vec2 = [b.from[0] - a.from[0], b.from[1] - a.from[1]];
  const denom = d1[0] * d2[1] - d1[1] * d2[0];
  if (Math.abs(denom) > 1e-12 * Math.hypot(...d1) * Math.hypot(...d2)) {
    const s = (w[0] * d2[1] - w[1] * d2[0]) / denom;
    return [{ point: pointAt(a, s), overlap: false }];
  }
  // Parallel: collinear lines overlap between the ends of each lying on the other.
  const off = Math.abs(w[0] * d1[1] - w[1] * d1[0]) / Math.hypot(...d1);
  if (off > pointTolerance(a.from, b.from)) return [];
  const ends = distinct([a.from, a.to, b.from, b.to].filter((p) => onCurve(a, p) && onCurve(b, p)));
  return ends.map((point) => ({ point, overlap: ends.length > 1 }));
}

function lineCircle(line: AnalyticLine, c: Circle): Candidate[] {
  const d: Vec2 = [line.to[0] - line.from[0], line.to[1] - line.from[1]];
  const f: Vec2 = [line.from[0] - c.center[0], line.from[1] - c.center[1]];
  const len2 = d[0] * d[0] + d[1] * d[1];
  // The foot of the perpendicular from the centre, then ± along the line.
  const s0 = -(f[0] * d[0] + f[1] * d[1]) / len2;
  const foot = pointAt(line, s0);
  const h = Math.hypot(foot[0] - c.center[0], foot[1] - c.center[1]);
  const tol = pointTolerance(foot, c.center);
  if (h > c.radius + tol) return [];
  if (Math.abs(h - c.radius) <= tol) return [{ point: foot, overlap: false }];
  const ds = Math.sqrt(c.radius * c.radius - h * h) / Math.sqrt(len2);
  return [
    { point: pointAt(line, s0 - ds), overlap: false },
    { point: pointAt(line, s0 + ds), overlap: false },
  ];
}

function roundRound(a: AnalyticRound, b: AnalyticRound): Candidate[] {
  const ca = carrier(a);
  const cb = carrier(b);
  const dx = cb.center[0] - ca.center[0];
  const dy = cb.center[1] - ca.center[1];
  const d = Math.hypot(dx, dy);
  const tol = pointTolerance(ca.center, cb.center);
  if (d <= tol) {
    // Concentric: the same circle overlaps between the ends of each arc lying on the other (two
    // full circles have no ends: none).
    if (Math.abs(ca.radius - cb.radius) > tol) return [];
    const ends = [a, b].flatMap((c) => (c.kind === 'arc' ? [c.from, c.to] : []));
    return distinct(ends.filter((p) => onCurve(a, p) && onCurve(b, p))).map((point) => ({
      point,
      overlap: true,
    }));
  }
  if (d > ca.radius + cb.radius + tol || d < Math.abs(ca.radius - cb.radius) - tol) return [];
  const along = (d * d + ca.radius * ca.radius - cb.radius * cb.radius) / (2 * d);
  const h = Math.sqrt(Math.max(0, ca.radius * ca.radius - along * along));
  const mid: Vec2 = [ca.center[0] + (along * dx) / d, ca.center[1] + (along * dy) / d];
  if (h <= tol) return [{ point: mid, overlap: false }];
  return [
    { point: [mid[0] - (h * dy) / d, mid[1] + (h * dx) / d], overlap: false },
    { point: [mid[0] + (h * dy) / d, mid[1] - (h * dx) / d], overlap: false },
  ];
}
