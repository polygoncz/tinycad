import type { Vec2 } from './vec2';
import { vec3, type Vec3 } from './vec3';

// Plane frame for the sketcher (spec 02-core, M12). No gl-matrix here:
// the vec3 facade is enough. Results are fresh readonly tuples, so no freezing is needed.

/** Plane frame: origin, unit x axis and unit normal, mutually perpendicular. Axis y = normal × xDir. */
export interface Plane {
  readonly origin: Vec3;
  readonly xDir: Vec3;
  readonly normal: Vec3;
}

/** Below this |direction·normal| a ray counts as parallel to the plane. */
const PARALLEL_TOLERANCE = 1e-12;

/** Default tolerance of isOrthonormal. */
const ORTHONORMAL_TOLERANCE = 1e-9;

const yDir = (p: Plane): Vec3 => vec3.cross(p.normal, p.xDir);

const toWorld = (p: Plane, v: Vec2): Vec3 =>
  vec3.add(p.origin, vec3.add(vec3.scale(p.xDir, v[0]), vec3.scale(yDir(p), v[1])));

function toLocal(p: Plane, w: Vec3): Vec2 {
  const d = vec3.sub(w, p.origin);
  return [vec3.dot(d, p.xDir), vec3.dot(d, yDir(p))];
}

/** Line–plane intersection; a hit behind the ray origin counts too (the ray is a picking line). */
function intersectRay(
  p: Plane,
  ray: { readonly origin: Vec3; readonly direction: Vec3 },
): Vec3 | null {
  const denom = vec3.dot(ray.direction, p.normal);
  if (Math.abs(denom) < PARALLEL_TOLERANCE) return null;
  const t = vec3.dot(vec3.sub(p.origin, ray.origin), p.normal) / denom;
  return vec3.add(ray.origin, vec3.scale(ray.direction, t));
}

function isOrthonormal(p: Plane, tolerance = ORTHONORMAL_TOLERANCE): boolean {
  const finite = [...p.origin, ...p.xDir, ...p.normal].every(Number.isFinite);
  // Comparisons with NaN are false, but the explicit check also rejects infinities in origin.
  return (
    finite &&
    Math.abs(vec3.length(p.xDir) - 1) <= tolerance &&
    Math.abs(vec3.length(p.normal) - 1) <= tolerance &&
    Math.abs(vec3.dot(p.xDir, p.normal)) <= tolerance
  );
}

export const plane = { yDir, toWorld, toLocal, intersectRay, isOrthonormal };
