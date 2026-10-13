import { describe, expect, it } from 'vitest';
import { EMPTY_NAMES, EMPTY_STATE } from './state';

describe('EMPTY_STATE', () => {
  it('has no bodies', () => {
    expect(EMPTY_STATE.bodies.size).toBe(0);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(EMPTY_STATE)).toBe(true);
  });
});

describe('EMPTY_NAMES', () => {
  it('is empty and frozen', () => {
    expect(Object.keys(EMPTY_NAMES)).toEqual([]);
    expect(Object.isFrozen(EMPTY_NAMES)).toBe(true);
  });
});
