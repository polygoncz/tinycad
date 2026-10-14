// Pure camera operations (spec 09, "Kamera" → "Operace"): no three import, vectors via the vec3
// facade (ADR 0012), tested in Node.

import { assert, quat, vec3, type Quat, type Vec3 } from '@/core';
import type { BoundingBox } from '@/kernel';
import { boxCorners, orientationFor, type ViewBasis } from './camera-math';

/** State of the camera rig (spec 09, "Kamera"); the THREE camera is derived from it. */
export interface CameraState {
  /** Point the camera looks at and orbits around. */
  readonly target: Vec3;
  /** Turns the camera axes x, y, z into right, up, direction (towards the camera). */
  readonly orientation: Quat;
  /** Half of the visible height in mm; the visible width is 2 · halfHeight · aspect. */
  readonly halfHeight: number;
}

/** Screen axis of a quarter turn: 'up' (arrows left/right), 'right' (up/down), 'view' (roll). */
export type TurnAxis = 'up' | 'right' | 'view';

/**
 * Rotation mode (spec 09, "Režim otáčení", ADR 0020): 'turntable' keeps the world Z up (zero
 * roll, elevation within ⟨−90°, 90°⟩), 'free' is the trackball of ADR 0019.
 */
export type OrbitMode = 'turntable' | 'free';

const Z: Vec3 = [0, 0, 1];

/** Camera axes in the world for an orientation. */
export function basisOf(orientation: Quat): ViewBasis {
  return {
    right: quat.rotate(orientation, [1, 0, 0]),
    up: quat.rotate(orientation, [0, 1, 0]),
    direction: quat.rotate(orientation, [0, 0, 1]),
  };
}

/**
 * Turns the camera so that the model turns by `angle` about the world `axis`: the camera turns
 * the opposite way (spec 09, orbit and turn).
 */
function turnModel(orientation: Quat, axis: Vec3, angle: number): Quat {
  return quat.multiply(quat.fromAxisAngle(axis, -angle), orientation);
}

/** Elevation of the view direction above the XY plane in radians, in ⟨−π/2, π/2⟩. */
function elevationOf(direction: Vec3): number {
  // Rounding may push the dot product of unit vectors slightly past ±1.
  return Math.asin(Math.min(Math.max(vec3.dot(direction, Z), -1), 1));
}

/**
 * Turntable step: the model turns by `azimuth` about the world Z, then by `tilt` about the
 * camera right after that turn, with the elevation clamped to ⟨−π/2, π/2⟩ (a positive tilt
 * raises the camera). Right stays horizontal. Returns the same orientation when both actual
 * angles are zero.
 */
function turntableTurn(orientation: Quat, azimuth: number, tilt: number): Quat {
  const turned = azimuth === 0 ? orientation : turnModel(orientation, Z, azimuth);
  const { right, direction } = basisOf(turned);
  const e = elevationOf(direction);
  const actual = Math.min(Math.max(e + tilt, -Math.PI / 2), Math.PI / 2) - e;
  return actual === 0 ? turned : turnModel(turned, right, actual);
}

/**
 * Rotation about the target, the model follows the cursor: a drag over the full canvas height
 * turns by 180°. Drag in CSS px, screen y down. 'free' turns about the screen axis of the drag,
 * 'turntable' about the world Z and the camera right (spec 09, "Operace", orbit).
 */
export function orbit(
  s: CameraState,
  dx: number,
  dy: number,
  height: number,
  mode: OrbitMode,
): CameraState {
  const length = Math.hypot(dx, dy);
  if (height <= 0 || length === 0) return s;
  if (mode === 'turntable') {
    const orientation = turntableTurn(
      s.orientation,
      (Math.PI * dx) / height,
      (Math.PI * dy) / height,
    );
    return orientation === s.orientation ? s : { ...s, orientation };
  }
  const { right, up } = basisOf(s.orientation);
  const axis = vec3.add(vec3.scale(up, dx), vec3.scale(right, dy));
  return { ...s, orientation: turnModel(s.orientation, axis, (Math.PI * length) / height) };
}

/** Moves the target so that the point under the cursor goes with the cursor. */
export function pan(s: CameraState, dx: number, dy: number, height: number): CameraState {
  if (height <= 0) return s;
  const { right, up } = basisOf(s.orientation);
  const shift = vec3.sub(vec3.scale(right, dx), vec3.scale(up, dy));
  return { ...s, target: vec3.sub(s.target, vec3.scale(shift, (2 * s.halfHeight) / height)) };
}

const MIN_HALF_HEIGHT = 0.01;
const MAX_HALF_HEIGHT = 1e6;

