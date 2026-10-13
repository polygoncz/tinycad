import { describe, expect, it } from 'vitest';
import { closestSegments } from './edge-pick';

const segments = (...coords: number[]) => new Float32Array(coords);

describe('closestSegments', () => {
  it('finds a point on the segment with its parameter', () => {
    const result = closestSegments(segments(0, 0, 10, 0), 4, 3, 6);
    expect(result).toHaveLength(1);
    expect(result[0]?.segment).toBe(0);
    expect(result[0]?.t).toBeCloseTo(0.4);
    expect(result[0]?.distancePx).toBeCloseTo(3);
  });

  it('clamps to the end point beyond the segment', () => {
    const result = closestSegments(segments(0, 0, 10, 0), 13, 4, 6);
    expect(result[0]?.t).toBe(1);
    expect(result[0]?.distancePx).toBeCloseTo(5);

    const before = closestSegments(segments(0, 0, 10, 0), -3, 0, 6);
    expect(before[0]?.t).toBe(0);
    expect(before[0]?.distancePx).toBeCloseTo(3);
  });

  it('skips segments outside the tolerance', () => {
    expect(closestSegments(segments(0, 0, 10, 0), 5, 7, 6)).toEqual([]);
    expect(closestSegments(segments(0, 0, 10, 0), 17, 0, 6)).toEqual([]);
  });

  it('includes a segment exactly at the tolerance', () => {
    expect(closestSegments(segments(0, 0, 10, 0), 5, 6, 6)).toHaveLength(1);
  });

  it('sorts candidates by distance', () => {
    const at5 = [0, 5, 10, 5];
    const at1 = [0, 1, 10, 1];
    const far = [0, 50, 10, 50];
    const at3 = [0, -3, 10, -3];
    const result = closestSegments(segments(...at5, ...at1, ...far, ...at3), 5, 0, 6);
    expect(result.map((c) => c.segment)).toEqual([1, 3, 0]);
    expect(result.map((c) => c.distancePx)).toEqual([1, 3, 5]);
  });

  it('handles a degenerate segment as a point', () => {
    const result = closestSegments(segments(2, 2, 2, 2), 5, 6, 6);
    expect(result).toEqual([{ segment: 0, t: 0, distancePx: 5 }]);
  });

  it('skips segments with NaN coordinates', () => {
    const result = closestSegments(segments(NaN, 0, 10, 0, 0, 1, 10, 1), 5, 0, 6);
    expect(result.map((c) => c.segment)).toEqual([1]);
  });

  it('returns nothing for no segments', () => {
    expect(closestSegments(new Float32Array(0), 0, 0, 6)).toEqual([]);
  });
});
