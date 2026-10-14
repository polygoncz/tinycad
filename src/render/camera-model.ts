// The camera model (spec 09, "Kamera" → "Animace"): the single source of truth about the camera.
// Pure, no three import; time comes in as `now`, so animations are tested in Node.

import { quat, type Quat } from '@/core';
import { interpolate, type CameraState } from './camera-ops';

export interface CameraModel {
  readonly state: CameraState;
  /** Goal orientation of the running animation, otherwise the current one. */
  readonly goal: Quat;
  readonly animating: boolean;
  /** Takes the new state and cancels the animation (orbit, pan, zoom, fit from the rig). */
  set(state: CameraState): void;
  /**
   * Animates from the current orientation to `orientation` in 300 ms. An angle below 1e-6 rad
   * starts nothing and stops a running animation. Target and halfHeight stay.
   */
  animateTo(orientation: Quat, now: number): void;
  /** Advances the animation to `now`; true = it keeps running. */
  tick(now: number): boolean;
  /** Stops the animation at the intermediate orientation. */
  cancelAnimation(): void;
}

/** Duration of an animated turn in ms (spec 09, "Animace"). */
const DURATION = 300;
/** Below this angle in radians an animation is not worth starting. */
const MIN_ANGLE = 1e-6;

interface Animation {
  readonly from: Quat;
  readonly to: Quat;
  readonly start: number;
}

export function createCameraModel(initial: CameraState): CameraModel {
  let state = initial;
  let animation: Animation | null = null;

  return {
    get state(): CameraState {
      return state;
    },
    get goal(): Quat {
      return animation?.to ?? state.orientation;
    },
    get animating(): boolean {
      return animation !== null;
    },
    set(next: CameraState): void {
      animation = null;
      state = next;
    },
    animateTo(orientation: Quat, now: number): void {
      // Already there: a running animation stops here instead of going on to its old goal.
      if (quat.angle(state.orientation, orientation) < MIN_ANGLE) {
        animation = null;
        return;
      }
      animation = { from: state.orientation, to: orientation, start: now };
    },
    tick(now: number): boolean {
      if (animation === null) return false;
      const t = (now - animation.start) / DURATION;
      if (t >= 1) {
        state = { ...state, orientation: animation.to };
        animation = null;
        return false;
      }
      state = { ...state, orientation: interpolate(animation.from, animation.to, t) };
      return true;
    },
    cancelAnimation(): void {
      animation = null;
    },
  };
}
