// The orderings of shared cases that the domain does not define (spec 13, Porovnání a
// tolerance: a runner sorts them before both recording and comparing). Every rule here is total
// and independent of the stability of the sort, because the C++ suite repeats it with std::sort,
// which is not stable; strings compare by UTF-16 code units, never by locale.

import type { ProfileLoop, ProfileRegion } from '@/kernel';

/** By UTF-16 code units (not localeCompare): the same order in every language. */
export function compareStrings(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/**
 * JSON with the keys of every object sorted by UTF-16 code units and no whitespace; '' for
 * undefined (an issue without params sorts first). Numbers are written as JSON.stringify writes
 * them (the shortest round-trip form).
 */
export function canonicalJson(value: unknown): string {
  if (value === undefined) return '';
  return JSON.stringify(canonical(value));
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value !== 'object' || value === null) return value;
  // A non-null, non-array object: rebuilt with its keys in code unit order.
  const record = value as Readonly<Record<string, unknown>>;
  return Object.fromEntries(
    Object.keys(record)
      .sort(compareStrings)
      .map((key) => [key, canonical(record[key])]),
  );
}

/** The shape of a ParamIssue the ordering reads. */
export interface SortableIssue {
  readonly param: string;
  readonly code: string;
  readonly params?: unknown;
}

/**
 * The order of the issues of schema.validate and of an error status of regen (spec 13): by
 * param, code and the canonical JSON of params. Two issues equal in all three are equal as JSON,
 * so their mutual order does not show in the output.
 */
export function compareIssues(a: SortableIssue, b: SortableIssue): number {
  return (
    compareStrings(a.param, b.param) ||
    compareStrings(a.code, b.code) ||
    compareStrings(canonicalJson(a.params), canonicalJson(b.params))
  );
}

/**
 * A number for sorting only (spec 13, regen): rounded to 6 decimals, so noise under the length
 * tolerance does not swap the order. Half away from zero, like std::round of the C++ suite (not
 * Math.round, which rounds half up); the result is an integer number of millionths.
 */
export function sortKey(x: number): number {
  const scaled = Math.sign(x) * Math.round(Math.abs(x) * 1e6);
  // -0 and 0 are the same key.
  return scaled === 0 ? 0 : scaled;
}

/**
 * A loop rotated to start at the curve with the smallest id ("" when missing; the first such
 * curve when an id repeats); the direction and the cyclic order stay (spec 13, regen › sketches).
 */
export function normalizeLoop(loop: ProfileLoop): ProfileLoop {
  let start = 0;
  loop.forEach((curve, i) => {
    if (compareStrings(curve.id ?? '', loop[start]?.id ?? '') < 0) start = i;
  });
  return [...loop.slice(start), ...loop.slice(0, start)];
}

/**
 * A region outline with every loop normalized and the holes sorted by the smallest id of their
 * curves (spec 13, regen › sketches); the name and the area stay.
 */
export function normalizeOutline(region: ProfileRegion): ProfileRegion {
  // After normalizeLoop the first curve of a hole carries its smallest id.
  const firstId = (loop: ProfileLoop) => loop[0]?.id ?? '';
  const holes = region.holes
    .map((hole) => normalizeLoop(hole))
    .sort((a, b) => compareStrings(firstId(a), firstId(b)));
  return { ...region, outer: normalizeLoop(region.outer), holes };
}
