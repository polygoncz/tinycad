import type { Plane } from '@/core';
import { deepFreeze } from './freeze';
import type { FeatureId } from './model';
import type { PlaneId } from './refs';

// The origin geometry (spec 03, "Počáteční geometrie"; spec 12, "Roviny a počátek"): artifacts of
// the reserved owner 'origin' (ADR 0015). Constants here, because references in the data point to
// them; regen seeds them into its empty state and interaction builds the Browser rows from them.

/** The reserved owner of the origin geometry; no feature may have this id. */
// A constant id, the trusted place where it is minted.
export const ORIGIN = 'origin' as FeatureId;

/** The ids of the origin planes, '<ORIGIN>/plane:<name>'. */
export const ORIGIN_PLANE_IDS: {
  readonly xy: PlaneId;
  readonly xz: PlaneId;
  readonly yz: PlaneId;
} = Object.freeze({
  // Constant ids in the shape parsePlaneId accepts (tested), so the casts are safe.
  xy: `${ORIGIN}/plane:xy` as PlaneId,
  xz: `${ORIGIN}/plane:xz` as PlaneId,
  yz: `${ORIGIN}/plane:yz` as PlaneId,
});

export interface OriginPlane {
  readonly id: PlaneId;
  /** Translation key, 'origin.plane.xy' (ADR 0014). */
  readonly label: string;
  readonly plane: Plane;
}

/** Top (xy), front (xz) and right (yz) plane; axis y = normal × xDir is +Y, +Z, +Z. */
export const ORIGIN_PLANES: readonly OriginPlane[] = deepFreeze([
  {
    id: ORIGIN_PLANE_IDS.xy,
    label: 'origin.plane.xy',
    plane: { origin: [0, 0, 0], xDir: [1, 0, 0], normal: [0, 0, 1] },
  },
  {
    id: ORIGIN_PLANE_IDS.xz,
    label: 'origin.plane.xz',
    plane: { origin: [0, 0, 0], xDir: [1, 0, 0], normal: [0, -1, 0] },
  },
  {
    id: ORIGIN_PLANE_IDS.yz,
    label: 'origin.plane.yz',
    plane: { origin: [0, 0, 0], xDir: [0, 1, 0], normal: [1, 0, 0] },
  },
]);
