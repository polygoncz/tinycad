import { describe, expect, it } from 'vitest';
import { quat, vec3, type Quat, type Vec3 } from '@/core';
import type { BoundingBox } from '@/kernel';
import { orientationFor, STANDARD_VIEWS, viewBasis, type StandardView } from './camera-math';
import {
  basisOf,
  clipRange,
  ease,
  interpolate,
  levelOrientation,
  orbit,
  pan,
  turn,
  zoomAt,
  type CameraState,
} from './camera-ops';

function corners(b: BoundingBox): Vec3[] {
  const result: Vec3[] = [];
  for (const x of [b.min[0], b.max[0]])
    for (const y of [b.min[1], b.max[1]])
      for (const z of [b.min[2], b.max[2]]) result.push([x, y, z]);
  return result;
}

/**
 * Every corner lies between near and far of a camera at target + direction · distance, with at
 * least pad / 2 to spare on both sides; returns the range and the pad.
 */
function expectEnclosed(b: BoundingBox, target: Vec3, direction: Vec3) {
  const range = clipRange(b, target, direction);
  const d = vec3.normalize(direction);
  const eye = vec3.add(target, vec3.scale(d, range.distance));
  // near = pad / 2 by the contract.
  const pad = 2 * range.near;
  expect(range.near).toBeGreaterThan(0);
  for (const c of corners(b)) {
    // Depth along the view, from the eye towards the target.
    const depth = vec3.dot(vec3.sub(eye, c), d);
    expect(depth - range.near).toBeGreaterThanOrEqual(pad / 2 - 1e-9);
    expect(range.far - depth).toBeGreaterThanOrEqual(pad / 2 - 1e-9);
  }
  return { ...range, pad };
}

const box: BoundingBox = { min: [-10, -10, -10], max: [10, 10, 10] };
const front: Vec3 = [0, -1, 0];

describe('clipRange', () => {
  it('encloses bounds around the target', () => {
    expectEnclosed(box, [0, 0, 0], front);
    expectEnclosed(box, [0, 0, 0], vec3.normalize([1, -1, 1]));
  });

  it('encloses bounds in front of the target (towards the camera)', () => {
    expectEnclosed({ min: [0, -50, 0], max: [5, -40, 5] }, [0, 0, 0], front);
  });

  it('encloses bounds behind the target', () => {
    expectEnclosed({ min: [0, 40, 0], max: [5, 50, 5] }, [0, 0, 0], front);
  });

  it('encloses bounds when the target lies far outside them', () => {
    expectEnclosed(box, [1000, -2000, 500], vec3.normalize([0.3, -0.8, 0.5]));
    expectEnclosed(box, [0, 5000, 0], front);
  });

  it('places the camera at sMax + pad and far at distance − sMin + pad', () => {
    // Along front (−Y) the corners project to −10 … 10 relative to the origin.
    const range = clipRange(box, [0, 0, 0], front);
    expect(range.distance).toBeCloseTo(10 + 1);
    expect(range.near).toBeCloseTo(0.5);
    expect(range.far).toBeCloseTo(11 + 10 + 1);
  });

  it('uses pad = 1 for point bounds', () => {
    const range = expectEnclosed({ min: [1, 2, 3], max: [1, 2, 3] }, [1, 2, 3], front);
    expect(range.pad).toBeCloseTo(1);
    expect(range.distance).toBeCloseTo(1);
  });

  it('uses pad = 5 % of the depth range for huge bounds', () => {
    const huge: BoundingBox = { min: [0, 0, 0], max: [1e5, 1e5, 1e5] };
    const range = expectEnclosed(huge, [5e4, 5e4, 5e4], front);
    expect(range.pad).toBeCloseTo(0.05 * 1e5);
  });

  it('still encloses every corner after a pan and an orbit (regression)', () => {
    // Model of radius R fitted from the front, then panned 3R sideways and turned by 90°.
    const model: BoundingBox = { min: [0, 0, 0], max: [40, 20, 30] };
    const r = vec3.length(vec3.sub(model.max, model.min)) / 2;
    const centre: Vec3 = [20, 10, 15];
    const panned = vec3.add(centre, [3 * r, 0, 0]);
    expectEnclosed(model, panned, [1, 0, 0]);
    expectEnclosed(model, panned, [-1, 0, 0]);
    expectEnclosed(model, panned, front);
  });
});

