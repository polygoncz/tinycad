import { describe, expect, it } from 'vitest';
import { ccwSweep } from '@/sketcher/sketch-angles';

describe('ccwSweep', () => {
  it('measures the counter-clockwise sweep from a to b', () => {
    expect(ccwSweep(0, Math.PI / 2)).toBeCloseTo(Math.PI / 2);
    expect(ccwSweep(Math.PI / 2, 0)).toBeCloseTo((3 * Math.PI) / 2);
  });

  it('gives a full turn for equal angles, never zero', () => {
    expect(ccwSweep(1, 1)).toBeCloseTo(2 * Math.PI);
  });

  it('normalises angles outside one turn into (0, 2π]', () => {
    expect(ccwSweep(-Math.PI, 3 * Math.PI)).toBeCloseTo(2 * Math.PI);
    expect(ccwSweep(0, 5 * Math.PI)).toBeCloseTo(Math.PI);
  });
});
