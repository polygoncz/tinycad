import { describe, expect, it } from 'vitest';
import { cameraGesture, wheelFactor } from './camera-input';

describe('cameraGesture', () => {
  it.each([
    [2, false, false, 'orbit'],
    [2, true, false, 'pan'],
    [2, false, true, 'pan'],
    [2, true, true, 'pan'],
    [1, false, false, 'pan'],
    [1, true, false, 'orbit'],
    [1, false, true, 'orbit'],
    [1, true, true, 'orbit'],
    [0, false, false, null],
    [0, true, false, null],
    [0, false, true, null],
    [0, true, true, null],
  ] as const)('button %i, shift %s, mod %s → %s', (button, shift, mod, gesture) => {
    expect(cameraGesture(button, shift, mod)).toBe(gesture);
  });
});

describe('wheelFactor', () => {
  it('pixels: exp(−0.002 · deltaY)', () => {
    expect(wheelFactor(100, 0, 600)).toBeCloseTo(Math.exp(-0.2), 12);
  });

  it('lines count 16 px', () => {
    expect(wheelFactor(3, 1, 600)).toBeCloseTo(Math.exp(-0.002 * 48), 12);
  });

  it('pages count the canvas height', () => {
    expect(wheelFactor(1, 2, 500)).toBeCloseTo(Math.exp(-1), 12);
  });

  it('negative deltaY (wheel up) zooms in, positive out, zero keeps', () => {
    expect(wheelFactor(-100, 0, 600)).toBeGreaterThan(1);
    expect(wheelFactor(100, 0, 600)).toBeLessThan(1);
    expect(wheelFactor(0, 0, 600)).toBe(1);
  });
});
