// Ring 1 – sketch data model, data checks, 2D geometry, regions, editing helpers and the
// ConstraintSolver port (spec 12, ADR 0017). Depends only on core.
// Public API of sketch. Everything else in this folder is internal.

export { GEOMETRIC_CONSTRAINT_KINDS, SKETCH_FEATURE_TYPE, SKETCH_PARAM } from './model';
export type {
  DimensionKind,
  GeometricConstraintKind,
  SketchArc,
  SketchCircle,
  SketchConstraint,
  SketchConstraintDraft,
  SketchConstraintId,
  SketchCurve,
  SketchData,
  SketchEntity,
  SketchEntityId,
  SketchItemId,
  SketchLine,
  SketchPoint,
} from './model';
export { parseSketchData } from './parse';
export type { SketchIssue } from './parse';
export { curve2, pointsById } from './geometry';
export type { Curve2 } from './geometry';
export { constraintFor, dimensionFor, measure, removeItems, toggleConstruction } from './edit';
export { computeRegions } from './regions';
export type { RegionsResult, SketchRegion } from './regions';
export type { ConstraintSolver, SolveInput, SolveResult, SolveStatus } from './solver';
