import { mat4 as gl, vec3 as glVec3 } from 'gl-matrix';
import { vec3, type Vec3 } from './vec3';

// Facade over gl-matrix (ADR 0012). 4×4 matrix, column-major like gl-matrix,
// Three.js and WebGL: element (row r, column c) is at index c * 4 + r, so the
// translation sits at indices 12, 13, 14. A 16-tuple instead of number[] makes
// every index typed as number and rejects arrays of the wrong length.
// prettier-ignore
export type Mat4 = readonly [
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
];

type Out = { -readonly [K in keyof Mat4]: Mat4[K] };

/** Runs a gl-matrix operation into a fresh float64 array (see calc in vec3.ts). */
function calc(op: (out: Out) => unknown): Mat4 {
  const out: Out = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  op(out);
  return out;
}

const identity = (): Mat4 => calc((o) => gl.identity(o));

const translation = (t: Vec3): Mat4 => calc((o) => gl.fromTranslation(o, t));

/** Right-handed rotation by `angle` radians about `axis` (need not be unit length). */
function rotationAxisAngle(axis: Vec3, angle: number): Mat4 {
  // gl-matrix returns null for an axis shorter than 1e-6 (its typings hide that).
  // Normalizing first turns a zero axis into an exception and the null case cannot occur.
  const unit = vec3.normalize(axis);
  return calc((o) => gl.fromRotation(o, angle, unit));
}

/** a · b: the result applies b first, then a. */
const multiply = (a: Mat4, b: Mat4): Mat4 => calc((o) => gl.multiply(o, a, b));

/** Transforms a point (w = 1). Divides by the resulting w, which is 1 for affine matrices. */
function transformPoint(m: Mat4, p: Vec3): Vec3 {
  const out: [number, number, number] = [0, 0, 0];
  glVec3.transformMat4(out, p, m);
  return out;
}

export const mat4 = { identity, translation, rotationAxisAngle, multiply, transformPoint };
