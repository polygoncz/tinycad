import type { Mat4 } from '@/core';

// The one check of a rigid motion shared by every GeometryKernel implementation (spec 06,
// "Stav po M11"): transform accepts only rotations with a translation, because a mirror flips
// the triangle winding and a scale changes the geometry (a copy instead of a location).

/** Default tolerance: the same EPSILON core uses for computed coordinates. */
const DEFAULT_TOLERANCE = 1e-9;

/**
 * m is a rigid motion: finite numbers, bottom row [0, 0, 0, 1], the rotation part orthonormal
 * with det +1. Compared element-wise within `tolerance`.
 */
export function isRigidMotion(m: Mat4, tolerance = DEFAULT_TOLERANCE): boolean {
  if (!m.every(Number.isFinite)) return false;
  const near = (a: number, b: number): boolean => Math.abs(a - b) <= tolerance;
  // Column-major: element (row r, column c) is at c * 4 + r, so the bottom row is 3, 7, 11, 15.
  if (!(near(m[3], 0) && near(m[7], 0) && near(m[11], 0) && near(m[15], 1))) return false;
  const columns = [
    [m[0], m[1], m[2]],
    [m[4], m[5], m[6]],
    [m[8], m[9], m[10]],
  ] as const;
  // Orthonormal: Rᵀ·R = I, i.e. the columns are unit and pairwise perpendicular.
  for (let i = 0; i < 3; i++) {
    for (let j = i; j < 3; j++) {
      if (!near(dot(columns[i], columns[j]), i === j ? 1 : 0)) return false;
    }
  }
  // An orthonormal matrix has det ±1; −1 is a mirror.
  const [c0, c1, c2] = columns;
  return dot(c0, cross(c1, c2)) > 0;
}

type Triple = readonly [number, number, number];

function dot(a: Triple | undefined, b: Triple | undefined): number {
  if (a === undefined || b === undefined) return Number.NaN;
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Triple, b: Triple): Triple {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
