// Comparing the output of a runner with the expected output of a shared case (spec 13,
// Porovnání a tolerance): objects by their keys, arrays in order, strings, booleans and null
// exactly, numbers within a tolerance chosen by the name of the nearest key.

import type { Tolerance } from './case';

/** The defaults of spec 13 (Q110): length 1e-6 and angle 1e-9 absolutely, relative 1e-6. */
export const DEFAULT_TOLERANCE: Tolerance = Object.freeze({
  length: 1e-6,
  angle: 1e-9,
  relative: 1e-6,
});

/** The defaults overridden by the tolerance of a case. */
export function resolveTolerance(override: Partial<Tolerance> | undefined): Tolerance {
  return { ...DEFAULT_TOLERANCE, ...override };
}

/**
 * The first difference between two JSON values as `<path>: <expected> ≠ <actual>`
 * (`expected.ok.bodies[0].volume: 1000 ≠ 999.2`), or undefined when they match. Numbers under
 * the key 'volume' compare relatively, under 'angle' with the angle tolerance, the rest with
 * length; an array element takes the key of its array.
 */
export function firstDifference(
  expected: unknown,
  actual: unknown,
  tolerance: Tolerance = DEFAULT_TOLERANCE,
  path = 'expected',
): string | undefined {
  return differenceAt(expected, actual, tolerance, path, undefined);
}

function differenceAt(
  expected: unknown,
  actual: unknown,
  tolerance: Tolerance,
  path: string,
  key: string | undefined,
): string | undefined {
  if (typeof expected === 'number' && typeof actual === 'number') {
    return numbersMatch(expected, actual, tolerance, key)
      ? undefined
      : `${path}: ${show(expected)} ≠ ${show(actual)}`;
  }
  if (Array.isArray(expected) && Array.isArray(actual)) {
    if (expected.length !== actual.length) {
      return `${path}: length ${String(expected.length)} ≠ ${String(actual.length)}`;
    }
    for (let i = 0; i < expected.length; i++) {
      const found = differenceAt(expected[i], actual[i], tolerance, `${path}[${String(i)}]`, key);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (isObject(expected) && isObject(actual)) {
    for (const [k, value] of Object.entries(expected)) {
      if (!(k in actual)) return `${pathOf(path, k)}: missing in the actual value`;
      const found = differenceAt(value, actual[k], tolerance, pathOf(path, k), k);
      if (found !== undefined) return found;
    }
    const extra = Object.keys(actual).find((k) => !(k in expected));
    return extra === undefined ? undefined : `${pathOf(path, extra)}: unexpected key`;
  }
  // Strings, booleans and null exactly; values of different types never match.
  return expected === actual ? undefined : `${path}: ${show(expected)} ≠ ${show(actual)}`;
}

function numbersMatch(
  expected: number,
  actual: number,
  tolerance: Tolerance,
  key: string | undefined,
): boolean {
  const delta = Math.abs(expected - actual);
  if (key === 'volume') return delta <= tolerance.relative * Math.abs(expected);
  if (key === 'angle') return delta <= tolerance.angle;
  return delta <= tolerance.length;
}

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/** The path of a key below its parent: `.key`, or `["key"]` when it is not an identifier. */
export function pathOf(parent: string, key: string): string {
  return IDENTIFIER.test(key) ? `${parent}.${key}` : `${parent}[${JSON.stringify(key)}]`;
}

function show(value: unknown): string {
  return JSON.stringify(value);
}

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
