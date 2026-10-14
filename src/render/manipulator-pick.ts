// Shape and picking of manipulator handles on the screen (spec 09, "Manipulátory (M18)"). Pure,
// no three import, so it is tested in Node; manipulator-layer.ts draws the same glyphs with
// Three.js and the viewport projects them with its camera.

import { vec3, type Vec3 } from '@/core';
import type { HandleView } from '@/interaction';
import type { BoundingBox } from '@/kernel';
import { closestSegments } from './edge-pick';

/** Whole length of an arrow (shaft and cone) in CSS px. */
export const HANDLE_ARROW_PX = 80;
/** Radius of a ring in CSS px. */
export const HANDLE_RING_PX = 60;
/** Segments of a ring, drawn and picked alike. */
export const HANDLE_RING_SEGMENTS = 64;
/** Pick tolerance of an arrow in CSS px. */
export const HANDLE_PICK_PX = 8;
/** Pick tolerance of a ring in CSS px. */
export const HANDLE_RING_PICK_PX = 6;
/** An arrow with |direction · view direction| above this is neither drawn nor picked. */
export const HANDLE_HIDE_COS = 0.98;
/** A ring with |axis · view direction| below this is seen edge-on: neither drawn nor picked. */
export const HANDLE_RING_HIDE_COS = 0.05;

/** CSS px relative to the view area; NaN = not on screen. */
export type ScreenPoint = readonly [x: number, y: number];

/** A handle projected to the screen, in the order of ManipulatorPort.set. */
export type ScreenHandle =
  | {
      readonly kind: 'linear';
      readonly id: string;
      /** The projected position (start of the arrow). */
      readonly from: ScreenPoint;
      /** The projected tip, HANDLE_ARROW_PX along the direction. */
      readonly to: ScreenPoint;
    }
  | {
      readonly kind: 'angular';
      readonly id: string;
      /** HANDLE_RING_SEGMENTS points of a closed polyline (the last joins the first). */
      readonly points: readonly ScreenPoint[];
    };

/**
 * True when the arrow along `direction` points (nearly) at the viewer or away from them, so it
 * would collapse to a dot (|cos| > HANDLE_HIDE_COS). Both vectors need not be unit.
 */
export function arrowHidden(direction: Vec3, viewDirection: Vec3): boolean {
  const cos = vec3.dot(vec3.normalize(direction), vec3.normalize(viewDirection));
  return Math.abs(cos) > HANDLE_HIDE_COS;
}

/**
 * True when the ring around `axis` is seen (nearly) edge-on, so it would collapse to a line
 * (|cos| < HANDLE_RING_HIDE_COS). Both vectors need not be unit.
 */
export function ringHidden(axis: Vec3, viewDirection: Vec3): boolean {
  const cos = vec3.dot(vec3.normalize(axis), vec3.normalize(viewDirection));
  return Math.abs(cos) < HANDLE_RING_HIDE_COS;
}

/** True when the glyph of the view is hidden for this view direction (arrowHidden, ringHidden). */
export function handleHidden(view: HandleView, viewDirection: Vec3): boolean {
  return view.kind === 'linear'
    ? arrowHidden(view.direction, viewDirection)
    : ringHidden(view.axis, viewDirection);
}

/**
 * Box around every glyph in the world, for near/far (spec 09, "Near a far"): the anchor point of
 * each handle (position, center) grown on all sides by the glyph size, HANDLE_ARROW_PX or
 * HANDLE_RING_PX × worldPerPx. Hidden handles count too. No handles → null.
 */
export function handleBounds(
  handles: readonly HandleView[],
  worldPerPx: number,
): BoundingBox | null {
  let min: Vec3 | null = null;
  let max: Vec3 | null = null;
  for (const handle of handles) {
    const point = handle.kind === 'linear' ? handle.position : handle.center;
    const size = (handle.kind === 'linear' ? HANDLE_ARROW_PX : HANDLE_RING_PX) * worldPerPx;
    const low = vec3.sub(point, [size, size, size]);
    const high = vec3.add(point, [size, size, size]);
    min =
      min === null
        ? low
        : [Math.min(min[0], low[0]), Math.min(min[1], low[1]), Math.min(min[2], low[2])];
    max =
      max === null
        ? high
        : [Math.max(max[0], high[0]), Math.max(max[1], high[1]), Math.max(max[2], high[2])];
  }
  return min === null || max === null ? null : { min, max };
}

/**
 * Unit vectors u, v with u × v along the axis: the plane of a ring. Any such pair works, a ring
 * is symmetric; the world axis least aligned with `axis` seeds u.
 */
