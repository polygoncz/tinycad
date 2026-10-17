// The comparison of shared cases (spec 13, Porovnání a tolerance): same keys, same array
// lengths, numbers within the tolerance picked by the key name, the path to the first difference.

import { describe, expect, it } from 'vitest';
import { DEFAULT_TOLERANCE, firstDifference, resolveTolerance } from './compare';

describe('firstDifference', () => {
  it('finds no difference between equal values', () => {
    const value = { ok: { a: [1, 'x', true, null], b: { c: 2 } } };
    expect(firstDifference(value, structuredClone(value))).toBeUndefined();
  });

  it('reports a missing and an unexpected key', () => {
    expect(firstDifference({ ok: { a: 1, b: 2 } }, { ok: { a: 1 } })).toBe(
      'expected.ok.b: missing in the actual value',
    );
    expect(firstDifference({ ok: { a: 1 } }, { ok: { a: 1, c: 3 } })).toBe(
      'expected.ok.c: unexpected key',
    );
  });

  it('tells ok from error', () => {
    expect(firstDifference({ ok: {} }, { error: { code: 'X' } })).toBe(
      'expected.ok: missing in the actual value',
    );
  });

  it('reports a different length of an array', () => {
    expect(firstDifference({ hits: [1, 2] }, { hits: [1, 2, 3] })).toBe(
      'expected.hits: length 2 ≠ 3',
    );
  });

  it('compares arrays in order', () => {
    expect(firstDifference({ ids: ['a', 'b'] }, { ids: ['b', 'a'] })).toBe(
      'expected.ids[0]: "a" ≠ "b"',
    );
  });

  it('compares strings, booleans and null exactly', () => {
    expect(firstDifference({ s: 'a' }, { s: 'A' })).toBe('expected.s: "a" ≠ "A"');
    expect(firstDifference({ b: true }, { b: false })).toBe('expected.b: true ≠ false');
    expect(firstDifference({ n: null }, { n: 0 })).toBe('expected.n: null ≠ 0');
    expect(firstDifference({ n: 0 }, { n: null })).toBe('expected.n: 0 ≠ null');
    expect(firstDifference({ n: [] }, { n: {} })).toBe('expected.n: [] ≠ {}');
  });

  it('compares numbers absolutely with the length tolerance', () => {
    expect(firstDifference({ x: 1 }, { x: 1 + 0.9e-6 })).toBeUndefined();
    expect(firstDifference({ x: 1 }, { x: 1.000002 })).toBe('expected.x: 1 ≠ 1.000002');
    // Parameters of curves are lengths too.
    expect(firstDifference({ ta: 0, tb: 1 }, { ta: 0.5e-6, tb: 1 - 0.5e-6 })).toBeUndefined();
  });

  it('compares counts exactly through the length tolerance', () => {
    expect(firstDifference({ dof: 2 }, { dof: 3 })).toBe('expected.dof: 2 ≠ 3');
  });

  it('compares volume relatively', () => {
    expect(firstDifference({ volume: 1000 }, { volume: 1000.0009 })).toBeUndefined();
    expect(firstDifference({ volume: 1000 }, { volume: 1000.002 })).toBe(
      'expected.volume: 1000 ≠ 1000.002',
    );
    const loose = resolveTolerance({ relative: 1e-3 });
    expect(firstDifference({ volume: 1000 }, { volume: 999.2 }, loose)).toBeUndefined();
    expect(firstDifference({ volume: 1000 }, { volume: 998.9 }, loose)).toBe(
      'expected.volume: 1000 ≠ 998.9',
    );
  });

  it('compares angle absolutely with the angle tolerance', () => {
    expect(firstDifference({ angle: 1 }, { angle: 1 + 0.5e-9 })).toBeUndefined();
    expect(firstDifference({ angle: 1 }, { angle: 1.00000001 })).toBe(
      'expected.angle: 1 ≠ 1.00000001',
    );
  });

  it('takes the tolerance by the nearest key, also inside arrays', () => {
    expect(firstDifference({ volume: [1000] }, { volume: [1000.0009] })).toBeUndefined();
    expect(firstDifference({ angle: { x: 1 } }, { angle: { x: 1 + 1e-7 } })).toBeUndefined();
  });

  it('writes the path to the first difference', () => {
    expect(
      firstDifference(
        { ok: { bodies: [{ volume: 1000 }, { volume: 5 }] } },
        { ok: { bodies: [{ volume: 1000 }, { volume: 6 }] } },
      ),
    ).toBe('expected.ok.bodies[1].volume: 5 ≠ 6');
  });

  it('quotes keys that are not identifiers in the path', () => {
    expect(firstDifference({ statuses: { 'f-1': 'a' } }, { statuses: { 'f-1': 'b' } })).toBe(
      'expected.statuses["f-1"]: "a" ≠ "b"',
    );
  });
});

describe('resolveTolerance', () => {
  it('fills the defaults of spec 13', () => {
    expect(DEFAULT_TOLERANCE).toEqual({ length: 1e-6, angle: 1e-9, relative: 1e-6 });
    expect(resolveTolerance(undefined)).toEqual(DEFAULT_TOLERANCE);
    expect(resolveTolerance({ length: 1e-3 })).toEqual({
      length: 1e-3,
      angle: 1e-9,
      relative: 1e-6,
    });
  });
});
