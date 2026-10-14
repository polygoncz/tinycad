// Picking of sketch entities in screen space (spec 09, "Skici"): a point within the tolerance
// wins over every curve, otherwise the nearest segment. Pure, no three; the sketch layer projects
// the tessellated drawings into px, skips hits hidden behind bodies (M19.2) and maps the hit back
// to the entity. Regions (M13) are picked in the plane of the drawing instead: ray ∩ plane, then
// point in polygon.

import { assert, plane as planeMath, vec3, type Vec2, type Vec3 } from '@/core';
import type { SketchDrawing, SketchDrawingRegion } from '@/interaction';
import { closestSegments } from './edge-pick';

/** Sketch pick tolerance in CSS px, as for edges (spec 09, "Picking" point 2). */
const DEFAULT_TOLERANCE_PX = 6;

export type SketchHit =
  /** index = index of the point in the input (offset / 2). */
  | { readonly kind: 'point'; readonly index: number; readonly distancePx: number }
  /** index = index of the segment (offset / 4); t = parameter of the closest point on it. */
  | {
      readonly kind: 'segment';
      readonly index: number;
      readonly t: number;
      readonly distancePx: number;
    };

/**
 * Every sketch hit within the tolerance of (x, y): the points by distance, then the segments by
 * distance (spec 09, "Skici"); the sketch layer takes the first one that bodies do not hide.
 * screenSegments: x0, y0, x1, y1 per segment in px; screenPoints: x, y per point in px. NaN
 * coordinates (off the view) are skipped. Ties keep the order of the input.
 */
export function sketchHits(
  screenSegments: Float32Array,
  screenPoints: Float32Array,
  x: number,
  y: number,
  tolerancePx = DEFAULT_TOLERANCE_PX,
): readonly SketchHit[] {
  assert(screenPoints.length % 2 === 0, 'screenPoints must hold 2 numbers per point');
  const points: SketchHit[] = [];
  for (let i = 0; i < screenPoints.length; i += 2) {
    const px = screenPoints[i] ?? NaN;
    const py = screenPoints[i + 1] ?? NaN;
    // NaN fails the comparison, so a point off the view never counts.
    const distancePx = Math.hypot(px - x, py - y);
    if (distancePx <= tolerancePx) points.push({ kind: 'point', index: i / 2, distancePx });
  }
  // Array.prototype.sort is stable: equal distances keep the order of the input.
  points.sort((a, b) => a.distancePx - b.distancePx);
  const segments = closestSegments(screenSegments, x, y, tolerancePx).map((c): SketchHit => ({
    kind: 'segment',
    index: c.segment,
    t: c.t,
    distancePx: c.distancePx,
  }));
  return [...points, ...segments];
}

/** The first of sketchHits: a point within the tolerance wins over every curve; null = no hit. */
export function pickSketch(
  screenSegments: Float32Array,
  screenPoints: Float32Array,
  x: number,
  y: number,
  tolerancePx = DEFAULT_TOLERANCE_PX,
): SketchHit | null {
  return sketchHits(screenSegments, screenPoints, x, y, tolerancePx)[0] ?? null;
}

/** Across drawings: a point wins over a curve, then the smaller distance; a tie keeps `than`. */
export function betterSketchHit(hit: SketchHit, than: SketchHit): boolean {
  if (hit.kind !== than.kind) return hit.kind === 'point';
  return hit.distancePx < than.distancePx;
}

/**
 * Nearest region under the ray; null = none. Drawings without regions are skipped. A region whose
 * hit `accept` refuses (the sketch layer: hidden behind a body, M19.2) is skipped and the search
 * goes on along the ray; without `accept` every hit counts.
 */
export function pickSketchRegion(
  drawings: ReadonlyMap<string, SketchDrawing>,
  ray: { readonly origin: Vec3; readonly direction: Vec3 },
  accept: (sketch: string, point: Vec3) => boolean = () => true,
): { readonly sketch: string; readonly region: string; readonly point: Vec3 } | null {
  let best: {
    readonly sketch: string;
    readonly region: string;
    readonly point: Vec3;
    readonly t: number;
  } | null = null;
  for (const [sketch, drawing] of drawings) {
    const regions = drawing.regions ?? [];
    if (regions.length === 0) continue;
    const point = planeMath.intersectRay(drawing.plane, ray);
    if (point === null) continue;
    // Position along the ray; the scale of the direction is the same for every drawing.
    const t = vec3.dot(vec3.sub(point, ray.origin), ray.direction);
    if (best !== null && t >= best.t) continue;
    const local = planeMath.toLocal(drawing.plane, point);
    const region = regions.find((r) => pointInRegion(local, r));
    if (region !== undefined && accept(sketch, point)) {
      best = { sketch, region: region.id, point, t };
    }
  }
  return best === null ? null : { sketch: best.sketch, region: best.region, point: best.point };
}

/** Even–odd rule over the outer polygon and the holes together. */
export function pointInRegion(p: Vec2, region: SketchDrawingRegion): boolean {
  let inside = crossesOdd(p, region.outer);
  for (const hole of region.holes) if (crossesOdd(p, hole)) inside = !inside;
  return inside;
}

/** True when a ray from p towards +x crosses the closed polygon an odd number of times. */
function crossesOdd(p: Vec2, polygon: readonly Vec2[]): boolean {
  const [x, y] = p;
  let odd = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (a === undefined || b === undefined) continue;
    // Half-open in y, so a vertex exactly at height y counts once.
    if (a[1] > y !== b[1] > y) {
      const xCross = a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]);
      if (x < xCross) odd = !odd;
    }
  }
  return odd;
}
