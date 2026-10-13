import { describe, expect, it } from 'vitest';
import { meshBounds, unionBounds } from './bounds';

describe('meshBounds', () => {
  it('is the axis-aligned box of all vertices', () => {
    const positions = new Float32Array([1, 2, 3, -1, 5, 0, 4, -2, 7]);
    expect(meshBounds(positions)).toEqual({ min: [-1, -2, 0], max: [4, 5, 7] });
  });

  it('is a degenerate box for a single vertex', () => {
    expect(meshBounds(new Float32Array([1, 2, 3]))).toEqual({ min: [1, 2, 3], max: [1, 2, 3] });
  });

  it('is null without vertices', () => {
    expect(meshBounds(new Float32Array([]))).toBeNull();
  });
});

describe('unionBounds', () => {
  it('is the box around all boxes', () => {
    expect(
      unionBounds([
        { min: [0, 0, 0], max: [10, 10, 10] },
        { min: [20, -5, 2], max: [30, 5, 40] },
      ]),
    ).toEqual({ min: [0, -5, 0], max: [30, 10, 40] });
  });

  it('is the box itself for one box', () => {
    expect(unionBounds([{ min: [1, 2, 3], max: [4, 5, 6] }])).toEqual({
      min: [1, 2, 3],
      max: [4, 5, 6],
    });
  });

  it('is null for no boxes, so fitAll falls back to the default frame', () => {
    expect(unionBounds([])).toBeNull();
  });

  it('skips null boxes (bodies without triangles)', () => {
    expect(unionBounds([null, { min: [1, 2, 3], max: [4, 5, 6] }, null])).toEqual({
      min: [1, 2, 3],
      max: [4, 5, 6],
    });
    expect(unionBounds([null])).toBeNull();
  });

  it('accepts any iterable, e.g. map values', () => {
    const boxes = new Map([['a', { min: [0, 0, 0] as const, max: [1, 1, 1] as const }]]);
    expect(unionBounds(boxes.values())).toEqual({ min: [0, 0, 0], max: [1, 1, 1] });
  });
});