const TOL = 1e-9;
const VIEWS: readonly StandardView[] = ['iso', 'top', 'bottom', 'front', 'back', 'left', 'right'];

function expectVec(actual: Vec3, expected: Vec3, tol = TOL): void {
  expect(vec3.equals(actual, expected, tol), `${String(actual)} ≈ ${String(expected)}`).toBe(true);
}

function expectSameOrientation(a: Quat, b: Quat): void {
  expect(quat.angle(a, b)).toBeCloseTo(0, 9);
}

const W = 800;
const H = 600;

/** Screen position in CSS px (y down) of a world point for the state on a W × H canvas. */
function project(s: CameraState, p: Vec3, width = W, height = H): readonly [number, number] {
  const { right, up } = basisOf(s.orientation);
  const rel = vec3.sub(p, s.target);
  const pxPerMm = height / (2 * s.halfHeight);
  return [width / 2 + vec3.dot(rel, right) * pxPerMm, height / 2 - vec3.dot(rel, up) * pxPerMm];
}

/** World point (in the plane through the target) shown at the screen position (x, y). */
function unproject(s: CameraState, x: number, y: number, width = W, height = H): Vec3 {
  const { right, up } = basisOf(s.orientation);
  const mmPerPx = (2 * s.halfHeight) / height;
  return vec3.add(
    s.target,
    vec3.add(
      vec3.scale(right, (x - width / 2) * mmPerPx),
      vec3.scale(up, (height / 2 - y) * mmPerPx),
    ),
  );
}

const isoState: CameraState = {
  target: [10, -20, 5],
  orientation: orientationFor(STANDARD_VIEWS.iso.direction),
  halfHeight: 50,
};

describe('orientationFor and basisOf', () => {
  it('give the viewBasis of every standard view, top and bottom without tilt', () => {
    for (const view of VIEWS) {
      const { direction, up } = STANDARD_VIEWS[view];
      const expected = viewBasis(direction);
      const basis = basisOf(orientationFor(direction));
      expectVec(basis.right, expected.right);
      expectVec(basis.up, expected.up);
      expectVec(basis.direction, expected.direction);
      // Standard up of the axis-aligned views exactly, iso up is +Z projected.
      if (view !== 'iso') expectVec(basis.up, up);
    }
  });

  it('basisOf of the identity is the world axes', () => {
    const basis = basisOf(quat.identity());
    expect(basis).toEqual({ right: [1, 0, 0], up: [0, 1, 0], direction: [0, 0, 1] });
  });
});

