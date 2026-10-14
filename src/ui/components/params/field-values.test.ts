import { describe, expect, it } from 'vitest';
import {
  asPoint,
  degToRad,
  formatNumber,
  parseNumber,
  radToDeg,
  refListText,
  withCoordinate,
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

describe('refListText', () => {
  it('shows the count of an inactive field', () => {
    expect(refListText(['a', 'b'], false)).toEqual({ key: 'field.refs.count', params: { n: 2 } });
    expect(refListText([], false)).toEqual({ key: 'field.refs.count', params: { n: 0 } });
  });

  it('shows the count and the hint of the active field (R87)', () => {
    expect(refListText(['a'], true)).toEqual({ key: 'field.refs.countPick', params: { n: 1 } });
    expect(refListText([], true)).toEqual({ key: 'field.refs.countPick', params: { n: 0 } });
  });

  it('counts a value that is not a list as empty', () => {
    expect(refListText(undefined, false)).toEqual({ key: 'field.refs.count', params: { n: 0 } });
    expect(refListText('x', true)).toEqual({ key: 'field.refs.countPick', params: { n: 0 } });
  });
});
