// Shape and picking of manipulator handles on the screen (spec 09, "Manipulátory (M18)" and
// "Vzhled od M19 (styl Fusion)"). Pure, no three import, so it is tested in Node;
// manipulator-layer.ts draws the same glyphs with Three.js and the viewport projects them with its
// camera.

import { vec3, type Vec3 } from '@/core';
import type { HandleView, HandleVisibility, ManipulatorGlyphs } from '@/interaction';
import type { BoundingBox } from '@/kernel';
import { closestSegments } from './edge-pick';

// The sizes of the glyphs and the limits of their hiding belong to interaction, which decides
// about manipulators (M20, D6): render may take only types from it, so app passes the values to
// createViewport and they come here as HandleShape.

/** The sizes of the glyphs and the limits of their hiding, from interaction through app. */
export interface HandleShape {
  readonly glyphs: ManipulatorGlyphs;
  readonly visibility: HandleVisibility;
}

/** Segments of a full ring, drawn and picked alike. */
export const HANDLE_RING_SEGMENTS = 64;
/** Segments of a quarter, drawn and picked alike. */
export const HANDLE_QUARTER_SEGMENTS = 16;
/** Pick tolerance of an arrow in CSS px. */
export const HANDLE_PICK_PX = 8;
/** Pick tolerance of a ring and a quarter in CSS px. */
export const HANDLE_RING_PICK_PX = 6;
/** Pick tolerance of a point handle (distance from its projection) in CSS px. */
export const HANDLE_POINT_PICK_PX = 10;

/** CSS px relative to the view area; NaN = not on screen. */
export type ScreenPoint = readonly [x: number, y: number];

/** A handle projected to the screen, in the order of ManipulatorPort.set. */
export type ScreenHandle =
  | {
      readonly kind: 'linear';
      readonly id: string;
      /** Start of the shaft, glyphs.arrowStartPx along the direction. */
      readonly from: ScreenPoint;
      /** The tip, glyphs.arrowTipPx along the direction. */
      readonly to: ScreenPoint;
    }
  | {
      readonly kind: 'angular';
      readonly id: string;
      /**
       * A full ring: HANDLE_RING_SEGMENTS points of a closed polyline (the last joins the first).
       * A quarter: HANDLE_QUARTER_SEGMENTS + 1 points of an open one, from zero to axis × zero.
       */
      readonly points: readonly ScreenPoint[];
      readonly closed: boolean;
    }
  | {
      readonly kind: 'planar';
      readonly id: string;
      /** The corners at (near, near), (far, near), (far, far), (near, far) along (u, v). */
      readonly corners: readonly [ScreenPoint, ScreenPoint, ScreenPoint, ScreenPoint];
    }
  | {
      readonly kind: 'point';
      readonly id: string;
      readonly center: ScreenPoint;
      /** Radius of the drawn disc, glyphs.pointPx. */
      readonly radius: number;
    };

/**
 * True when the arrow along `direction` points (nearly) at the viewer or away from them, so it
 * would collapse to a dot (|cos| > visibility.arrowHideCos). Both vectors need not be unit.
 */
export function arrowHidden(
  direction: Vec3,
  viewDirection: Vec3,
  visibility: HandleVisibility,
): boolean {
  const cos = vec3.dot(vec3.normalize(direction), vec3.normalize(viewDirection));
  return Math.abs(cos) > visibility.arrowHideCos;
}

/**
 * True when the ring around `axis` is seen (nearly) edge-on, so it would collapse to a line
 * (|cos| < visibility.ringHideCos). Both vectors need not be unit.
 */
export function ringHidden(axis: Vec3, viewDirection: Vec3, visibility: HandleVisibility): boolean {
  const cos = vec3.dot(vec3.normalize(axis), vec3.normalize(viewDirection));
  return Math.abs(cos) < visibility.ringHideCos;
}

/**
 * True when the square spanned by `u` and `v` is seen (nearly) edge-on, so it would collapse to
 * a line (|(u × v) · view| < visibility.squareHideCos). The vectors need not be unit.
 */
export function squareHidden(
  u: Vec3,
  v: Vec3,
  viewDirection: Vec3,
  visibility: HandleVisibility,
): boolean {
  const normal = vec3.normalize(vec3.cross(u, v));
  const cos = vec3.dot(normal, vec3.normalize(viewDirection));
  return Math.abs(cos) < visibility.squareHideCos;
}

/**
 * True when the glyph of the view is hidden for this view direction (arrowHidden, ringHidden,
 * squareHidden); a point is never hidden.
 */
export function handleHidden(
  view: HandleView,
  viewDirection: Vec3,
  visibility: HandleVisibility,
): boolean {
  switch (view.kind) {
    case 'linear':
      return arrowHidden(view.direction, viewDirection, visibility);
    case 'angular':
      return ringHidden(view.axis, viewDirection, visibility);
    case 'planar':
      return squareHidden(view.u, view.v, viewDirection, visibility);
    case 'point':
      return false;
  }
}