describe("orbit, 'free'", () => {
  it('a drag to the right moves the front point of the model to the right', () => {
    const front = vec3.add(isoState.target, basisOf(isoState.orientation).direction);
    const after = orbit(isoState, 40, 0, H, 'free');
    const rel = vec3.sub(front, after.target);
    expect(vec3.dot(rel, basisOf(after.orientation).right)).toBeGreaterThan(0);
    expect(project(after, front)[0]).toBeGreaterThan(W / 2);
  });

  it('a drag down moves the front point of the model down', () => {
    const front = vec3.add(isoState.target, basisOf(isoState.orientation).direction);
    const after = orbit(isoState, 0, 40, H, 'free');
    expect(vec3.dot(vec3.sub(front, after.target), basisOf(after.orientation).up)).toBeLessThan(0);
    expect(project(after, front)[1]).toBeGreaterThan(H / 2);
  });

  it('a drag over the full height turns by 180°', () => {
    expect(
      quat.angle(isoState.orientation, orbit(isoState, 0, H, H, 'free').orientation),
    ).toBeCloseTo(Math.PI, 9);
    const diagonal = orbit(isoState, H * 0.6, H * 0.8, H, 'free');
    expect(quat.angle(isoState.orientation, diagonal.orientation)).toBeCloseTo(Math.PI, 9);
    expect(
      quat.angle(isoState.orientation, orbit(isoState, H / 2, 0, H, 'free').orientation),
    ).toBeCloseTo(Math.PI / 2, 9);
  });

  it('keeps the target and halfHeight', () => {
    const after = orbit(isoState, 13, -7, H, 'free');
    expect(after.target).toEqual(isoState.target);
    expect(after.halfHeight).toBe(isoState.halfHeight);
  });

  it('turns freely over the pole (upside down)', () => {
    const top: CameraState = { ...isoState, orientation: orientationFor([0, 0, 1]) };
    const after = orbit(top, 0, H / 2, H, 'free');
    expect(Number.isFinite(after.orientation[3])).toBe(true);
    expect(quat.angle(top.orientation, after.orientation)).toBeCloseTo(Math.PI / 2, 9);
  });

  it('a zero drag and a zero height leave the state unchanged', () => {
    expect(orbit(isoState, 0, 0, H, 'free')).toBe(isoState);
    expect(orbit(isoState, 10, 10, 0, 'free')).toBe(isoState);
  });
});

describe('pan', () => {
  it('moves the point under the cursor with the cursor', () => {
    const grabbed = unproject(isoState, 300, 200);
    const after = pan(isoState, 25, -40, H);
    const [x, y] = project(after, grabbed);
    expect(x).toBeCloseTo(325, 9);
    expect(y).toBeCloseTo(160, 9);
    expect(after.orientation).toEqual(isoState.orientation);
    expect(after.halfHeight).toBe(isoState.halfHeight);
  });

  it('a zero height leaves the state unchanged', () => {
    expect(pan(isoState, 10, 10, 0)).toBe(isoState);
  });
});

describe('zoomAt', () => {
  it('rejects a factor that is not a finite positive number', () => {
    for (const factor of [0, -2, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => zoomAt(isoState, 10, 10, factor, W, H)).toThrow();
    }
  });

  it('keeps the point under the cursor at the same pixels', () => {
    const cursor = [620, 130] as const;
    const point = unproject(isoState, ...cursor);
    for (const factor of [1.5, 0.5]) {
      const after = zoomAt(isoState, ...cursor, factor, W, H);
      const [x, y] = project(after, point);
      expect(x).toBeCloseTo(cursor[0], 9);
      expect(y).toBeCloseTo(cursor[1], 9);
    }
  });

  it('factor > 1 zooms in (smaller halfHeight)', () => {
    expect(zoomAt(isoState, 400, 300, 2, W, H).halfHeight).toBeCloseTo(25);
    expect(zoomAt(isoState, 400, 300, 0.5, W, H).halfHeight).toBeCloseTo(100);
  });

  it('a cursor in the centre keeps the target', () => {
    expectVec(zoomAt(isoState, W / 2, H / 2, 3, W, H).target, isoState.target);
  });

  it('clamps halfHeight to 0.01 … 1e6 and keeps the point under the cursor with the real ratio', () => {
    const cursor = [100, 500] as const;
    const point = unproject(isoState, ...cursor);
    for (const [factor, expected] of [
      [1e9, 0.01],
      [1e-9, 1e6],
    ] as const) {
      const after = zoomAt(isoState, ...cursor, factor, W, H);
      expect(after.halfHeight).toBe(expected);
      const [x, y] = project(after, point);
      expect(x).toBeCloseTo(cursor[0], 6);
      expect(y).toBeCloseTo(cursor[1], 6);
    }
  });

  it('a zero width or height leaves the state unchanged', () => {
    expect(zoomAt(isoState, 1, 1, 2, 0, H)).toBe(isoState);
    expect(zoomAt(isoState, 1, 1, 2, W, 0)).toBe(isoState);
  });
});

