import type { Vec2 } from '@/core';

// 2D vector helpers of the sketch geometry (regions, snapper, inference). Internal to sketch.

export const TWO_PI = 2 * Math.PI;

export function sub(a: Vec2, b: Vec2): Vec2 {
  return [a[0] - b[0], a[1] - b[1]];
}

export function dot(a: Vec2, b: Vec2): number {
  return a[0] * b[0] + a[1] * b[1];
}

export function cross(a: Vec2, b: Vec2): number {
  return a[0] * b[1] - a[1] * b[0];
}

export function length(a: Vec2): number {
  return Math.hypot(a[0], a[1]);
}

export function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

export function lerp(origin: Vec2, d: Vec2, t: number): Vec2 {
  return [origin[0] + d[0] * t, origin[1] + d[1] * t];
}

export function normalize(a: Vec2): Vec2 {
  const l = length(a);
  return [a[0] / l, a[1] / l];
}

export function angleOf(d: Vec2): number {
  return Math.atan2(d[1], d[0]);
}

export function mod2pi(a: number): number {
  const m = a % TWO_PI;
  return m < 0 ? m + TWO_PI : m;
}
