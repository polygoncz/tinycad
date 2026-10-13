// Camera math of the orthographic viewport (spec 09, "Kamera"): standard views and fitting a
// bounding box into the view. Pure, no three import; vectors via the vec3 facade (ADR 0012).

import { assert, vec3, type Vec3 } from '@/core';
import type { BoundingBox } from '@/kernel';

export type StandardView = 'iso' | 'top' | 'bottom' | 'front' | 'back' | 'left' | 'right';

export interface ViewDirection {
  /** Unit vector from the target towards the camera ("where the camera looks from"). */
  readonly direction: Vec3;
  /** Camera up (camera.up in Three.js); not necessarily perpendicular to direction (iso). */
  readonly up: Vec3;
}

const Z_UP: Vec3 = [0, 0, 1];
const Y_UP: Vec3 = [0, 1, 0];

export const STANDARD_VIEWS: Readonly<Record<StandardView, ViewDirection>> = {
  front: { direction: [0, -1, 0], up: Z_UP },
  back: { direction: [0, 1, 0], up: Z_UP },
  right: { direction: [1, 0, 0], up: Z_UP },
  left: { direction: [-1, 0, 0], up: Z_UP },
  top: { direction: [0, 0, 1], up: Y_UP },
  bottom: { direction: [0, 0, -1], up: Y_UP },
  iso: { direction: vec3.normalize([1, -1, 1]), up: Z_UP },
};

/** Orthonormal camera frame: right × up = direction (Three.js camera x, y, z axes). */
export interface ViewBasis {
  readonly right: Vec3;
  readonly up: Vec3;
  readonly direction: Vec3;
}

/** Below this |sin| between direction and +Z the view counts as looking along Z. */
const PARALLEL_TOLERANCE = 1e-6;

/**
 * Camera frame for a view direction under the Z-up convention: up is +Z projected into the
 * view plane; when looking along Z (top, bottom) up is +Y. Matches STANDARD_VIEWS.
 */
export function viewBasis(direction: Vec3): ViewBasis {
  const d = vec3.normalize(direction);
  const alongZ = vec3.length(vec3.cross(d, Z_UP)) < PARALLEL_TOLERANCE;
  const worldUp = alongZ ? Y_UP : Z_UP;
  const up = vec3.normalize(vec3.sub(worldUp, vec3.scale(d, vec3.dot(worldUp, d))));
  const right = vec3.cross(up, d);
  return { right, up, direction: d };
}

export interface OrthoFit {
  /** Point the camera looks at (centre of the bounds). */
  readonly target: Vec3;
  /** Half of the visible height in mm; the visible width is 2 · halfHeight · aspect. */
  readonly halfHeight: number;
  /** Camera position = target + direction · distance. */
  readonly distance: number;
  readonly near: number;
  readonly far: number;
}

/** Empty scene: a 200 × 200 mm frame around the origin (spec 09, CameraController.fitAll). */
const DEFAULT_HALF_SIZE = 100;
/** Smallest fitted half-height in mm, so a single point still gives a usable view. */
const MIN_HALF_HEIGHT = 1;

/**
 * Fits the bounds into an orthographic view along direction (see viewBasis for the frame).
 * The projected bounds fit with margin (0.1 = 10 %) on the limiting side. The camera stands
 * two bounding radii from the target and near/far enclose the whole bounding sphere, so the
 * bounds stay unclipped also when orbiting around the target.
 */
export function fitOrtho(
  bounds: BoundingBox | null,
  direction: Vec3,
  aspect: number,
  margin = 0.1,
): OrthoFit {
  assert(aspect > 0, 'aspect must be positive');
  assert(margin >= 0, 'margin must not be negative');
  if (bounds === null) {
    // The frame itself is 200 × 200, no margin around it.
    return withDepth([0, 0, 0], DEFAULT_HALF_SIZE / Math.min(1, aspect), DEFAULT_HALF_SIZE);
  }

  const { right, up } = viewBasis(direction);
  const target = vec3.scale(vec3.add(bounds.min, bounds.max), 0.5);
  let halfWidth = 0;
  let halfHeight = 0;
  for (const corner of boxCorners(bounds)) {
    const rel = vec3.sub(corner, target);
    halfWidth = Math.max(halfWidth, Math.abs(vec3.dot(rel, right)));
    halfHeight = Math.max(halfHeight, Math.abs(vec3.dot(rel, up)));
  }
  const fitted = (1 + margin) * Math.max(halfHeight, halfWidth / aspect);
  const radius = vec3.length(vec3.sub(bounds.max, bounds.min)) / 2;
  return withDepth(target, Math.max(fitted, MIN_HALF_HEIGHT), Math.max(radius, MIN_HALF_HEIGHT));
}

/** Camera distance and clip planes enclosing a sphere of radius around the target. */
function withDepth(target: Vec3, halfHeight: number, radius: number): OrthoFit {
  const distance = 2 * radius;
  return { target, halfHeight, distance, near: radius / 2, far: distance + radius * 1.5 };
}

function boxCorners(b: BoundingBox): readonly Vec3[] {
  const corners: Vec3[] = [];
  for (const x of [b.min[0], b.max[0]])
    for (const y of [b.min[1], b.max[1]])
      for (const z of [b.min[2], b.max[2]]) corners.push([x, y, z]);
  return corners;
}
