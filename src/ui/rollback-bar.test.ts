import { describe, expect, it } from 'vitest';
import { rollbackIndexAt } from './rollback-bar';

describe('rollbackIndexAt', () => {
  // Three features of 36 px with 2 px between them, from x = 100: centres 118, 156, 194.
  const items = [
    { left: 100, width: 36 },
    { left: 138, width: 36 },
    { left: 176, width: 36 },
  ];

  it('no features: the bar can only be at 0', () => {
    expect(rollbackIndexAt(50, [])).toBe(0);
    expect(rollbackIndexAt(500, [])).toBe(0);
  });

  it('left of the first centre is 0, right of the last centre is the number of features', () => {
    expect(rollbackIndexAt(0, items)).toBe(0);
    expect(rollbackIndexAt(117, items)).toBe(0);
    expect(rollbackIndexAt(195, items)).toBe(3);
    expect(rollbackIndexAt(1000, items)).toBe(3);
  });

  it('between two centres is the index of the feature on the right', () => {
    expect(rollbackIndexAt(119, items)).toBe(1);
    expect(rollbackIndexAt(155, items)).toBe(1);
    expect(rollbackIndexAt(157, items)).toBe(2);
  });

  it('a pointer right on a centre stays before that feature', () => {
    expect(rollbackIndexAt(118, items)).toBe(0);
    expect(rollbackIndexAt(156, items)).toBe(1);
  });

  it('measures the real boxes: the features after the bar are shifted by its width', () => {
    // The bar of 10 px stands before the second feature: the second and third move right.
    const shifted = [
      { left: 100, width: 36 },
      { left: 148, width: 36 },
      { left: 186, width: 36 },
    ];
    expect(rollbackIndexAt(160, shifted)).toBe(1);
    expect(rollbackIndexAt(167, shifted)).toBe(2);
  });

  it('does not depend on the order of the boxes', () => {
    expect(rollbackIndexAt(160, [...items].reverse())).toBe(2);
  });
});
