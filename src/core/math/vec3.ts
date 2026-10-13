import { vec3 as gl } from 'gl-matrix';
import { assert } from '../assert';

// Facade over gl-matrix (ADR 0012). Our immutable value type stays the public API;
// gl-matrix never leaks out of src/core/math/. Conversion to THREE.Vector3 belongs to render.
export type Vec3 = readonly [number, number, number];

/** Default tolerance for comparing computed coordinates. */
export const EPSILON = 1e-9;

type Out = [number, number, number];

/**
 * Runs a gl-matrix operation into a fresh plain array: the result is a new
 * object (immutability) and a number[] keeps float64 precision, unlike gl-matrix
 * create(), which returns a Float32Array.
 */
function calc(op: (out: Out) => unknown): Vec3 {
  const out: Out = [0, 0, 0];
  op(out);
  return out;
}

const add = (a: Vec3, b: Vec3): Vec3 => calc((o) => gl.add(o, a, b));

const sub = (a: Vec3, b: Vec3): Vec3 => calc((o) => gl.subtract(o, a, b));

const scale = (v: Vec3, s: number): Vec3 => calc((o) => gl.scale(o, v, s));

const dot = (a: Vec3, b: Vec3): number => gl.dot(a, b);

const cross = (a: Vec3, b: Vec3): Vec3 => calc((o) => gl.cross(o, a, b));

const length = (v: Vec3): number => gl.length(v);

function normalize(v: Vec3): Vec3 {
  // gl-matrix returns the zero vector silently; a zero direction is a programmer error here.
  assert(length(v) > 0, 'Cannot normalize a zero vector');
  return calc((o) => gl.normalize(o, v));
}

// Own implementation: gl-matrix equals uses a fixed relative epsilon we cannot pass in.
const equals = (a: Vec3, b: Vec3, eps = EPSILON): boolean =>
  Math.abs(a[0] - b[0]) <= eps && Math.abs(a[1] - b[1]) <= eps && Math.abs(a[2] - b[2]) <= eps;

export const vec3 = { add, sub, scale, dot, cross, length, normalize, equals };
