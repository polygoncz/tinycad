// Test-only entry point of sketch: the FakeSolver and data builders for tests in this and other
// modules. dependency-cruiser allows importing it only from *.test.ts, so it never reaches the
// production bundle.

import type { SketchConstraint, SketchData, SketchEntity } from './model';
import { parseSketchData } from './parse';
import type { ConstraintSolver, SolveInput, SolveResult } from './solver';
import type { SketchGeometry } from './geometry-port';

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
  symmetric: 2,
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
 * The SketchGeometry of tests (M30): the port has no methods yet; M33 and M35 add fakes of theirs
 * here.
 */
export function createFakeSketchGeometry(): SketchGeometry {
  return Object.freeze({});
}