/**
 * Box around every glyph in the world, for near/far (spec 09, "Near a far"). An arrow, a ring
 * and a point: their anchor point (position, center) grown on all sides by the glyph size
 * (glyphs.arrowTipPx, ringPx, pointPx) × worldPerPx; a square: its four corners.
 * Hidden handles count too, so the box does not jump while the camera turns. No handles → null.
 */
export function handleBounds(
  handles: readonly HandleView[],
  worldPerPx: number,
  glyphs: ManipulatorGlyphs,
): BoundingBox | null {
  const points: Vec3[] = [];
  const grown = (point: Vec3, sizePx: number): void => {
    const size = sizePx * worldPerPx;
    points.push(vec3.sub(point, [size, size, size]), vec3.add(point, [size, size, size]));
  };
  for (const handle of handles) {
    switch (handle.kind) {
      case 'linear':
        grown(handle.position, glyphs.arrowTipPx);
        break;
      case 'angular':
        grown(handle.center, glyphs.ringPx);
        break;
      case 'planar':
        points.push(...squareCorners(handle, worldPerPx, glyphs));
        break;
      case 'point':
        grown(handle.position, glyphs.pointPx);
        break;
    }
  }
  const [first, ...rest] = points;
  if (first === undefined) return null;
  return rest.reduce<BoundingBox>(
    (box, p) => ({
      min: [Math.min(box.min[0], p[0]), Math.min(box.min[1], p[1]), Math.min(box.min[2], p[2])],
      max: [Math.max(box.max[0], p[0]), Math.max(box.max[1], p[1]), Math.max(box.max[2], p[2])],
    }),
    { min: first, max: first },
  );
}

/**
 * Points of an arc of `radius` around `center`: from `zero` (angle 0) towards axis × zero, at
 * `segments` equal steps of `sweep`; `count` points in all. zero is made perpendicular to the axis
 * and unit, so slightly off input still gives a circle.
 */
export function arcPoints(
  center: Vec3,
  axis: Vec3,
  zero: Vec3,
  radius: number,
  sweep: number,
  segments: number,
  count: number,
): readonly Vec3[] {
  const n = vec3.normalize(axis);
  const u = vec3.normalize(vec3.sub(zero, vec3.scale(n, vec3.dot(zero, n))));
  const v = vec3.cross(n, u);
  return Array.from({ length: count }, (_, i): Vec3 => {
    const angle = (sweep * i) / segments;
    const offset = vec3.add(
      vec3.scale(u, radius * Math.cos(angle)),
      vec3.scale(v, radius * Math.sin(angle)),
    );
    return vec3.add(center, offset);
  });
}

/** The corners of a square in the world, in the order of ScreenHandle 'planar'. */
function squareCorners(
  handle: Extract<HandleView, { readonly kind: 'planar' }>,
  worldPerPx: number,
  glyphs: ManipulatorGlyphs,
): readonly [Vec3, Vec3, Vec3, Vec3] {
  const u = vec3.normalize(handle.u);
  const v = vec3.normalize(handle.v);
  const near = glyphs.squareNearPx * worldPerPx;
  const far = glyphs.squareFarPx * worldPerPx;
  const at = (a: number, b: number): Vec3 =>
    vec3.add(handle.origin, vec3.add(vec3.scale(u, a), vec3.scale(v, b)));
  return [at(near, near), at(far, near), at(far, far), at(near, far)];
}

/**
 * Projects handle views to the screen: the one place that knows the shape of a glyph, so drawing
 * (manipulator-layer.ts) and picking agree.
 *
 * - `project` maps a world point to CSS px of the view area (the viewport derives it from its
 *   camera); it may give NaN for a point off screen.
 * - `worldPerPx` = world units per CSS px of the orthographic camera; it turns the pixel sizes
 *   into world lengths.
 * - `viewDirection` = the direction the camera looks in (any length); a glyph hidden by
 *   handleHidden (an arrow end-on, a ring, quarter or square edge-on) is left out.
 * - `shape` = the sizes of the glyphs and the limits of their hiding.
 *
 * An arrow becomes the segment from glyphs.arrowStartPx to its tip glyphs.arrowTipPx along
 * `direction`; a full ring HANDLE_RING_SEGMENTS points glyphs.ringPx around `center` in the plane
 * perpendicular to `axis`, starting at `zero`; a quarter the open polyline of
 * HANDLE_QUARTER_SEGMENTS segments from `zero` to axis × zero; a square its four corners; a point
 * its projected position and glyphs.pointPx. The order of `handles` is kept (ties in pickHandle
 * go to the earlier one).
 */