export function ringBasis(axis: Vec3): readonly [u: Vec3, v: Vec3] {
  const n = vec3.normalize(axis);
  const ax = Math.abs(n[0]);
  const ay = Math.abs(n[1]);
  const az = Math.abs(n[2]);
  const seed: Vec3 = ax <= ay && ax <= az ? [1, 0, 0] : ay <= az ? [0, 1, 0] : [0, 0, 1];
  const u = vec3.normalize(vec3.cross(seed, n));
  return [u, vec3.cross(n, u)];
}

/**
 * Projects handle views to the screen: the one place that knows the shape of a glyph, so drawing
 * (manipulator-layer.ts) and picking agree.
 *
 * - `project` maps a world point to CSS px of the view area (the viewport derives it from its
 *   camera); it may give NaN for a point off screen.
 * - `worldPerPx` = world units per CSS px of the orthographic camera; it turns the pixel sizes
 *   HANDLE_ARROW_PX and HANDLE_RING_PX into world lengths.
 * - `viewDirection` = the direction the camera looks in (any length); a glyph hidden by
 *   handleHidden (an arrow end-on, a ring edge-on) is left out.
 *
 * An arrow becomes the segment from `position` to its tip HANDLE_ARROW_PX px along `direction`, a
 * ring HANDLE_RING_SEGMENTS points HANDLE_RING_PX px around `center` in the plane perpendicular to
 * `axis`. The order of `handles` is kept (ties in pickHandle go to the earlier one).
 */
export function projectHandles(
  handles: readonly HandleView[],
  project: (p: Vec3) => ScreenPoint,
  worldPerPx: number,
  viewDirection: Vec3,
): readonly ScreenHandle[] {
  const result: ScreenHandle[] = [];
  for (const handle of handles) {
    if (handleHidden(handle, viewDirection)) continue;
    if (handle.kind === 'linear') {
      const length = HANDLE_ARROW_PX * worldPerPx;
      const tip = vec3.add(handle.position, vec3.scale(vec3.normalize(handle.direction), length));
      result.push({
        kind: 'linear',
        id: handle.id,
        from: project(handle.position),
        to: project(tip),
      });
    } else {
      const radius = HANDLE_RING_PX * worldPerPx;
      const [u, v] = ringBasis(handle.axis);
      const points = Array.from({ length: HANDLE_RING_SEGMENTS }, (_, i): ScreenPoint => {
        const angle = (2 * Math.PI * i) / HANDLE_RING_SEGMENTS;
        const offset = vec3.add(
          vec3.scale(u, radius * Math.cos(angle)),
          vec3.scale(v, radius * Math.sin(angle)),
        );
        return project(vec3.add(handle.center, offset));
      });
      result.push({ kind: 'angular', id: handle.id, points });
    }
  }
  return result;
}

/**
 * Id of the handle under (x, y) in CSS px: an arrow within HANDLE_PICK_PX of its segment, a ring
 * within HANDLE_RING_PICK_PX of its closed polyline. The smallest distance wins, the earlier
 * handle on a tie; nothing within tolerance → null. Segments with a NaN end are skipped.
 */
export function pickHandle(
  screenHandles: readonly ScreenHandle[],
  x: number,
  y: number,
): string | null {
  let best: { readonly id: string; readonly distance: number } | null = null;
  for (const handle of screenHandles) {
    const distance = distanceTo(handle, x, y);
    if (distance === null) continue;
    // Strictly nearer: on a tie the earlier handle stays.
    if (best === null || distance < best.distance) best = { id: handle.id, distance };
  }
  return best?.id ?? null;
}

/** Distance from (x, y) to the handle within its tolerance; null = farther or off screen. */
function distanceTo(handle: ScreenHandle, x: number, y: number): number | null {
  const segments =
    handle.kind === 'linear'
      ? new Float32Array([...handle.from, ...handle.to])
      : closedPolyline(handle.points);
  const tolerance = handle.kind === 'linear' ? HANDLE_PICK_PX : HANDLE_RING_PICK_PX;
  return closestSegments(segments, x, y, tolerance)[0]?.distancePx ?? null;
}

/** x0, y0, x1, y1 per edge of the closed polyline, the last point joined back to the first. */
function closedPolyline(points: readonly ScreenPoint[]): Float32Array {
  const segments = new Float32Array(points.length * 4);
  points.forEach((point, i) => {
    const next = points[(i + 1) % points.length] ?? point;
    segments.set([point[0], point[1], next[0], next[1]], 4 * i);
  });
  return segments;
}
