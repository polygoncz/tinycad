import { describe, expect, it } from 'vitest';
import { isJsonObject, isJsonValue } from './json';

describe('isJsonValue', () => {
  it.each([
    ['null', null],
    ['a string', ''],
    ['true', true],
    ['false', false],
    ['zero', 0],
    ['minus zero', -0],
    ['a finite number', -12.5],
    ['an empty array', []],
    ['an empty object', {}],
    ['an object without prototype', Object.create(null) as unknown],
    ['nested data', { a: [1, 'x', null, { b: [true] }], c: { d: {} } }],
    ['frozen data', Object.freeze({ a: Object.freeze([1, 2]) })],
  ])('accepts %s', (_, value) => {
    expect(isJsonValue(value)).toBe(true);
  });

  it.each([
    ['undefined', undefined],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
    ['a bigint', 1n],
    ['a symbol', Symbol('s')],
    ['a function', () => 1],
    ['a Date', new Date(0)],
    ['a Map', new Map()],
    ['a Set', new Set()],
    ['a typed array', new Float64Array(3)],
    [
      'a class instance',
      new (class Params {
        width = 1;
      })(),
    ],
    ['undefined in an object', { x: undefined }],
    ['undefined in an array', [1, undefined]],
    // JSON.stringify writes a hole as null, so the array would come back changed.
    ['an array with a hole', new Array<unknown>(3)],
    ['NaN deep inside', { list: [{ v: Number.NaN }] }],
    ['Infinity deep inside', [[[Number.POSITIVE_INFINITY]]]],
  ])('rejects %s', (_, value) => {
    expect(isJsonValue(value)).toBe(false);
  });
});

describe('isJsonObject', () => {
  it('accepts a plain JSON object', () => {
    expect(
      isJsonObject({ size: 1, list: [1, 2], ref: { kind: 'plane', id: 'origin/plane:xy' } }),
    ).toBe(true);
  });

  it.each([
    ['null', null],
    ['an array', []],
    ['a string', 'x'],
    ['a number', 1],
    ['an object with NaN', { x: Number.NaN }],
    ['an object with undefined', { x: undefined }],
    ['a Date', new Date(0)],
  ])('rejects %s', (_, value) => {
    expect(isJsonObject(value)).toBe(false);
  });

  it('checks hundreds of sketch entities without trouble', () => {
    const entities = Array.from({ length: 500 }, (_, i) => ({
      id: `p${String(i)}`,
      kind: 'point',
      x: i,
      y: -i,
    }));
    expect(isJsonObject({ entities, constraints: [] })).toBe(true);
    const broken = entities.with(499, { id: 'p499', kind: 'point', x: Number.NaN, y: 0 });
    expect(isJsonObject({ entities: broken, constraints: [] })).toBe(false);
  });
});
