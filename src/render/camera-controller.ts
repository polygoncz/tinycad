// Orthographic camera with Onshape-like controls (spec 09, "Kamera", ADR 0019). The camera model
// (target, orientation, halfHeight) is the single source of truth; the THREE camera is only
// derived from it. The camera lives for the whole viewport, the input only while mounted.

import * as THREE from 'three';
import { assert, type Disposable, type Quat, type Vec3 } from '@/core';
import type { BoundingBox } from '@/kernel';
import { fitOrtho, orientationFor, STANDARD_VIEWS, type StandardView } from './camera-math';
import { createCameraModel } from './camera-model';
import {
  basisOf,
  clipRange,
  levelOrientation,
  orbit,
  pan,
  turn,
  zoomAt,
  type CameraState,
  type OrbitMode,
  type TurnAxis,
} from './camera-ops';
import { attachCameraInput } from './camera-rig-input';

export interface CameraController {
  /** Bounds of all bodies in the current orientation (roll included); an empty scene → the
   *  default 200 × 200 mm frame around the origin. */
  fitAll(): void;
  /** Orientation of the standard view (immediately), then fitAll(). */
  setView(view: StandardView): void;
  /**
   * M12: orientationFor(direction) (immediately), then fitAll(); normal to a sketch plane =
   * setViewDirection(plane.normal). Zero direction = error.
   */
  setViewDirection(direction: Vec3): void;
}

/** What the viewport and the view cube need on top of CameraController; internal to render. */
export interface CameraRig extends CameraController, Disposable {
  readonly camera: THREE.OrthographicCamera;
  /** Current orientation (for the view cube). */
  readonly orientation: Quat;
  /** Point the camera orbits around; part of the clip bounds (spec 09, "Near a far"). */
  readonly target: Vec3;
  /** Pointer and wheel listeners (CameraInput) on the element. Only one at a time. */
  attach(element: HTMLElement): void;
  /** Removes the listeners; the camera keeps its view. Idempotent. */
  detach(): void;
  /** New canvas size in CSS px: recomputes the frustum, keeping the visible height. */
  resize(width: number, height: number): void;
  /**
   * Moves the camera along its view direction to clipRange(bounds) and sets near/far, so the
   * bounds of everything visible are never clipped (spec 09, "Near a far"). Keeps the
   * orientation and the target; requests no render (called from draw and before picking).
   */
  updateClip(bounds: BoundingBox): void;
  /** M17.1: rotation mode of orbit and turn; 'turntable' until setOrbitMode. */
  readonly orbitMode: OrbitMode;
  /**
   * M17.1: the same mode = nothing. Switching to 'turntable' levels the camera animated
   * (levelOrientation of the goal), switching to 'free' keeps the orientation.
   */
  setOrbitMode(mode: OrbitMode): void;
  /** Rotation by a drag in CSS px in orbitMode, height from the last resize; cancels the animation. */
  orbit(dx: number, dy: number): void;
  /** Animated turn to the orientation (300 ms), time from options.now. */
  animateTo(orientation: Quat): void;
  /**
   * Quarter turn about a screen axis in orbitMode, from the goal of a running animation; 'view'
   * in 'turntable' = programmer error.
   */
  turn(axis: TurnAxis, quarterTurns: 1 | -1): void;
  /** Advances the animation and derives the THREE camera; true = it keeps running. */
  tick(now: number): boolean;
}

export interface CameraRigOptions {
  /** Bounds of the shown bodies, null when there are none. */
  readonly getBounds: () => BoundingBox | null;
  readonly requestRender: () => void;
  /** Clock of the animations in ms (performance.now in the browser). */
  readonly now: () => number;
  /** mod = Cmd on a Mac, else Ctrl (spec 09, "Události"); decided once by the viewport. */
  readonly isMac: boolean;
}

const Z_UP = new THREE.Vector3(0, 0, 1);

/** Before the first fit (the viewport sets the iso view on its first mount). */
const INITIAL_STATE: CameraState = {
  target: [0, 0, 0],
  orientation: orientationFor(STANDARD_VIEWS.iso.direction),
  halfHeight: 1,
};

