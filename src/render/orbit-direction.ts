// Direction the camera is placed in for a standard view (spec 09, "Kamera"). Pure, no three import.
//
// A view exactly along Z is degenerate for OrbitControls (polar angle 0, the azimuth is lost), so
// top and bottom stand on a direction tilted by VIEW_TILT: top towards -Y, bottom towards +Y.
// Projected +Z then points to +Y on screen, as viewBasis promises for the exact views.

import { vec3, type Vec3 } from '@/core';
import { STANDARD_VIEWS, type StandardView } from './camera-math';

/** Tilt of top and bottom off the Z axis in radians. */
export const VIEW_TILT = 1e-4;

const TILTED_TOP: Vec3 = [0, -Math.sin(VIEW_TILT), Math.cos(VIEW_TILT)];
const TILTED_BOTTOM: Vec3 = [0, Math.sin(VIEW_TILT), -Math.cos(VIEW_TILT)];

/** Unit vector from the target towards the camera for a standard view. */
export function orbitDirection(view: StandardView): Vec3 {
  if (view === 'top') return TILTED_TOP;
  if (view === 'bottom') return TILTED_BOTTOM;
  return STANDARD_VIEWS[view].direction;
}

/** Beyond this |d̂·Z| a view direction counts as along Z (spec 09, setViewDirection). */
const ALONG_Z = 1 - 1e-9;

/**
 * Direction the camera is placed in for CameraController.setViewDirection (M12): d normalized
 * (zero = programmer error); a direction (almost) along Z gives the tilted top or bottom, so
 * OrbitControls keep their azimuth and +Y stays up on screen.
 */
export function viewDirectionFor(direction: Vec3): Vec3 {
  const d = vec3.normalize(direction);
  if (d[2] > ALONG_Z) return TILTED_TOP;
  if (d[2] < -ALONG_Z) return TILTED_BOTTOM;
  return d;
}
