import { describe, expect, it } from 'vitest';
import { vec3 } from '@/core';
import type { Vec3 } from '@/core';
import {
  EDGE_ON_LIMIT,
  PARALLEL_LIMIT,
  SNAP_STEP,
  angularParam,
  linearParam,
  planarParam,
  pointParam,
  snapValue,
  unwrapDelta,
} from './manipulator-drag';

const X: Vec3 = [1, 0, 0];
const Y: Vec3 = [0, 1, 0];
const Z: Vec3 = [0, 0, 1];
const ORIGIN: Vec3 = [0, 0, 0];

/** A ray straight down -Z through (x, y) from above the XY plane. */
const downAt = (x: number, y: number) => ({
  origin: [x, y, 10] as Vec3,
  direction: [0, 0, -1] as Vec3,
});

describe('constants', () => {
  it('match the spec', () => {
    expect(SNAP_STEP.length).toBe(1);
    expect(SNAP_STEP.angle).toBeCloseTo((5 * Math.PI) / 180, 12);
    expect(PARALLEL_LIMIT).toBe(0.999);
    expect(EDGE_ON_LIMIT).toBe(0.02);
    expect(Object.isFrozen(SNAP_STEP)).toBe(true);
  });
});

describe('linearParam', () => {
  it('gives the exact t for a perpendicular ray', () => {
    expect(linearParam([1, 2, 0], X, downAt(4, 2))).toBeCloseTo(3, 12);
    expect(linearParam([1, 2, 0], X, downAt(-1.5, 7))).toBeCloseTo(-2.5, 12);
  });

  it('gives the parameter of the closest point for an oblique ray', () => {
    // The ray passes the line x-axis at x = 5 from above, tilted in y and z: closest point x = 5.
    const direction = vec3.normalize([0, 1, -1]);
    const ray = { origin: vec3.sub([5, 0, 0], vec3.scale(direction, 10)), direction };
    expect(linearParam(ORIGIN, X, ray)).toBeCloseTo(5, 9);

    // A skew line: the ray (0, 3, 0) + s·(1, 0, 1)/√2 is nearest to the y-axis at y = 3.
    const skew = { origin: [0, 3, 0] as Vec3, direction: vec3.normalize([1, 0, 1]) };
    expect(linearParam(ORIGIN, Y, skew)).toBeCloseTo(3, 9);
  });

  it('accepts a ray direction that is not unit', () => {
    expect(linearParam(ORIGIN, X, { origin: [2, 0, 5], direction: [0, 0, -7] })).toBeCloseTo(2, 12);
  });

  it('gives null for a nearly parallel ray', () => {
    expect(linearParam(ORIGIN, X, { origin: [0, 1, 0], direction: X })).toBeNull();
    expect(linearParam(ORIGIN, X, { origin: [0, 1, 0], direction: [-1, 0.01, 0] })).toBeNull();
  });
});

describe('angularParam', () => {
  it('measures the four quadrants from zero around +Z', () => {
    expect(angularParam(ORIGIN, Z, X, downAt(2, 0))).toBeCloseTo(0, 12);
    expect(angularParam(ORIGIN, Z, X, downAt(0, 2))).toBeCloseTo(Math.PI / 2, 12);
    expect(angularParam(ORIGIN, Z, X, downAt(-2, 0))).toBeCloseTo(Math.PI, 12);
    expect(angularParam(ORIGIN, Z, X, downAt(0, -2))).toBeCloseTo(-Math.PI / 2, 12);
  });

  it('gives π, not −π, on the negative zero direction', () => {
    expect(angularParam(ORIGIN, Z, X, { origin: [-2, -0, 10], direction: [0, 0, -1] })).toBe(
      Math.PI,
    );
  });

  it('flips the sign with the axis', () => {
    const minusZ: Vec3 = [0, 0, -1];
    expect(angularParam(ORIGIN, minusZ, X, downAt(0, 2))).toBeCloseTo(-Math.PI / 2, 12);
    expect(angularParam(ORIGIN, minusZ, X, downAt(0, -2))).toBeCloseTo(Math.PI / 2, 12);
  });

  it('works off the origin and with an oblique ray', () => {
    const center: Vec3 = [1, 1, 3];
    const target: Vec3 = [1, 4, 3];
    const direction = vec3.normalize([1, 1, -2]);
    const ray = { origin: vec3.sub(target, vec3.scale(direction, 5)), direction };
    expect(angularParam(center, Z, X, ray)).toBeCloseTo(Math.PI / 2, 9);
  });

  it('gives null for a ray in the plane of the circle', () => {
    expect(angularParam(ORIGIN, Z, X, { origin: [5, 5, 0], direction: [-1, 0, 0] })).toBeNull();
    expect(
      angularParam(ORIGIN, Z, X, { origin: [5, 5, 0.1], direction: [-1, 0, -0.01] }),
    ).toBeNull();
  });
});