export function createCameraRig(options: CameraRigOptions): CameraRig {
  const { getBounds, requestRender, now, isMac } = options;
  const camera = new THREE.OrthographicCamera();
  // Only for consistency: nothing depends on camera.up any more (ADR 0019).
  camera.up.copy(Z_UP);
  camera.zoom = 1;

  const model = createCameraModel(INITIAL_STATE);
  /** Canvas size in CSS px from the last resize; 0 before it (camera operations do nothing). */
  let width = 0;
  let height = 0;
  let aspect = 1;
  let input: Disposable | null = null;
  let disposed = false;
  let orbitMode: OrbitMode = 'turntable';

  /** Derives the orientation and the frustum of the THREE camera; position comes in updateClip. */
  function project(): void {
    const { orientation, halfHeight } = model.state;
    camera.quaternion.set(...orientation);
    camera.left = -halfHeight * aspect;
    camera.right = halfHeight * aspect;
    camera.top = halfHeight;
    camera.bottom = -halfHeight;
    camera.updateProjectionMatrix();
  }

  /**
   * Takes a new state and cancels the animation (also when the operation changed nothing, e.g.
   * a zero canvas); derives the camera and asks for a frame only on a change.
   */
  function apply(state: CameraState): void {
    const changed = state !== model.state;
    model.set(state);
    if (!changed) return;
    project();
    requestRender();
  }

  /** Fits the shown bodies in the given orientation. */
  function fit(orientation: Quat): void {
    const f = fitOrtho(getBounds(), basisOf(orientation), aspect);
    apply({ target: f.target, orientation, halfHeight: f.halfHeight });
  }

  function assertAlive(): void {
    assert(!disposed, 'Camera used after dispose');
  }

  function detach(): void {
    input?.dispose();
    input = null;
  }

  function animateTo(orientation: Quat): void {
    assertAlive();
    model.animateTo(orientation, now());
    if (model.animating) requestRender();
  }

  project();

  return {
    camera,
    get orientation(): Quat {
      return model.state.orientation;
    },
    get target(): Vec3 {
      return model.state.target;
    },
    fitAll(): void {
      assertAlive();
      fit(model.state.orientation);
    },
    setView(view: StandardView): void {
      assertAlive();
      fit(orientationFor(STANDARD_VIEWS[view].direction));
    },
    setViewDirection(direction: Vec3): void {
      assertAlive();
      // orientationFor normalizes, so a zero direction throws before anything changes.
      fit(orientationFor(direction));
    },
    attach(element: HTMLElement): void {
      assertAlive();
      assert(input === null, 'Camera input is already attached');
      input = attachCameraInput(
        element,
        {
          orbit: (dx, dy) => {
            apply(orbit(model.state, dx, dy, height, orbitMode));
          },
          pan: (dx, dy) => {
            apply(pan(model.state, dx, dy, height));
          },
          zoomAt: (x, y, factor) => {
            apply(zoomAt(model.state, x, y, factor, width, height));
          },
          cancelAnimation: () => {
            model.cancelAnimation();
          },
          get height() {
            return height;
          },
        },
        isMac,
      );
    },
    detach,
    resize(w: number, h: number): void {
      assertAlive();
      assert(w > 0 && h > 0, 'Canvas size must be positive');
      width = w;
      height = h;
      aspect = w / h;
      project();
    },
    updateClip(bounds: BoundingBox): void {
      assertAlive();
      const { target, orientation } = model.state;
      const { direction } = basisOf(orientation);
      const range = clipRange(bounds, target, direction);
      camera.position.set(
        target[0] + direction[0] * range.distance,
        target[1] + direction[1] * range.distance,
        target[2] + direction[2] * range.distance,
      );
      camera.near = range.near;
      camera.far = range.far;
      camera.updateProjectionMatrix();
    },
    get orbitMode(): OrbitMode {
      return orbitMode;
    },
    setOrbitMode(mode: OrbitMode): void {
      assertAlive();
      if (mode === orbitMode) return;
      orbitMode = mode;
      // From the goal, so a running turn ends level instead of being cut short.
      if (mode === 'turntable') animateTo(levelOrientation(model.goal));
    },
    orbit(dx: number, dy: number): void {
      assertAlive();
      apply(orbit(model.state, dx, dy, height, orbitMode));
    },
    animateTo,
    turn(axis: TurnAxis, quarterTurns: 1 | -1): void {
      animateTo(turn(model.goal, axis, quarterTurns, orbitMode));
    },
    tick(time: number): boolean {
      assertAlive();
      const running = model.tick(time);
      project();
      return running;
    },
    dispose(): void {
      if (disposed) return;
      detach();
      disposed = true;
    },
  };
}
