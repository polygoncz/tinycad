import { assert, type Vec3 } from '@/core';
import type { OverlayShape } from '@/interaction';

// Pure helpers of OverlayLayer (spec 09, "Vrstvy pro interakci"). No three import, so they are
// tested in Node.

/**
 * Checks the shapes before OverlayLayer.set changes anything: `lines` are pairs of points
 * (segments), so an odd number of points is a bug of the caller and throws.
 */
export function validateOverlayShapes(shapes: readonly OverlayShape[]): void {
  for (const shape of shapes) {
    if (shape.kind === 'lines') {
      assert(
        shape.points.length % 2 === 0,
        `Overlay lines need an even number of points (pairs), got ${String(shape.points.length)}`,
      );
    }
  }
}

/** Points → xyz triples for a position attribute. */
export function flattenPoints(points: readonly Vec3[]): Float32Array<ArrayBuffer> {
  const positions = new Float32Array(points.length * 3);
  points.forEach((point, i) => {
    positions.set(point, 3 * i);
  });
  return positions;
}
