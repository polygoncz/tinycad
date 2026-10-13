import { describe, expect, it } from 'vitest';
import {
  asPoint,
  bodyRefItems,
  degToRad,
  formatNumber,
  parseNumber,
  radToDeg,
  withCoordinate,
  withoutIndex,
} from './field-values';

describe('parseNumber', () => {
  it('reads plain and decimal numbers, with a dot or a comma', () => {
    expect(parseNumber('30')).toBe(30);
    expect(parseNumber(' -2.5 ')).toBe(-2.5);
    expect(parseNumber('2,5')).toBe(2.5);
    expect(parseNumber('0')).toBe(0);
  });

  it('rejects empty, non-numeric and non-finite text', () => {
    expect(parseNumber('')).toBeNull();
    expect(parseNumber('  ')).toBeNull();
    expect(parseNumber('abc')).toBeNull();
    expect(parseNumber('1e999')).toBeNull();
    expect(parseNumber('Infinity')).toBeNull();
    expect(parseNumber('1,2,3')).toBeNull();
  });
});

describe('formatNumber', () => {
  it('drops floating point noise', () => {
    expect(formatNumber(30)).toBe('30');
    expect(formatNumber(29.999999999999996)).toBe('30');
    expect(formatNumber(0.1 + 0.2)).toBe('0.3');
    expect(formatNumber(-2.5)).toBe('-2.5');
  });

  it('shows a non-number as empty text', () => {
    expect(formatNumber(undefined)).toBe('');
    expect(formatNumber('x')).toBe('');
    expect(formatNumber(Number.NaN)).toBe('');
  });
});

describe('points', () => {
  it('asPoint accepts three finite numbers only', () => {
    expect(asPoint([1, 2, 3])).toEqual([1, 2, 3]);
    expect(asPoint([1, 2])).toBeNull();
    expect(asPoint([1, 2, 3, 4])).toBeNull();
    expect(asPoint([1, '2', 3])).toBeNull();
    expect(asPoint([1, Number.NaN, 3])).toBeNull();
    expect(asPoint('1,2,3')).toBeNull();
    expect(asPoint(undefined)).toBeNull();
  });

  it('withCoordinate replaces one coordinate in a new point', () => {
    const p = [1, 2, 3] as const;
    expect(withCoordinate(p, 0, 9)).toEqual([9, 2, 3]);
    expect(withCoordinate(p, 1, 9)).toEqual([1, 9, 3]);
    expect(withCoordinate(p, 2, 9)).toEqual([1, 2, 9]);
    expect(p).toEqual([1, 2, 3]);
  });
});

describe('angles', () => {
  it('convert between radians (document) and degrees (UI)', () => {
    expect(radToDeg(Math.PI)).toBeCloseTo(180);
    expect(degToRad(90)).toBeCloseTo(Math.PI / 2);
    expect(formatNumber(radToDeg(degToRad(30)))).toBe('30');
  });
});

describe('bodyRefItems', () => {
  it('lists the body references with their index in the value', () => {
    const value = [
      { kind: 'body', body: 'a/body' },
      { kind: 'topo', body: 'b/body', name: 'x' },
      { kind: 'body', body: 'c/body:2' },
    ];
    expect(bodyRefItems(value)).toEqual([
      { index: 0, body: 'a/body' },
      { index: 2, body: 'c/body:2' },
    ]);
  });

  it('skips anything that is not a body reference; a non-array is empty', () => {
    expect(bodyRefItems([null, 1, { kind: 'body' }, { kind: 'body', body: 3 }])).toEqual([]);
    expect(bodyRefItems(undefined)).toEqual([]);
    expect(bodyRefItems({ kind: 'body', body: 'a/body' })).toEqual([]);
  });
});

describe('withoutIndex', () => {
  it('drops the item at the index and keeps the rest in order', () => {
    expect(withoutIndex(['a', 'b', 'c'], 1)).toEqual(['a', 'c']);
  });

  it('a non-array value becomes empty', () => {
    expect(withoutIndex('junk', 0)).toEqual([]);
  });
});
