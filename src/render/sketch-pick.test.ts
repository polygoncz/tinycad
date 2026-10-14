import { describe, expect, it } from 'vitest';
import { betterSketchHit, pickSketch, type SketchHit } from './sketch-pick';

const f = (...values: number[]): Float32Array => new Float32Array(values);

describe('pickSketch', () => {
  it('prefers a point within the tolerance over a nearer curve', () => {
    // The segment passes right under the cursor, the point is 4 px away.
    const hit = pickSketch(f(0, 10, 100, 10), f(54, 10), 50, 10);
    expect(hit).toEqual({ kind: 'point', index: 0, distancePx: 4 });
  });

  it('gives the nearest of two points', () => {
    const hit = pickSketch(f(), f(10, 10, 52, 50, 49, 50), 50, 50);
    expect(hit).toMatchObject({ kind: 'point', index: 2 });
  });

  it('gives the nearest of two curves with the parameter on it', () => {
    const hit = pickSketch(f(0, 0, 100, 0, 0, 3, 100, 3), f(), 25, 4);
    expect(hit).toMatchObject({ kind: 'segment', index: 1, t: 0.25 });
    expect(hit?.distancePx).toBeCloseTo(1, 6);
  });

  it('gives null outside the tolerance', () => {
    expect(pickSketch(f(0, 0, 100, 0), f(50, 20), 50, 7)).toBeNull();
    expect(pickSketch(f(), f(), 0, 0)).toBeNull();
  });

  it('honours a custom tolerance and skips points off the view (NaN)', () => {
    expect(pickSketch(f(), f(60, 0), 50, 0, 12)).toMatchObject({ kind: 'point', index: 0 });
    expect(pickSketch(f(), f(NaN, NaN, 51, 0), 50, 0)).toMatchObject({ kind: 'point', index: 1 });
  });

  it('rejects screen points with an odd length', () => {
    expect(() => pickSketch(f(), f(1, 2, 3), 0, 0)).toThrow();
  });
});

describe('betterSketchHit', () => {
  const point = (distancePx: number): SketchHit => ({ kind: 'point', index: 0, distancePx });
  const segment = (distancePx: number): SketchHit => ({
    kind: 'segment',
    index: 0,
    t: 0,
    distancePx,
  });

  it('prefers a point of another drawing over a nearer curve', () => {
    expect(betterSketchHit(point(5), segment(1))).toBe(true);
    expect(betterSketchHit(segment(1), point(5))).toBe(false);
  });

  it('prefers the nearer hit of the same kind and keeps the first on a tie', () => {
    expect(betterSketchHit(segment(1), segment(2))).toBe(true);
    expect(betterSketchHit(point(3), point(2))).toBe(false);
    expect(betterSketchHit(point(2), point(2))).toBe(false);
  });
});
