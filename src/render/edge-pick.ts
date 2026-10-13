// Edge picking in screen space (spec 09, "Picking", point 2): which projected segments lie
// within a pixel tolerance of the cursor. Pure, no three import.

import { assert } from '@/core';

export interface SegmentCandidate {
  /** Index of the segment in the input (offset / 4). */
  readonly segment: number;
  /** Parameter of the closest point on the segment, 0 = start, 1 = end. */
  readonly t: number;
  readonly distancePx: number;
}

/**
 * Segments within tolerancePx of (x, y), sorted by distance ascending (stable for ties).
 * screenSegments holds x0, y0, x1, y1 per segment in px. A segment with a NaN coordinate
 * (e.g. clipped out of the view by the caller) is skipped; a zero-length segment is a point.
 */
export function closestSegments(
  screenSegments: Float32Array,
  x: number,
  y: number,
  tolerancePx: number,
): readonly SegmentCandidate[] {
  assert(screenSegments.length % 4 === 0, 'screenSegments must hold 4 numbers per segment');
  const candidates: SegmentCandidate[] = [];
  for (let i = 0; i < screenSegments.length; i += 4) {
    const x0 = screenSegments[i] ?? NaN;
    const y0 = screenSegments[i + 1] ?? NaN;
    const x1 = screenSegments[i + 2] ?? NaN;
    const y1 = screenSegments[i + 3] ?? NaN;
    if (Number.isNaN(x0 + y0 + x1 + y1)) continue;

    const dx = x1 - x0;
    const dy = y1 - y0;
    const lengthSq = dx * dx + dy * dy;
    const t =
      lengthSq === 0 ? 0 : Math.min(1, Math.max(0, ((x - x0) * dx + (y - y0) * dy) / lengthSq));
    const distancePx = Math.hypot(x0 + t * dx - x, y0 + t * dy - y);
    if (distancePx <= tolerancePx) candidates.push({ segment: i / 4, t, distancePx });
  }
  return candidates.sort((a, b) => a.distancePx - b.distancePx);
}
