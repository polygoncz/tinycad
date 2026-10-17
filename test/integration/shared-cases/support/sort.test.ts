// The orderings the shared-case runners apply before recording and comparing (spec 13): total,
// independent of the stability of the sort, strings by UTF-16 code units.

import { describe, expect, it } from 'vitest';
import type { ProfileCurve, ProfileRegion } from '@/kernel';
import {
  canonicalJson,
  compareIssues,
  compareStrings,
  normalizeLoop,
  normalizeOutline,
  sortKey,
} from './sort';

describe('compareStrings', () => {
  it('orders by UTF-16 code units, not by locale', () => {
    expect(['b', 'a', 'B', 'é', 'e'].sort(compareStrings)).toEqual(['B', 'a', 'b', 'e', 'é']);
    expect(compareStrings('x', 'x')).toBe(0);
  });
});

describe('canonicalJson', () => {
  it('sorts the keys of every object, arrays keep their order', () => {
    expect(canonicalJson({ b: 1, a: { d: [2, 1], c: 'x' } })).toBe(
      '{"a":{"c":"x","d":[2,1]},"b":1}',
    );
  });

  it('is empty for undefined', () => {
    expect(canonicalJson(undefined)).toBe('');
  });
});

describe('compareIssues', () => {
  it('orders by param, then code, then the canonical JSON of params', () => {
    const issues = [
      { param: 'b', code: 'param.missing' },
      { param: 'a', code: 'param.tooFewRefs', params: { min: 1 } },
      { param: 'a', code: 'param.invalidRef', params: { index: 2 } },
      { param: 'a', code: 'param.invalidRef', params: { index: 1 } },
      { param: 'a', code: 'param.invalidRef' },
    ];
    expect([...issues].sort(compareIssues)).toEqual([
      { param: 'a', code: 'param.invalidRef' },
      { param: 'a', code: 'param.invalidRef', params: { index: 1 } },
      { param: 'a', code: 'param.invalidRef', params: { index: 2 } },
      { param: 'a', code: 'param.tooFewRefs', params: { min: 1 } },
      { param: 'b', code: 'param.missing' },
    ]);
  });

  it('does not depend on the order of the keys of params', () => {
    expect(
      compareIssues(
        { param: 'a', code: 'c', params: { x: 1, y: 2 } },
        { param: 'a', code: 'c', params: { y: 2, x: 1 } },
      ),
    ).toBe(0);
  });

  it('gives the same order from any input order (no reliance on stability)', () => {
    const issues = [
      { param: 'a', code: 'c', params: { i: 3 } },
      { param: 'a', code: 'c', params: { i: 1 } },
      { param: 'a', code: 'c', params: { i: 2 } },
    ];
    const sorted = [...issues].sort(compareIssues);
    expect([...issues].reverse().sort(compareIssues)).toEqual(sorted);
  });
});

describe('sortKey', () => {
  it('rounds to 6 decimals, half away from zero, without -0', () => {
    expect(sortKey(1.0000004)).toBe(sortKey(1));
    expect(sortKey(1.0000006)).not.toBe(sortKey(1));
    expect(sortKey(0.0000025)).toBe(3);
    expect(sortKey(-0.0000025)).toBe(-3);
    expect(Object.is(sortKey(-1e-9), 0)).toBe(true);
  });
});

/** A line with an id, its geometry does not matter to the ordering. */
function line(id: string): ProfileCurve {
  return { kind: 'line', from: [0, 0], to: [1, 0], id };
}

function ids(loop: readonly ProfileCurve[]): readonly string[] {
  return loop.map((c) => c.id ?? '');
}

describe('normalizeLoop', () => {
  it('starts at the smallest id and keeps the direction', () => {
    expect(ids(normalizeLoop(['cd', 'da', 'ab', 'bc'].map(line)))).toEqual([
      'ab',
      'bc',
      'cd',
      'da',
    ]);
    // A loop in the other direction stays in its direction.
    expect(ids(normalizeLoop(['cd', 'bc', 'ab', 'da'].map(line)))).toEqual([
      'ab',
      'da',
      'cd',
      'bc',
    ]);
  });

  it('compares the ids by code units and takes a missing id as ""', () => {
    expect(ids(normalizeLoop(['b', 'B', 'a'].map(line)))).toEqual(['B', 'a', 'b']);
    const noId: ProfileCurve = { kind: 'circle', center: [0, 0], radius: 1 };
    expect(normalizeLoop([line('a'), noId])[0]).toBe(noId);
  });

  it('keeps an empty loop', () => {
    expect(normalizeLoop([])).toEqual([]);
  });
});

describe('normalizeOutline', () => {
  it('normalizes the outer loop and every hole and sorts the holes by their smallest id', () => {
    const region: ProfileRegion = {
      name: 'a,b,c,h,i,k',
      outer: ['c', 'a', 'b'].map(line),
      holes: [['k'].map(line), ['i', 'h'].map(line)],
      area: 5,
    };
    const normalized = normalizeOutline(region);
    expect(normalized.name).toBe('a,b,c,h,i,k');
    expect(normalized.area).toBe(5);
    expect(ids(normalized.outer)).toEqual(['a', 'b', 'c']);
    expect(normalized.holes.map(ids)).toEqual([['h', 'i'], ['k']]);
  });
});
