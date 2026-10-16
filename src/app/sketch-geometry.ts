// The SketchGeometry port of the sketcher over the kernel (spec 12 "Geometrie skici v jádře (M30)",
// ADR 0028): app owns the kernel client, so it implements the port and hands it to the sketcher
// like the ConstraintSolver.

import type { SketchGeometry } from '@/sketch';

/**
 * Empty in M30: the port has no methods yet. M33 (intersections) and M35 (offset) add them here
 * over the live kernel of the supervisor; the composition root already hands the port on.
 */
export function createSketchGeometry(): SketchGeometry {
  return Object.freeze({});
}