describe('unwrapDelta', () => {
  it('unwraps a step across ±π', () => {
    expect(unwrapDelta(3, -3)).toBeCloseTo(2 * Math.PI - 6, 12);
    expect(unwrapDelta(-3, 3)).toBeCloseTo(6 - 2 * Math.PI, 12);
  });

  it('keeps a small step as it is', () => {
    expect(unwrapDelta(0.5, 0.7)).toBeCloseTo(0.2, 12);
    expect(unwrapDelta(0.7, 0.5)).toBeCloseTo(-0.2, 12);
  });

  it('maps exactly half a turn to π', () => {
    expect(unwrapDelta(0, -Math.PI)).toBeCloseTo(Math.PI, 12);
    expect(unwrapDelta(0, Math.PI)).toBeCloseTo(Math.PI, 12);
  });

  it('sums a drag of 20 steps of 20° to 400°', () => {
    const step = (20 * Math.PI) / 180;
    // The absolute angle as angularParam reports it, in (−π, π].
    const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
    let prev = wrap(0);
    let acc = 0;
    for (let i = 1; i <= 20; i++) {
      const next = wrap(i * step);
      acc += unwrapDelta(prev, next);
      prev = next;
    }
    expect((acc * 180) / Math.PI).toBeCloseTo(400, 9);
  });
});

describe('snapValue', () => {
  const length = { unit: 'length' as const };
  const angle = { unit: 'angle' as const };
  const deg = (d: number) => (d * Math.PI) / 180;

  it('snaps the absolute value to the step', () => {
    expect(snapValue(12.4, length, false)).toBe(12);
    expect(snapValue(12.6, length, false)).toBe(13);
    expect(snapValue(-12.6, length, false)).toBe(-13);
  });

  it('snaps an angle to 5°', () => {
    expect(snapValue(deg(12), angle, false)).toBeCloseTo(deg(10), 12);
    expect(snapValue(deg(13), angle, false)).toBeCloseTo(deg(15), 12);
  });

  it('leaves the value with fine', () => {
    expect(snapValue(12.4, length, true)).toBe(12.4);
  });

  it('clips to min and max after snapping', () => {
    expect(snapValue(0.4, { unit: 'length', min: 0.5 }, false)).toBe(0.5);
    expect(snapValue(-3, { unit: 'length', min: 0 }, false)).toBe(0);
    expect(snapValue(9.7, { unit: 'length', max: 9.5 }, false)).toBe(9.5);
    expect(snapValue(0.2, { unit: 'length', min: 0.5 }, true)).toBe(0.5);
    expect(snapValue(5.6, { unit: 'length', min: 0, max: 10 }, false)).toBe(6);
  });

  it('returns −0 as 0', () => {
    expect(Object.is(snapValue(-0.3, length, false), 0)).toBe(true);
    expect(Object.is(snapValue(-0, length, true), 0)).toBe(true);
    expect(Object.is(snapValue(-0.4, { unit: 'length', max: 0 }, false), 0)).toBe(true);
  });
});