describe("turn, 'free'", () => {
  const front = orientationFor(STANDARD_VIEWS.front.direction);

  it('four quarter turns about the same axis give the start again', () => {
    for (const axis of ['up', 'right', 'view'] as const)
      for (const q of [1, -1] as const) {
        let o = isoState.orientation;
        for (let i = 0; i < 4; i++) o = turn(o, axis, q, 'free');
        expectSameOrientation(o, isoState.orientation);
      }
  });

  it('one quarter turn is 90°', () => {
    expect(quat.angle(front, turn(front, 'up', 1, 'free'))).toBeCloseTo(Math.PI / 2, 9);
  });

  it("'up' +1 turns the front of the model to the right: the camera looks from −X (left)", () => {
    const basis = basisOf(turn(front, 'up', 1, 'free'));
    expectVec(basis.direction, STANDARD_VIEWS.left.direction);
    expectVec(basis.up, [0, 0, 1]);
    // The front face of the model (normal −Y) points right on the screen.
    expectVec(basis.right, [0, -1, 0]);
  });

  it("'right' +1 (arrow down) gives the top view with +Y up", () => {
    const basis = basisOf(turn(front, 'right', 1, 'free'));
    expectVec(basis.direction, [0, 0, 1]);
    expectVec(basis.up, [0, 1, 0]);
  });

  it("'view' −1 (clockwise roll) keeps the direction and puts −X (what was left) on top", () => {
    const basis = basisOf(turn(front, 'view', -1, 'free'));
    expectVec(basis.direction, [0, -1, 0]);
    expectVec(basis.up, [-1, 0, 0]);
  });

  it('turns about the axes of the current orientation, not the world', () => {
    const top = orientationFor([0, 0, 1]);
    // From the top view, 'up' is +Y: the camera swings from +Z towards −X (model turns right).
    expectVec(basisOf(turn(top, 'up', 1, 'free')).direction, [-1, 0, 0]);
  });
});

const Z: Vec3 = [0, 0, 1];

