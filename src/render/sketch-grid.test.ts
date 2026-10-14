import { describe, expect, it } from 'vitest';
import { gridLines, sketchGridStep } from './sketch-grid';

describe('sketchGridStep', () => {
  it('gives the smallest 1–2–5 step at least 10 px wide', () => {
    expect(sketchGridStep(0.05)).toBe(0.5);
    expect(sketchGridStep(0.1)).toBe(1);
    expect(sketchGridStep(0.3)).toBe(5);
    expect(sketchGridStep(1.7)).toBe(20);
  });

  it('goes below a millimetre and above a metre', () => {
    expect(sketchGridStep(0.0012)).toBe(0.02);
    expect(sketchGridStep(45)).toBe(500);
  });

  it('gives 1 for an invalid size of a pixel', () => {
    expect(sketchGridStep(0)).toBe(1);
    expect(sketchGridStep(-2)).toBe(1);
    expect(sketchGridStep(Number.POSITIVE_INFINITY)).toBe(1);
    expect(sketchGridStep(Number.NaN)).toBe(1);
  });
});

/** The constant coordinate of every line: u of a line along v, v of a line along u. */
function coordinates(segments: readonly number[]): { u: number[]; v: number[] } {
  const u: number[] = [];
  const v: number[] = [];
  for (let i = 0; i < segments.length; i += 4) {
    const [u0, v0, u1, v1] = segments.slice(i, i + 4);
    if (u0 === u1 && u0 !== undefined) u.push(u0);
    else if (v0 === v1 && v0 !== undefined) v.push(v0);
  }
  return { u: u.sort((a, b) => a - b), v: v.sort((a, b) => a - b) };
}

describe('gridLines', () => {
  it('covers the square around the centre with lines on multiples of the step', () => {
    const { minor, major } = gridLines(1, [0.4, 10.2], 2);
    const all = [...minor, ...major];
    expect(all.length % 4).toBe(0);
    const { u, v } = coordinates(all);
    expect(u).toEqual([-1, 0, 1, 2]);
    expect(v).toEqual([9, 10, 11, 12]);
    // Every line spans the whole square.
    for (let i = 0; i < all.length; i += 4) {
      const [u0, v0, u1, v1] = all.slice(i, i + 4);
      if (u0 === u1) {
        expect(v0).toBeCloseTo(8.2, 9);
        expect(v1).toBeCloseTo(12.2, 9);
      } else {
        expect(u0).toBeCloseTo(-1.6, 9);
        expect(u1).toBeCloseTo(2.4, 9);
      }
    }
  });

  it('makes the lines on multiples of five steps major', () => {
    const { minor, major } = gridLines(2, [0, 0], 12);
    expect(coordinates(major)).toEqual({ u: [-10, 0, 10], v: [-10, 0, 10] });
    expect(coordinates(minor).u).toEqual([-12, -8, -6, -4, -2, 2, 4, 6, 8, 12]);
  });

  it('gives +0, not −0, on the axes', () => {
    const { major } = gridLines(1, [-0.3, -0.3], 0.5);
    const { u } = coordinates(major);
    expect(Object.is(u[0], 0)).toBe(true);
  });

  it('doubles the step until at most 400 lines run along each axis', () => {
    const { minor, major } = gridLines(1, [0, 0], 1000);
    const { u, v } = coordinates([...minor, ...major]);
    expect(u.length).toBeLessThanOrEqual(400);
    expect(v.length).toBeLessThanOrEqual(400);
    // 1 → 2 → 4 → 8: 251 lines from −1000 to 1000.
    expect(u.length).toBe(251);
    expect((u[1] ?? NaN) - (u[0] ?? NaN)).toBe(8);
    expect(coordinates(major).u).toContain(40);
  });

  it('gives no lines for an invalid step or size', () => {
    expect(gridLines(0, [0, 0], 10)).toEqual({ minor: [], major: [] });
    expect(gridLines(1, [0, 0], 0)).toEqual({ minor: [], major: [] });
    expect(gridLines(1, [0, 0], Number.NaN)).toEqual({ minor: [], major: [] });
  });
});
