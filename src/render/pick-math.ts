// Picking math (spec 09, "Picking"): CSS px → NDC, the outward normal of a hit triangle,
// projection of edge segments to the screen, the occlusion tolerance. Pure, no three import, so
// it is tested in Node; picker.ts does the raycasts with Three.js.

import { vec3, type Vec3 } from '@/core';
import type { BoundingBox } from '@/kernel';

/** Relative occlusion tolerance: a fraction of the scene diagonal (spec 09, "Picking" point 2). */
const OCCLUSION_RELATIVE = 1e-4;
/** Absolute floor of the occlusion tolerance (mm) for an empty or tiny scene. */
const OCCLUSION_MIN = 1e-6;

/** CSS px relative to the canvas → normalized device coordinates (x right, y up, −1…1). */
export function toNdc(
  x: number,
  y: number,
  width: number,
  height: number,
): { x: number; y: number } {
  return { x: (x / width) * 2 - 1, y: 1 - (y / height) * 2 };
}

/**
 * Unit normal of the triangle abc by its winding: counter-clockwise seen from outside = out of
 * the body (the kernel's mesh contract, spec 06). Not turned against the ray, so a hit seen from
 * inside the body still gives the outward normal. Computed from the corners, not from vertex
 * normals, so it is the plane of the hit triangle. A degenerate triangle (never hit by a raycast,
 * guarded anyway) has no plane; it falls back to the reversed ray direction, which points out of
 * the body for a hit on its outside.
 */
export function triangleNormal(a: Vec3, b: Vec3, c: Vec3, rayDirection: Vec3): Vec3 {
  const n = vec3.cross(vec3.sub(b, a), vec3.sub(c, a));
  if (vec3.length(n) === 0) return vec3.normalize(vec3.scale(rayDirection, -1));
  return vec3.normalize(n);
}

/**
 * Projects segments (x0, y0, z0, x1, y1, z1 each) by a column-major 4×4 matrix (projection ×
 * view × model, as THREE.Matrix4.elements) into CSS px: x0, y0, x1, y1 each. A segment with an end
 * outside near/far, or wholly beyond one side of the view, becomes NaN, so closestSegments skips
 * it. Clipping a segment that crosses near/far is left out: near/far enclose the bounding sphere
 * of the scene (spec 09, "Kamera"), so it does not happen in practice.
 */
export function projectSegments(
  positions: Float32Array,
  matrix: ArrayLike<number>,
  width: number,
  height: number,
): Float32Array<ArrayBuffer> {
  const count = Math.floor(positions.length / 6);
  const screen = new Float32Array(count * 4);
  for (let s = 0; s < count; s++) {
    const p0 = projectPoint(matrix, positions, 6 * s);
    const p1 = projectPoint(matrix, positions, 6 * s + 3);
    if (p0 === null || p1 === null || outsideTogether(p0, p1)) {
      screen.fill(NaN, 4 * s, 4 * s + 4);
      continue;
    }
    screen[4 * s] = ((p0[0] + 1) / 2) * width;
    screen[4 * s + 1] = ((1 - p0[1]) / 2) * height;
    screen[4 * s + 2] = ((p1[0] + 1) / 2) * width;
    screen[4 * s + 3] = ((1 - p1[1]) / 2) * height;
  }
  return screen;
}

/** Point at parameter t of segment `segment` (pairs of points, 6 numbers per segment). */
export function segmentPoint(positions: Float32Array, segment: number, t: number): Vec3 {
  const at = (i: number): number => {
    const start = positions[6 * segment + i] ?? 0;
    const end = positions[6 * segment + 3 + i] ?? 0;
    return start + (end - start) * t;
  };
  return [at(0), at(1), at(2)];
}

/**
 * How much closer than an edge point a face may be hit and the edge still counts as visible
 * (spec 09: 1e-4 × the scene diagonal). The edge lies on the border of its faces, so a ray to it
 * hits them at nearly the same depth; the tolerance absorbs the rounding.
 */
export function occlusionTolerance(bounds: BoundingBox | null): number {
  if (bounds === null) return OCCLUSION_MIN;
  const diagonal = vec3.length(vec3.sub(bounds.max, bounds.min));
  return Math.max(OCCLUSION_RELATIVE * diagonal, OCCLUSION_MIN);
}

/** NDC of the point at `offset`, null when it is outside near/far (or behind a perspective eye). */
function projectPoint(m: ArrayLike<number>, p: Float32Array, offset: number): Vec3 | null {
  const x = p[offset] ?? 0;
  const y = p[offset + 1] ?? 0;
  const z = p[offset + 2] ?? 0;
  const e = (i: number): number => m[i] ?? 0;
  const w = e(3) * x + e(7) * y + e(11) * z + e(15);
  if (w <= 0) return null;
  const ndcZ = (e(2) * x + e(6) * y + e(10) * z + e(14)) / w;
  if (ndcZ < -1 || ndcZ > 1) return null;
  return [
    (e(0) * x + e(4) * y + e(8) * z + e(12)) / w,
    (e(1) * x + e(5) * y + e(9) * z + e(13)) / w,
    ndcZ,
  ];
}

/** Both ends beyond the same side of the view: the segment cannot be on screen. */
function outsideTogether(a: Vec3, b: Vec3): boolean {
  return (
    (a[0] < -1 && b[0] < -1) ||
    (a[0] > 1 && b[0] > 1) ||
    (a[1] < -1 && b[1] < -1) ||
    (a[1] > 1 && b[1] > 1)
  );
}
