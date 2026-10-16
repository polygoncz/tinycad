// The geometry port of the sketcher (spec 12 "Geometrie skici v jádře (M30)", ADR 0028, Q092):
// geometry of the sketch the kernel computes for the sketcher tools. app implements it over the
// kernel client and hands it to the sketcher next to the ConstraintSolver.

/**
 * Without methods in M30: only the port and its wiring exist, so M33 (intersections) and M35
 * (offset) add methods without changing the composition root.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- a named port that M33 and M35 extend, not an alias of {}
export interface SketchGeometry {}
