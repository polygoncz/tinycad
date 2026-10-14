import type { Plane, Vec3 } from '@/core';
import { deepFreeze } from './freeze';
import type { FeatureId } from './model';
import type { AxisId, PlaneId } from './refs';

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

/** The ids of the origin axes, '<ORIGIN>/axis:<name>' (M13). */
export const ORIGIN_AXIS_IDS: {
  readonly x: AxisId;
  readonly y: AxisId;
  readonly z: AxisId;
} = Object.freeze({
  // Constant ids in the shape parseAxisId accepts (tested), so the casts are safe.
  x: `${ORIGIN}/axis:x` as AxisId,
  y: `${ORIGIN}/axis:y` as AxisId,
  z: `${ORIGIN}/axis:z` as AxisId,
});

export interface OriginAxis {
  readonly id: AxisId;
  /** Translation key, 'origin.axis.x' (ADR 0014). */
  readonly label: string;
  readonly origin: Vec3;
  /** Unit direction. */
  readonly direction: Vec3;
}

/** The axes X, Y and Z through the origin, in this order (M13, R72). */
export const ORIGIN_AXES: readonly OriginAxis[] = deepFreeze([
  { id: ORIGIN_AXIS_IDS.x, label: 'origin.axis.x', origin: [0, 0, 0], direction: [1, 0, 0] },
  { id: ORIGIN_AXIS_IDS.y, label: 'origin.axis.y', origin: [0, 0, 0], direction: [0, 1, 0] },
  { id: ORIGIN_AXIS_IDS.z, label: 'origin.axis.z', origin: [0, 0, 0], direction: [0, 0, 1] },
]);
