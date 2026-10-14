import { describe, expect, it } from 'vitest';
import { createFade, VIEW_CUBE_OPACITY } from './view-cube-fade';

describe('VIEW_CUBE_OPACITY', () => {
  it('is 0.55 at rest, 1 under the pointer, 150 ms (spec 09, "Vzhled")', () => {
    expect(VIEW_CUBE_OPACITY).toEqual({ rest: 0.55, active: 1, duration: 150 });
  });
});

describe('createFade', () => {
  it('starts at the initial value and does not run', () => {
    const fade = createFade(0.55, 150);
    expect(fade.value).toBe(0.55);
    expect(fade.tick(1000)).toBe(false);
    expect(fade.value).toBe(0.55);
  });

  it('runs linearly to the target over the duration', () => {
    const fade = createFade(0.5, 100);
    fade.setTarget(1, 1000);
    expect(fade.tick(1050)).toBe(true);
    expect(fade.value).toBeCloseTo(0.75);
    expect(fade.tick(1100)).toBe(false);
    expect(fade.value).toBe(1);
  });

  it('a tick before the start keeps the start value', () => {
    const fade = createFade(0.5, 100);
    fade.setTarget(1, 1000);
    expect(fade.tick(990)).toBe(true);
    expect(fade.value).toBe(0.5);
  });

  it('a new target during a run starts from the value at that moment', () => {
    const fade = createFade(0.5, 100);
    fade.setTarget(1, 0);
    fade.setTarget(0.5, 50);
    expect(fade.tick(50)).toBe(true);
    expect(fade.value).toBeCloseTo(0.75);
    expect(fade.tick(100)).toBe(true);
    expect(fade.value).toBeCloseTo(0.625);
    expect(fade.tick(150)).toBe(false);
    expect(fade.value).toBe(0.5);
  });

  it('the same target changes nothing', () => {
    const fade = createFade(1, 100);
    fade.setTarget(1, 0);
    expect(fade.tick(10)).toBe(false);
    expect(fade.value).toBe(1);
  });

  it('a target reached long ago is done on the next tick (e.g. after a remount)', () => {
    const fade = createFade(1, 100);
    fade.setTarget(0.5, 0);
    expect(fade.tick(1e6)).toBe(false);
    expect(fade.value).toBe(0.5);
  });
});
