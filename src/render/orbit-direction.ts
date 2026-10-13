// Direction the camera is placed in for a standard view (spec 09, "Kamera"). Pure, no three import.
//
// A view exactly along Z is degenerate for OrbitControls (polar angle 0, the azimuth is lost), so
// top and bottom stand on a direction tilted by VIEW_TILT: top towards -Y, bottom towards +Y.
// Projected +Z then points to +Y on screen, as viewBasis promises for the exact views.

import type { Vec3 } from '@/core';
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
