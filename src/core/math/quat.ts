import { quat as gl, vec3 as glVec3 } from 'gl-matrix';
import { assert } from '../assert';
import { vec3, type Vec3 } from './vec3';

// Facade over gl-matrix (ADR 0012). Unit quaternion [x, y, z, w] for camera orientation
// (spec 02, "Matematika", ADR 0019). gl-matrix never leaks out of src/core/math/.
export type Quat = readonly [number, number, number, number];

type Out = [number, number, number, number];

/** Runs a gl-matrix operation into a fresh float64 array (see calc in vec3.ts). */
function calc(op: (out: Out) => unknown): Quat {
  const out: Out = [0, 0, 0, 0];
  op(out);
  return out;
}

const identity = (): Quat => calc((o) => gl.identity(o));

/** Right-handed rotation by `angle` radians about `axis` (need not be unit length). */
function fromAxisAngle(axis: Vec3, angle: number): Quat {
  // gl-matrix expects a unit axis; normalizing first turns a zero axis into an exception.
  const unit = vec3.normalize(axis);
  return calc((o) => gl.setAxisAngle(o, unit, angle));
}

function normalize(q: Quat): Quat {
  // gl-matrix returns the zero quaternion silently; that is a programmer error here.
  assert(Math.hypot(q[0], q[1], q[2], q[3]) > 0, 'Cannot normalize a zero quaternion');
  return calc((o) => gl.normalize(o, q));
}

/**
 * Rotation turning the axes x, y, z into the given orthonormal right-handed basis. The basis
 * vectors are the columns of the rotation matrix (column-major mat3 for gl-matrix).
 */
function fromBasis(right: Vec3, up: Vec3, direction: Vec3): Quat {
  // prettier-ignore
  const m = [
    right[0], right[1], right[2],
    up[0], up[1], up[2],
    direction[0], direction[1], direction[2],
  ];
  // Rounding in the basis would leave the result slightly off unit length.
  return normalize(calc((o) => gl.fromMat3(o, m)));
}

/** a · b: the result applies b first, then a (like mat4.multiply). */
const multiply = (a: Quat, b: Quat): Quat => calc((o) => gl.multiply(o, a, b));

function rotate(q: Quat, v: Vec3): Vec3 {
  const out: [number, number, number] = [0, 0, 0];
  glVec3.transformQuat(out, v, q);
  return out;
}

/** Spherical interpolation along the shorter arc (gl-matrix flips b when a · b < 0). */
const slerp = (a: Quat, b: Quat, t: number): Quat => calc((o) => gl.slerp(o, a, b, t));

/**
 * Rotation angle between a and b in radians, in ⟨0, π⟩; q and −q count as the same rotation.
 * Own implementation: gl-matrix getAngle uses acos(2·dot² − 1), which loses precision near 0
 * and gives NaN when rounding pushes |dot| above 1. atan2 of the relative rotation stays exact.
 */
function angle(a: Quat, b: Quat): number {
  const conjugateA = calc((o) => gl.conjugate(o, a));
  const [x, y, z, w] = multiply(conjugateA, b);
  return 2 * Math.atan2(Math.hypot(x, y, z), Math.abs(w));
}

export const quat = {
  identity,
  fromAxisAngle,
  fromBasis,
  multiply,
  rotate,
  slerp,
  angle,
  normalize,
};
