import type { SketchData, SketchEntityId, SketchPoint } from './model';

// The points of a sketch by id; on its own so that geometry, edit and patterns share it without
// a circular import (geometry adds the copies of patterns to the region curves).

export function pointsById(data: SketchData): ReadonlyMap<SketchEntityId, SketchPoint> {
  const points = new Map<SketchEntityId, SketchPoint>();
  for (const e of data.entities) if (e.kind === 'point') points.set(e.id, e);
  return points;
}
