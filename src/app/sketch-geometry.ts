// The SketchGeometry port of the sketcher over the kernel (spec 12 "Geometrie skici v jádře (M30)",
// ADR 0028): app owns the kernel client, so it implements the port and hands it to the sketcher
// like the ConstraintSolver.

import type { SketchGeometry } from '@/sketch';

/**
 * Not implemented yet: M33 added the methods to the port, the implementation over
 * SketchOps.curveIntersections and curveSegment of the kernel follows in task 3 of M33. Until
 * then every call rejects, so the sketcher only gets no intersections (its error path).
 */
export function createSketchGeometry(): SketchGeometry {
  const notImplemented = (): Promise<never> =>
    Promise.reject(new Error('SketchGeometry: not implemented'));
  return Object.freeze({ intersections: notImplemented, segment: notImplemented });
}
