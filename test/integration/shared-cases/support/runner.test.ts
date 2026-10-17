// The outcome of a runner goes through JSON before it is recorded or compared (spec 13, Obálka):
// a NaN or an infinity would silently become null there, so it fails the case with its path.

import { describe, expect, it } from 'vitest';
import { asJson, recordsCases } from './runner';

describe('asJson', () => {
  it('drops undefined keys like a file read back would', () => {
    expect(asJson({ ok: { a: 1, b: undefined, c: [1.5, 'x', null, true] } })).toEqual({
      ok: { a: 1, c: [1.5, 'x', null, true] },
    });
  });

  it.each([
    [Number.NaN, 'NaN'],
    [Number.POSITIVE_INFINITY, 'Infinity'],
    [Number.NEGATIVE_INFINITY, '-Infinity'],
  ])('throws on %s with the path of the number', (value, shown) => {
    expect(() => asJson({ ok: { bodies: [{ volume: 1 }, { volume: value }] } })).toThrow(
      `outcome.ok.bodies[1].volume: ${shown} is not a finite number`,
    );
  });

  it('names a key that is not an identifier in brackets', () => {
    expect(() => asJson({ ok: { statuses: { 'f-1': Number.NaN } } })).toThrow(
      'outcome.ok.statuses["f-1"]: NaN is not a finite number',
    );
  });
});

describe('recordsCases', () => {
  it('records only with CASES_RECORD=1 and not for a runner whose cases are not recorded', () => {
    expect(recordsCases({}, { CASES_RECORD: '1' })).toBe(true);
    expect(recordsCases({ recorded: true }, { CASES_RECORD: '1' })).toBe(true);
    expect(recordsCases({ recorded: false }, { CASES_RECORD: '1' })).toBe(false);
    expect(recordsCases({}, {})).toBe(false);
  });
});
