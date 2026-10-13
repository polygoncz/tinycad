import type { BoundingBox } from '@/kernel';

// Bounding boxes of the shown bodies for CameraController.fitAll (spec 09, "Kamera"). Pure, no
// three import, so they are tested in Node.

/** Axis-aligned box of the vertices (xyz triples); null without vertices. */
export function meshBounds(positions: Float32Array): BoundingBox | null {
  if (positions.length < 3) return null;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i + 2 < positions.length; i += 3) {
    for (let axis = 0; axis < 3; axis++) {
      const value = positions[i + axis] ?? 0;
      min[axis] = Math.min(min[axis] ?? value, value);
      max[axis] = Math.max(max[axis] ?? value, value);
    }
  }
  return toBox(min, max);
}

/** Box around all boxes, skipping null ones (bodies without vertices); null when none is left. */
export function unionBounds(boxes: Iterable<BoundingBox | null>): BoundingBox | null {
  let result: BoundingBox | null = null;
  for (const box of boxes) {
    if (box === null) continue;
    result =
      result === null
        ? box
        : toBox(
            result.min.map((v, axis) => Math.min(v, box.min[axis] ?? v)),
            result.max.map((v, axis) => Math.max(v, box.max[axis] ?? v)),
          );
  }
  return result;
}

function toBox(min: readonly number[], max: readonly number[]): BoundingBox {
  return {
    min: [min[0] ?? 0, min[1] ?? 0, min[2] ?? 0],
    max: [max[0] ?? 0, max[1] ?? 0, max[2] ?? 0],
  };
}
