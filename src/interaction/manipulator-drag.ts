// The math of dragging a handle (spec 10, "Matematika tažení"): pure functions from a pointer ray
// to the parameter of a linear, angular, planar or point handle, unwrapping across ±π and snapping.

import { vec3 } from '@/core';
import type { Vec3 } from '@/core';
import type { HandleUnit } from './manipulators';

/** 1 mm and 5°. */
export const SNAP_STEP: Readonly<Record<HandleUnit, number>> = Object.freeze({
  length: 1,
  angle: Math.PI / 36,
});
/** |direction · ray| above this limit → the linear drag is undefined. */
export const PARALLEL_LIMIT = 0.999;
/** |axis · ray| below this limit → the plane of the circle is seen edge-on, the angle undefined. */
export const EDGE_ON_LIMIT = 0.02;

export interface Ray {
  readonly origin: Vec3;
  readonly direction: Vec3;
}

const TWO_PI = 2 * Math.PI;

/**
 * The parameter t of the point of the line position + t·direction nearest to the ray; null for a
 * nearly parallel ray. The ray is taken as a whole line (the camera looks at the handle anyway).
 */
export function linearParam(position: Vec3, direction: Vec3, ray: Ray): number | null {
  const d = vec3.normalize(direction);
  const r = vec3.normalize(ray.direction);
  const b = vec3.dot(d, r);
  if (Math.abs(b) > PARALLEL_LIMIT) return null;
  // Closest points of two lines with unit directions: minimise |w + t·d − s·r|.
  const w = vec3.sub(position, ray.origin);
  const dw = vec3.dot(d, w);
  const rw = vec3.dot(r, w);
  const t = (b * rw - dw) / (1 - b * b);
  // t is along the unit d; scale back to the units of the given direction.
  return t / vec3.length(direction);
}

/**
 * The angle of the intersection of the ray with the plane (center, axis) from zero in (−π, π],
 * positive by axis; null when the plane is seen edge-on.
 */
export function angularParam(center: Vec3, axis: Vec3, zero: Vec3, ray: Ray): number | null {
  const n = vec3.normalize(axis);
  const r = vec3.normalize(ray.direction);
  const cos = vec3.dot(n, r);
  if (Math.abs(cos) < EDGE_ON_LIMIT) return null;
  const s = vec3.dot(n, vec3.sub(center, ray.origin)) / cos;
  const v = vec3.sub(vec3.add(ray.origin, vec3.scale(r, s)), center);
  const angle = Math.atan2(vec3.dot(vec3.cross(zero, v), n), vec3.dot(zero, v));
  // atan2 gives −π for a -0 sine; the range is half-open at −π.
  return angle === -Math.PI ? Math.PI : angle;
}

/**
 * The coordinates (a, b) of the intersection of the ray with the plane (origin, u × v) in the basis
 * u, v; null when the plane is seen edge-on (|n · ray| < EDGE_ON_LIMIT). u and v are unit and
 * perpendicular by the handle contract, so the coordinates are plain projections.
 */
export function planarParam(
  origin: Vec3,
  u: Vec3,
  v: Vec3,
  ray: Ray,
): readonly [number, number] | null {
  const n = vec3.normalize(vec3.cross(u, v));
  const r = vec3.normalize(ray.direction);
  const cos = vec3.dot(n, r);
  if (Math.abs(cos) < EDGE_ON_LIMIT) return null;
  const s = vec3.dot(n, vec3.sub(origin, ray.origin)) / cos;
  const w = vec3.sub(vec3.add(ray.origin, vec3.scale(r, s)), origin);
  return [vec3.dot(w, u), vec3.dot(w, v)];
}

/**
 * The intersection of the ray with the plane perpendicular to it through position, i.e. the point
 * of the ray nearest to position.
 */
export function pointParam(position: Vec3, ray: Ray): Vec3 {
  const r = vec3.normalize(ray.direction);
  const s = vec3.dot(r, vec3.sub(position, ray.origin));
  return vec3.add(ray.origin, vec3.scale(r, s));
}

/** next − prev mapped into (−π, π] (unwrapping across ±π). */
export function unwrapDelta(prev: number, next: number): number {
  const delta = next - prev;
  return delta - TWO_PI * Math.ceil((delta - Math.PI) / TWO_PI);
}

/** Snaps to a multiple of SNAP_STEP[unit] (fine = no snapping), then clips to [min, max]. */
export function snapValue(
  value: number,
  h: { unit: HandleUnit; min?: number; max?: number },
  fine: boolean,
): number {
  const step = SNAP_STEP[h.unit];
  let v = fine ? value : Math.round(value / step) * step;
  if (h.min !== undefined && v < h.min) v = h.min;
  if (h.max !== undefined && v > h.max) v = h.max;
  // Math.round(-0.3) is -0; params never hold -0.
  return v === 0 ? 0 : v;
}
