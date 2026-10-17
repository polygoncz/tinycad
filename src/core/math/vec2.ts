import { assert } from '../assert';

// 2D vectors (spec 02-core "2D vektory"): the one implementation for sketch, kernel, kernel-occt
// and sketcher. No gl-matrix here: a few lines in the hot loops of regions and intersections, and
// the results stay exactly those of the former copies (Math.hypot).
export type Vec2 = readonly [number, number];

export const TWO_PI = 2 * Math.PI;

/** The angle moved into [0, 2π). */
export function mod2pi(angle: number): number {
  const m = angle % TWO_PI;
  return m < 0 ? m + TWO_PI : m;
}

const add = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]];

const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];

const scale = (v: Vec2, k: number): Vec2 => [v[0] * k, v[1] * k];

/** origin + t·d: a point on the line through origin with direction d (not a lerp of two points). */
const addScaled = (origin: Vec2, d: Vec2, t: number): Vec2 => [
  origin[0] + d[0] * t,
  origin[1] + d[1] * t,
];

const mid = (a: Vec2, b: Vec2): Vec2 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

const dot = (a: Vec2, b: Vec2): number => a[0] * b[0] + a[1] * b[1];

/** The z component of a × b: positive when b is counter-clockwise from a. */
const cross = (a: Vec2, b: Vec2): number => a[0] * b[1] - a[1] * b[0];

const length = (v: Vec2): number => Math.hypot(v[0], v[1]);

const dist = (a: Vec2, b: Vec2): number => Math.hypot(a[0] - b[0], a[1] - b[1]);

function normalize(v: Vec2): Vec2 {
  const l = length(v);
  // A zero direction is a programmer error, as in vec3.normalize.
  assert(l > 0, 'Cannot normalize a zero vector');
  return [v[0] / l, v[1] / l];
}

/** atan2(y, x), in (−π, π]. */
const angleOf = (d: Vec2): number => Math.atan2(d[1], d[0]);

/** Distance of p from the segment ab (the foot clamped to the segment); a = b gives |p − a|. */
function distanceToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const s = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - a[0] - s * dx, p[1] - a[1] - s * dy);
}

export const vec2 = {
  add,
  sub,
  scale,
  addScaled,
  mid,
  dot,
  cross,
  length,
  dist,
  normalize,
  angleOf,
  distanceToSegment,
};