/** Deterministic pseudo-random numbers in ⟨0, 1) (mulberry32), so a failure can be replayed. */
function random(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Elevation of the camera above the XY plane in radians. */
function elevation(o: Quat): number {
  return Math.asin(Math.min(Math.max(vec3.dot(basisOf(o).direction, Z), -1), 1));
}

/** The model turned by `angle` about the world axis, the camera the opposite way. */
function modelTurned(o: Quat, axis: Vec3, angle: number): Quat {
  return quat.multiply(quat.fromAxisAngle(axis, -angle), o);
}

describe("orbit, 'turntable'", () => {
  const frontState: CameraState = {
    ...isoState,
    orientation: orientationFor(STANDARD_VIEWS.front.direction),
  };

  it('keeps right horizontal (zero roll) after 50 random drags', () => {
    const next = random(17);
    let s = isoState;
    for (let i = 0; i < 50; i++) {
      s = orbit(s, (next() - 0.5) * H, (next() - 0.5) * H, H, 'turntable');
      expect(Math.abs(vec3.dot(basisOf(s.orientation).right, Z))).toBeLessThan(1e-9);
    }
  });

  it('a drag down by height / 2 from the front gives the top view (elevation π/2)', () => {
    const after = orbit(frontState, 0, H / 2, H, 'turntable');
    expect(elevation(after.orientation)).toBeCloseTo(Math.PI / 2, 9);
    expectSameOrientation(after.orientation, orientationFor(STANDARD_VIEWS.top.direction));
  });

  it('cannot go over the pole: a further drag down keeps the elevation', () => {
    const top = orbit(frontState, 0, H / 2, H, 'turntable');
    const further = orbit(top, 0, H / 4, H, 'turntable');
    expect(elevation(further.orientation)).toBeCloseTo(Math.PI / 2, 9);
    expectSameOrientation(further.orientation, top.orientation);
    // Clamped from below too.
    const bottom = orbit(frontState, 0, -H, H, 'turntable');
    expect(elevation(bottom.orientation)).toBeCloseTo(-Math.PI / 2, 9);
  });

  it('a horizontal drag at the pole turns about Z: the direction stays, right turns', () => {
    const top: CameraState = { ...isoState, orientation: orientationFor([0, 0, 1]) };
    const after = orbit(top, H / 4, 0, H, 'turntable');
    const before = basisOf(top.orientation);
    const basis = basisOf(after.orientation);
    expectVec(basis.direction, [0, 0, 1]);
    expect(vec3.dot(basis.right, before.right)).toBeCloseTo(Math.cos(Math.PI / 4), 9);
    expect(Math.abs(vec3.dot(basis.right, Z))).toBeLessThan(1e-9);
  });

  it('a drag to the right from the front moves the front point of the model to the right', () => {
    const front = vec3.add(frontState.target, basisOf(frontState.orientation).direction);
    const after = orbit(frontState, 40, 0, H, 'turntable');
    expect(project(after, front)[0]).toBeGreaterThan(W / 2);
  });

  it('a horizontal drag turns about the world Z, not about the camera up', () => {
    const after = orbit(isoState, H / 2, 0, H, 'turntable');
    expectSameOrientation(after.orientation, modelTurned(isoState.orientation, Z, Math.PI / 2));
    expect(elevation(after.orientation)).toBeCloseTo(elevation(isoState.orientation), 9);
  });

  it('keeps the target and halfHeight', () => {
    const after = orbit(isoState, 13, -7, H, 'turntable');
    expect(after.target).toEqual(isoState.target);
    expect(after.halfHeight).toBe(isoState.halfHeight);
  });

  it('a zero drag and a zero height leave the state unchanged', () => {
    expect(orbit(isoState, 0, 0, H, 'turntable')).toBe(isoState);
    expect(orbit(isoState, 10, 10, 0, 'turntable')).toBe(isoState);
  });
});

describe("turn, 'turntable'", () => {
  const front = orientationFor(STANDARD_VIEWS.front.direction);
  const top = orientationFor(STANDARD_VIEWS.top.direction);

  it("'up' +1 from the front gives the left view, like 'free'", () => {
    expectSameOrientation(turn(front, 'up', 1, 'turntable'), turn(front, 'up', 1, 'free'));
    expectSameOrientation(
      turn(front, 'up', 1, 'turntable'),
      orientationFor(STANDARD_VIEWS.left.direction),
    );
  });

  it("'right' +1 from the front gives the top view, like 'free'", () => {
    expectSameOrientation(turn(front, 'right', 1, 'turntable'), turn(front, 'right', 1, 'free'));
    expectSameOrientation(turn(front, 'right', 1, 'turntable'), top);
  });

  it("'right' +1 from the top view changes nothing (elevation clamped)", () => {
    expect(quat.angle(turn(top, 'right', 1, 'turntable'), top)).toBeLessThan(1e-9);
  });

  it("'up' turns about the world Z also from the top view", () => {
    const after = turn(top, 'up', 1, 'turntable');
    expectSameOrientation(after, modelTurned(top, Z, Math.PI / 2));
    expectVec(basisOf(after).direction, [0, 0, 1]);
  });

  it("'right' from iso stops at the pole", () => {
    expect(elevation(turn(isoState.orientation, 'right', 1, 'turntable'))).toBeCloseTo(
      Math.PI / 2,
      9,
    );
  });

  it("'view' is a programmer error", () => {
    expect(() => turn(front, 'view', 1, 'turntable')).toThrow();
    expect(() => turn(front, 'view', -1, 'turntable')).toThrow();
  });
});

describe('levelOrientation', () => {
  const iso = orientationFor(STANDARD_VIEWS.iso.direction);

  it('removes a 30° roll from iso', () => {
    const rolled = modelTurned(iso, basisOf(iso).direction, Math.PI / 6);
    expect(Math.abs(vec3.dot(basisOf(rolled).right, Z))).toBeGreaterThan(0.1);
    expectSameOrientation(levelOrientation(rolled), iso);
  });

  it('keeps the view direction off the pole and puts Z up', () => {
    const tilted = modelTurned(orbit(isoState, 70, 30, H, 'free').orientation, [1, 2, 3], 0.4);
    const level = basisOf(levelOrientation(tilted));
    expectVec(level.direction, basisOf(tilted).direction);
    expect(Math.abs(vec3.dot(level.right, Z))).toBeLessThan(1e-9);
    expect(vec3.dot(level.up, Z)).toBeGreaterThan(0);
  });

  it('keeps the horizontal right at the poles', () => {
    for (const direction of [STANDARD_VIEWS.top.direction, STANDARD_VIEWS.bottom.direction]) {
      const turned = modelTurned(orientationFor(direction), Z, 0.7);
      const level = basisOf(levelOrientation(turned));
      expectVec(level.right, basisOf(turned).right);
      expectVec(level.direction, direction);
      expectSameOrientation(levelOrientation(turned), turned);
    }
  });

  it('levels right at the pole when it is tilted out of the XY plane', () => {
    // Looking along Z, but rounded: right a little out of the plane.
    const o = modelTurned(orientationFor([0, 0, 1]), [0, 1, 0], 1e-11);
    const level = basisOf(levelOrientation(o));
    expectVec(level.direction, [0, 0, 1]);
    expect(Math.abs(vec3.dot(level.right, Z))).toBeLessThan(1e-12);
    expect(vec3.dot(level.right, basisOf(o).right)).toBeCloseTo(1, 9);
  });

  it('leaves an orientation with zero roll unchanged', () => {
    for (const view of VIEWS) {
      const o = orientationFor(STANDARD_VIEWS[view].direction);
      expect(quat.angle(levelOrientation(o), o)).toBeLessThan(1e-9);
    }
    const turntable = orbit(isoState, 123, -45, H, 'turntable').orientation;
    expect(quat.angle(levelOrientation(turntable), turntable)).toBeLessThan(1e-9);
  });
});

describe('ease', () => {
  it('is 0, 0.5 and 1 at the ends and in the middle', () => {
    expect(ease(0)).toBe(0);
    expect(ease(0.5)).toBe(0.5);
    expect(ease(1)).toBe(1);
  });

  it('clamps t outside 0 … 1', () => {
    expect(ease(-2)).toBe(0);
    expect(ease(3)).toBe(1);
  });

  it('is monotonic and eases in and out', () => {
    let previous = ease(0);
    for (let i = 1; i <= 100; i++) {
      const value = ease(i / 100);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
    expect(ease(0.1)).toBeLessThan(0.1);
    expect(ease(0.9)).toBeGreaterThan(0.9);
  });
});

describe('interpolate', () => {
  const from = orientationFor(STANDARD_VIEWS.front.direction);
  const to = orientationFor(STANDARD_VIEWS.iso.direction);

  it('returns the end orientations at t = 0 and t = 1', () => {
    expectSameOrientation(interpolate(from, to, 0), from);
    expectSameOrientation(interpolate(from, to, 1), to);
  });

  it('is slerp of the eased t', () => {
    expectSameOrientation(interpolate(from, to, 0.3), quat.slerp(from, to, ease(0.3)));
    const total = quat.angle(from, to);
    expect(quat.angle(from, interpolate(from, to, 0.5))).toBeCloseTo(total / 2, 9);
  });
});
