import { describe, expect, it } from 'vitest';
import { assert, assertNever } from './assert';

describe('assert', () => {
  it('passes on a truthy condition', () => {
    expect(() => {
      assert(1 + 1 === 2);
    }).not.toThrow();
  });

  it('throws with the given message on a falsy condition', () => {
    expect(() => {
      assert(false, 'must not happen');
    }).toThrow('must not happen');
  });

  it('throws a default message when none is given', () => {
    expect(() => {
      assert(null);
    }).toThrow('Assertion failed');
  });

  it('narrows the type of the asserted value', () => {
    const v = new Map([['k', 'x']]).get('k'); // string | undefined
    assert(v !== undefined);
    expect(v.length).toBe(1);
  });
});

describe('assertNever', () => {
  type Shape = { kind: 'box' } | { kind: 'cylinder' };

  function name(s: Shape): string {
    switch (s.kind) {
      case 'box':
        return 'Box';
      case 'cylinder':
        return 'Cylinder';
      default:
        return assertNever(s);
    }
  }

  it('is unreachable for exhaustive switches', () => {
    expect(name({ kind: 'box' })).toBe('Box');
  });

  it('throws when an unexpected value slips through at runtime', () => {
    expect(() => assertNever('sphere' as never)).toThrow('Unexpected value: sphere');
  });
});
