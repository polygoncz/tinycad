import { describe, expect, it } from 'vitest';
import { cubeNdc, isDrag, VIEW_CUBE, viewCubeRect } from '@/render/view-cube-layout';

describe('VIEW_CUBE', () => {
  it('has the sizes from spec 09', () => {
    expect(VIEW_CUBE).toEqual({ box: 132, cube: 96, margin: 8, dragThreshold: 3 });
  });
});

describe('viewCubeRect', () => {
  it('places the cube square top right in CSS px, y from the bottom', () => {
    expect(viewCubeRect(800, 600)).toEqual({ x: 800 - 122, y: 600 - 122, size: 96 });
  });
});

describe('cubeNdc', () => {
  it('maps the centre of the cube square to (0, 0)', () => {
    expect(cubeNdc(66, 66)).toEqual({ x: 0, y: 0 });
  });

  it('maps the corners of the square to ±1 with y up', () => {
    expect(cubeNdc(18, 18)).toEqual({ x: -1, y: 1 });
    expect(cubeNdc(114, 114)).toEqual({ x: 1, y: -1 });
    expect(cubeNdc(114, 18)).toEqual({ x: 1, y: 1 });
  });

  it('returns null outside the square', () => {
    expect(cubeNdc(17.9, 66)).toBeNull();
    expect(cubeNdc(66, 114.1)).toBeNull();
    expect(cubeNdc(5, 5)).toBeNull();
    expect(cubeNdc(130, 66)).toBeNull();
  });
});

describe('isDrag', () => {
  it('is false up to the threshold and true beyond it', () => {
    expect(isDrag(10, 10, 13, 10)).toBe(false);
    expect(isDrag(10, 10, 13.01, 10)).toBe(true);
    expect(isDrag(10, 10, 10, 6.99)).toBe(true);
    expect(isDrag(0, 0, 2, 2)).toBe(false);
    expect(isDrag(0, 0, 0, 0)).toBe(false);
  });
});