export function projectHandles(
  handles: readonly HandleView[],
  project: (p: Vec3) => ScreenPoint,
  worldPerPx: number,
  viewDirection: Vec3,
  shape: HandleShape,
): readonly ScreenHandle[] {
  const { glyphs, visibility } = shape;
  const result: ScreenHandle[] = [];
  for (const handle of handles) {
    if (handleHidden(handle, viewDirection, visibility)) continue;
    switch (handle.kind) {
      case 'linear': {
        const direction = vec3.normalize(handle.direction);
        const along = (px: number): Vec3 =>
          vec3.add(handle.position, vec3.scale(direction, px * worldPerPx));
        result.push({
          kind: 'linear',
          id: handle.id,
          from: project(along(glyphs.arrowStartPx)),
          to: project(along(glyphs.arrowTipPx)),
        });
        break;
      }
      case 'angular': {
        const full = handle.extent === 'full';
        const points = full
          ? arcPoints(
              handle.center,
              handle.axis,
              handle.zero,
              glyphs.ringPx * worldPerPx,
              2 * Math.PI,
              HANDLE_RING_SEGMENTS,
              HANDLE_RING_SEGMENTS,
            )
          : arcPoints(
              handle.center,
              handle.axis,
              handle.zero,
              glyphs.ringPx * worldPerPx,
              Math.PI / 2,
              HANDLE_QUARTER_SEGMENTS,
              HANDLE_QUARTER_SEGMENTS + 1,
            );
        result.push({ kind: 'angular', id: handle.id, points: points.map(project), closed: full });
        break;
      }
      case 'planar': {
        const [a, b, c, d] = squareCorners(handle, worldPerPx, glyphs);
        result.push({
          kind: 'planar',
          id: handle.id,
          corners: [project(a), project(b), project(c), project(d)],
        });
        break;
      }
      case 'point':
        result.push({
          kind: 'point',
          id: handle.id,
          center: project(handle.position),
          radius: glyphs.pointPx,
        });
        break;
    }
  }
  return result;
}

/**
 * Id of the handle under (x, y) in CSS px, by priority (spec 09, "Vzhled od M19"):
 *
 * 1. a point within HANDLE_POINT_PICK_PX of its projection, the nearest (the earlier on a tie);
 * 2. a square with (x, y) inside its projected corners, the earlier one;
 * 3. an arrow within HANDLE_PICK_PX of its segment or a ring or quarter within HANDLE_RING_PICK_PX
 *    of its polyline, the nearest (the earlier on a tie).
 *
 * Nothing → null. Handles with a NaN point are skipped.
 */
export function pickHandle(
  screenHandles: readonly ScreenHandle[],
  x: number,
  y: number,
): string | null {
  return (
    nearest(screenHandles, (handle) =>
      handle.kind === 'point' ? pointDistance(handle.center, x, y) : null,
    ) ??
    screenHandles.find((handle) => handle.kind === 'planar' && insideQuad(handle.corners, x, y))
      ?.id ??
    nearest(screenHandles, (handle) => lineDistance(handle, x, y))
  );
}

/** Id of the handle with the smallest distance (null = not a candidate); the earlier on a tie. */
function nearest(
  handles: readonly ScreenHandle[],
  distanceOf: (handle: ScreenHandle) => number | null,
): string | null {
  let best: { readonly id: string; readonly distance: number } | null = null;
  for (const handle of handles) {
    const distance = distanceOf(handle);
    if (distance === null) continue;
    // Strictly nearer: on a tie the earlier handle stays.
    if (best === null || distance < best.distance) best = { id: handle.id, distance };
  }
  return best?.id ?? null;
}

/** Distance from (x, y) to a point handle within its tolerance; null = farther or off screen. */
function pointDistance(center: ScreenPoint, x: number, y: number): number | null {
  const distance = Math.hypot(center[0] - x, center[1] - y);
  // A NaN distance fails the comparison as well.
  return distance <= HANDLE_POINT_PICK_PX ? distance : null;
}

/** Distance from (x, y) to an arrow, ring or quarter within its tolerance; null = farther, off screen or another kind. */
function lineDistance(handle: ScreenHandle, x: number, y: number): number | null {
  switch (handle.kind) {
    case 'linear':
      return (
        closestSegments(new Float32Array([...handle.from, ...handle.to]), x, y, HANDLE_PICK_PX)[0]
          ?.distancePx ?? null
      );
    case 'angular':
      return (
        closestSegments(polyline(handle.points, handle.closed), x, y, HANDLE_RING_PICK_PX)[0]
          ?.distancePx ?? null
      );
    case 'planar':
    case 'point':
      return null;
  }
}

/**
 * True when (x, y) lies inside the convex quadrilateral (a parallelogram projected by an
 * orthographic camera), whatever its winding; a NaN corner gives false.
 */
function insideQuad(corners: readonly ScreenPoint[], x: number, y: number): boolean {
  let sign = 0;
  for (const [i, a] of corners.entries()) {
    const b = corners[(i + 1) % corners.length] ?? a;
    const cross = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
    if (Number.isNaN(cross)) return false;
    if (cross === 0) continue;
    if (sign === 0) sign = Math.sign(cross);
    else if (Math.sign(cross) !== sign) return false;
  }
  return sign !== 0;
}

/** x0, y0, x1, y1 per edge of the polyline; closed joins the last point back to the first. */
function polyline(points: readonly ScreenPoint[], closed: boolean): Float32Array {
  const count = closed ? points.length : Math.max(points.length - 1, 0);
  const segments = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    const point = points[i];
    const next = points[(i + 1) % points.length];
    if (point === undefined || next === undefined) continue;
    segments.set([point[0], point[1], next[0], next[1]], 4 * i);
  }
  return segments;
}
