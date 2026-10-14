// Picking of sketch entities in screen space (spec 09, "Skici"): a point within the tolerance
// wins over every curve, otherwise the nearest segment. Pure, no three; the sketch layer projects
// the tessellated drawings into px and maps the hit back to the entity.

import { assert } from '@/core';
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
 * screenSegments: x0, y0, x1, y1 per segment in px; screenPoints: x, y per point in px. NaN
 * coordinates (off the view) are skipped. Ties go to the first in the input.
 */
export function pickSketch(
  screenSegments: Float32Array,
  screenPoints: Float32Array,
  x: number,
  y: number,
  tolerancePx = DEFAULT_TOLERANCE_PX,
): SketchHit | null {
  assert(screenPoints.length % 2 === 0, 'screenPoints must hold 2 numbers per point');
  let best: SketchHit | null = null;
  for (let i = 0; i < screenPoints.length; i += 2) {
    const px = screenPoints[i] ?? NaN;
    const py = screenPoints[i + 1] ?? NaN;
    // NaN fails both comparisons, so a point off the view never wins.
    const distancePx = Math.hypot(px - x, py - y);
    if (distancePx <= tolerancePx && (best === null || distancePx < best.distancePx)) {
      best = { kind: 'point', index: i / 2, distancePx };
    }
  }
  if (best !== null) return best;

  const nearest = closestSegments(screenSegments, x, y, tolerancePx)[0];
  if (nearest === undefined) return null;
  return { kind: 'segment', index: nearest.segment, t: nearest.t, distancePx: nearest.distancePx };
}

/** Across drawings: a point wins over a curve, then the smaller distance; a tie keeps `than`. */
export function betterSketchHit(hit: SketchHit, than: SketchHit): boolean {
  if (hit.kind !== than.kind) return hit.kind === 'point';
  return hit.distancePx < than.distancePx;
}