/**
 * Zooms by `factor` (> 1 zooms in) towards the cursor at (x, y) in CSS px: the point under the
 * cursor stays at the same pixels, also when halfHeight hits the clamp.
 */
export function zoomAt(
  s: CameraState,
  x: number,
  y: number,
  factor: number,
  width: number,
  height: number,
): CameraState {
  assert(Number.isFinite(factor) && factor > 0, 'Zoom factor must be finite and positive');
  if (width <= 0 || height <= 0) return s;
  const halfHeight = Math.min(Math.max(s.halfHeight / factor, MIN_HALF_HEIGHT), MAX_HALF_HEIGHT);
  const { right, up } = basisOf(s.orientation);
  const cursor = vec3.sub(vec3.scale(right, x - width / 2), vec3.scale(up, y - height / 2));
  const offset = vec3.scale(cursor, (2 * s.halfHeight) / height);
  return {
    ...s,
    target: vec3.add(s.target, vec3.scale(offset, 1 - halfHeight / s.halfHeight)),
    halfHeight,
  };
}

/**
 * Goal orientation of a view cube arrow: the model turns by quarterTurns · 90° about the screen
 * axis, in the direction of the arrow (same convention as orbit). Arrow right = 'up' +1,
 * arrow down = 'right' +1, counter-clockwise roll = 'view' +1. In 'turntable' 'up' is the world
 * Z, 'right' stops at the poles and 'view' is a programmer error.
 */
export function turn(
  orientation: Quat,
  axis: TurnAxis,
  quarterTurns: 1 | -1,
  mode: OrbitMode,
): Quat {
  const angle = (quarterTurns * Math.PI) / 2;
  if (mode === 'turntable') {
    assert(axis !== 'view', 'A roll is not allowed in turntable mode');
    return axis === 'up'
      ? turntableTurn(orientation, angle, 0)
      : turntableTurn(orientation, 0, angle);
  }
  const basis = basisOf(orientation);
  const worldAxis = axis === 'view' ? basis.direction : basis[axis];
  return turnModel(orientation, worldAxis, angle);
}

/** Below this distance of |direction · Z| from 1 the view counts as looking along Z (pole). */
const POLE_TOLERANCE = 1e-9;

/**
 * Levels the orientation for 'turntable' (spec 09, "Operace", levelOrientation): the view
 * direction stays and Z comes up. At a pole the azimuth stays: right is only made horizontal.
 */
export function levelOrientation(orientation: Quat): Quat {
  const { right, direction } = basisOf(orientation);
  const dz = vec3.dot(direction, Z);
  if (Math.abs(dz) < 1 - POLE_TOLERANCE) return orientationFor(direction);
  const level = vec3.normalize(vec3.sub(right, vec3.scale(Z, vec3.dot(right, Z))));
  const pole: Vec3 = dz > 0 ? Z : [0, 0, -1];
  return quat.fromBasis(level, vec3.cross(pole, level), pole);
}

/** easeInOutCubic on 0 … 1; t outside is clamped. */
export function ease(t: number): number {
  const c = Math.min(Math.max(t, 0), 1);
  return c < 0.5 ? 4 * c * c * c : 1 - (-2 * c + 2) ** 3 / 2;
}

/** Orientation of an animation at time share t: slerp along the shorter arc with easing. */
export function interpolate(from: Quat, to: Quat, t: number): Quat {
  return quat.slerp(from, to, ease(t));
}

/** Camera distance from the target and the clip planes for a depth range. */
export interface ClipRange {
  /** Camera position = target + direction · distance. */
  readonly distance: number;
  readonly near: number;
  readonly far: number;
}

/** Smallest depth reserve in mm, so point bounds and flat scenes still get a usable range. */
const MIN_PAD = 1;
/** Depth reserve as a share of the depth range of the bounds. */
const PAD_SHARE = 0.05;

/**
 * Depth of everything visible (spec 09, "Near a far"): the corners of the bounds projected on
 * the unit `direction` (from the target towards the camera) relative to the target give sMin and
 * sMax. The whole bounds lie between near and far with pad / 2 to spare in front and pad behind,
 * wherever the target is.
 */
export function clipRange(bounds: BoundingBox, target: Vec3, direction: Vec3): ClipRange {
  let sMin = Infinity;
  let sMax = -Infinity;
  for (const corner of boxCorners(bounds)) {
    const s = vec3.dot(vec3.sub(corner, target), direction);
    sMin = Math.min(sMin, s);
    sMax = Math.max(sMax, s);
  }
  const pad = Math.max(PAD_SHARE * (sMax - sMin), MIN_PAD);
  const distance = sMax + pad;
  return { distance, near: pad / 2, far: distance - sMin + pad };
}