describe('planarParam', () => {
  it('gives the coordinates in the XY plane seen from above', () => {
    const [a, b] = planarParam([1, 2, 0], X, Y, downAt(4, -1)) ?? [NaN, NaN];
    expect(a).toBeCloseTo(3, 12);
    expect(b).toBeCloseTo(-3, 12);
  });

  it('gives the coordinates for an oblique ray', () => {
    const target: Vec3 = [3, 5, 2];
    const direction = vec3.normalize([1, -2, -3]);
    const ray = { origin: vec3.sub(target, vec3.scale(direction, 7)), direction };
    const [a, b] = planarParam([0, 0, 2], X, Y, ray) ?? [NaN, NaN];
    expect(a).toBeCloseTo(3, 9);
    expect(b).toBeCloseTo(5, 9);
  });

  it('measures in a basis u, v rotated by 30° about Z', () => {
    const c = Math.cos(Math.PI / 6);
    const s = Math.sin(Math.PI / 6);
    const u: Vec3 = [c, s, 0];
    const v: Vec3 = [-s, c, 0];
    // The point 2·u + 3·v off the origin (1, 1, 0).
    const p = vec3.add([1, 1, 0], vec3.add(vec3.scale(u, 2), vec3.scale(v, 3)));
    const [a, b] = planarParam([1, 1, 0], u, v, downAt(p[0], p[1])) ?? [NaN, NaN];
    expect(a).toBeCloseTo(2, 12);
    expect(b).toBeCloseTo(3, 12);
  });

  it('works in a plane that is not XY (normal is u × v)', () => {
    // The YZ plane at x = 4, looked at along −X.
    const ray = { origin: [10, 2, -1] as Vec3, direction: [-1, 0, 0] as Vec3 };
    const [a, b] = planarParam([4, 0, 0], Y, Z, ray) ?? [NaN, NaN];
    expect(a).toBeCloseTo(2, 12);
    expect(b).toBeCloseTo(-1, 12);
  });

  it('gives null when the plane is seen edge-on', () => {
    expect(planarParam(ORIGIN, X, Y, { origin: [5, 5, 0], direction: [-1, 0, 0] })).toBeNull();
    expect(
      planarParam(ORIGIN, X, Y, { origin: [5, 5, 0.1], direction: [-1, 0, -0.01] }),
    ).toBeNull();
  });
});

describe('pointParam', () => {
  it('gives the point of the ray nearest to position', () => {
    const q = pointParam([1, 2, 3], downAt(4, -1));
    expect(q[0]).toBeCloseTo(4, 12);
    expect(q[1]).toBeCloseTo(-1, 12);
    expect(q[2]).toBeCloseTo(3, 12);
  });

  it('gives the nearest point for an oblique ray that is not unit', () => {
    const position: Vec3 = [2, -1, 5];
    const direction: Vec3 = [3, 1, -2];
    const ray = { origin: [-4, 0, 7] as Vec3, direction };
    const q = pointParam(position, ray);
    // q lies on the ray …
    const along = vec3.sub(q, ray.origin);
    expect(vec3.length(vec3.cross(along, direction))).toBeCloseTo(0, 9);
    // … and q − position is perpendicular to it.
    expect(vec3.dot(vec3.sub(q, position), direction)).toBeCloseTo(0, 9);
  });

  it('gives position itself when the ray passes through it', () => {
    const direction = vec3.normalize([1, 1, -1]);
    const position: Vec3 = [3, 4, 5];
    const q = pointParam(position, {
      origin: vec3.sub(position, vec3.scale(direction, 9)),
      direction,
    });
    expect(q[0]).toBeCloseTo(3, 12);
    expect(q[1]).toBeCloseTo(4, 12);
    expect(q[2]).toBeCloseTo(5, 12);
  });
});
