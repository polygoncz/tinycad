import { describe, expect, it } from 'vitest';
import { flattenPoints, validateOverlayShapes } from '@/render/overlay-shapes';

describe('flattenPoints', () => {
  it('turns points into xyz triples', () => {
    expect([
      ...flattenPoints([
        [1, 2, 3],
        [4, 5, 6],
      ]),
    ]).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('returns an empty array for no points', () => {
    expect(flattenPoints([])).toHaveLength(0);
  });
});

describe('validateOverlayShapes', () => {
  it('accepts lines with pairs of points and points of any count', () => {
    expect(() => {
      validateOverlayShapes([
        {
          kind: 'lines',
          points: [
            [0, 0, 0],
            [1, 0, 0],
          ],
          style: 'preview',
        },
        { kind: 'points', points: [[0, 0, 0]], style: 'construction' },
        { kind: 'lines', points: [], style: 'construction' },
      ]);
    }).not.toThrow();
  });

  it('rejects lines with an odd number of points', () => {
    expect(() => {
      validateOverlayShapes([
        {
          kind: 'lines',
          points: [
            [0, 0, 0],
            [1, 0, 0],
            [2, 0, 0],
          ],
          style: 'preview',
        },
      ]);
    }).toThrow(/even/);
  });
});
