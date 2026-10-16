import { describe, expect, it } from 'vitest';
import { overlappingPairs, type Box } from '@/kernel-occt/geom2d';

// The bounding box prefilter shared by the regions and the curve intersections (M33).

describe('overlappingPairs', () => {
  it('gives each pair of overlapping boxes once, as [smaller, larger] index', () => {
    const boxes: Box[] = [
      [5, 0, 6, 1],
      [0, 0, 2, 2],
      [1, 1, 3, 3],
      [10, 10, 11, 11],
      [2.5, -5, 3, -4],
    ];
    expect(overlappingPairs(boxes)).toEqual([[1, 2]]);
  });

  it('boxes touching at an edge overlap', () => {
    const boxes: Box[] = [
      [1, 0, 2, 1],
      [0, 0, 1, 1],
    ];
    expect(overlappingPairs(boxes)).toEqual([[0, 1]]);
  });

  it('no boxes, one box: no pairs', () => {
    expect(overlappingPairs([])).toEqual([]);
    expect(overlappingPairs([[0, 0, 1, 1]])).toEqual([]);
  });
});
