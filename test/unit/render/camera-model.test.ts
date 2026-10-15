import { describe, expect, it } from 'vitest';
import { quat, type Quat } from '@/core';
import { orientationFor, STANDARD_VIEWS } from '@/render/camera-math';
import { createCameraModel } from '@/render/camera-model';
import { interpolate, turn, type CameraState } from '@/render/camera-ops';

const FRONT = orientationFor(STANDARD_VIEWS.front.direction);
const TOP = orientationFor(STANDARD_VIEWS.top.direction);

const initial: CameraState = { target: [1, 2, 3], orientation: FRONT, halfHeight: 50 };

function expectSameRotation(a: Quat, b: Quat): void {
  expect(quat.angle(a, b)).toBeLessThan(1e-9);
}

describe('createCameraModel', () => {
  it('starts with the initial state, not animating, the goal is the orientation', () => {
    const model = createCameraModel(initial);
    expect(model.state).toBe(initial);
    expect(model.animating).toBe(false);
    expect(model.goal).toBe(FRONT);
    expect(model.tick(0)).toBe(false);
  });

  it('animateTo runs 300 ms: half way it interpolates, at the end it is exactly the goal', () => {
    const model = createCameraModel(initial);
    model.animateTo(TOP, 1000);
    expect(model.animating).toBe(true);
    expect(model.goal).toBe(TOP);

    expect(model.tick(1000)).toBe(true);
    expectSameRotation(model.state.orientation, FRONT);

    expect(model.tick(1150)).toBe(true);
    expectSameRotation(model.state.orientation, interpolate(FRONT, TOP, 0.5));

    expect(model.tick(1300)).toBe(false);
    expect(model.state.orientation).toEqual(TOP);
    expect(model.animating).toBe(false);
    expect(model.tick(1400)).toBe(false);
    expect(model.state.orientation).toEqual(TOP);
  });

  it('keeps the target and halfHeight during an animation', () => {
    const model = createCameraModel(initial);
    model.animateTo(TOP, 0);
    model.tick(100);
    expect(model.state.target).toEqual(initial.target);
    expect(model.state.halfHeight).toBe(initial.halfHeight);
  });

  it('two quick turns from the goal end 180° from the start', () => {
    const model = createCameraModel(initial);
    model.animateTo(turn(model.goal, 'up', 1, 'free'), 0);
    model.tick(50);
    model.animateTo(turn(model.goal, 'up', 1, 'free'), 50);
    model.tick(100);
    expect(model.tick(350)).toBe(false);
    expect(quat.angle(model.state.orientation, FRONT)).toBeCloseTo(Math.PI, 9);
  });

  it('a second animateTo starts from the current, intermediate orientation', () => {
    const model = createCameraModel(initial);
    model.animateTo(TOP, 0);
    model.tick(150);
    const midway = model.state.orientation;
    const back = orientationFor(STANDARD_VIEWS.back.direction);
    model.animateTo(back, 150);
    model.tick(300);
    expectSameRotation(model.state.orientation, interpolate(midway, back, 0.5));
  });

  it('set cancels the animation and takes the new state', () => {
    const model = createCameraModel(initial);
    model.animateTo(TOP, 0);
    model.tick(100);
    const next: CameraState = { target: [0, 0, 0], orientation: FRONT, halfHeight: 10 };
    model.set(next);
    expect(model.animating).toBe(false);
    expect(model.state).toBe(next);
    expect(model.goal).toBe(FRONT);
    expect(model.tick(1000)).toBe(false);
    expect(model.state).toBe(next);
  });

  it('cancelAnimation keeps the intermediate orientation', () => {
    const model = createCameraModel(initial);
    model.animateTo(TOP, 0);
    model.tick(150);
    const midway = model.state.orientation;
    model.cancelAnimation();
    expect(model.animating).toBe(false);
    expect(model.goal).toBe(midway);
    expect(model.tick(1000)).toBe(false);
    expect(model.state.orientation).toBe(midway);
  });

  it('cancelAnimation without an animation does nothing', () => {
    const model = createCameraModel(initial);
    model.cancelAnimation();
    expect(model.state).toBe(initial);
  });

  it('an angle below 1e-6 starts no animation', () => {
    const model = createCameraModel(initial);
    model.animateTo(quat.multiply(quat.fromAxisAngle([0, 0, 1], 1e-7), FRONT), 0);
    expect(model.animating).toBe(false);
    expect(model.state).toBe(initial);
    model.animateTo([-FRONT[0], -FRONT[1], -FRONT[2], -FRONT[3]], 0);
    expect(model.animating).toBe(false);
  });

  it('animateTo the current orientation during an animation stops it there', () => {
    const model = createCameraModel(initial);
    model.animateTo(TOP, 0);
    model.tick(150);
    const midway = model.state.orientation;
    model.animateTo(midway, 150);
    expect(model.animating).toBe(false);
    expect(model.tick(300)).toBe(false);
    expect(model.state.orientation).toBe(midway);
  });
});
