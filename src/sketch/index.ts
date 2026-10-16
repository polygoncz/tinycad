// Ring 1 – sketch data model, data checks, 2D geometry, regions, editing helpers and the
// ConstraintSolver port (spec 12, ADR 0017). Depends only on core.
// Public API of sketch. Everything else in this folder is internal.

export { GEOMETRIC_CONSTRAINT_KINDS, SKETCH_FEATURE_TYPE, SKETCH_PARAM } from './model';
export { DIMENSION_KINDS, isDimension } from './model';
export { MAX_PATTERN_COUNT, isPattern } from './model';
export type {
  AngularPlacement,
  DimensionConstraint,
  DimensionKind,
  DimensionPlacement,
  GeometricConstraintKind,
  LinearPlacement,
  PatternDirection,
  RadialPlacement,
  SketchArc,
  SketchBSpline,
  SketchCircle,
  SketchCircularPattern,
  SketchConstraint,
  SketchConstraintDraft,
  SketchConstraintId,
  SketchCurve,
  SketchData,
  SketchEntity,
  SketchEntityId,
  SketchFitSpline,
  SketchItemId,
  SketchLine,
  SketchLinearPattern,
  SketchMirror,
  SketchPattern,
  SketchPoint,
} from './model';
export { patternCopies, patternOfCopy } from './patterns';
export { parseSketchData } from './parse';
export type { SketchIssue } from './parse';
export { curve2, pointsById } from './geometry';
export type { Curve2 } from './geometry';
export {
  constraintFor,
  constraintTargets,
  curvePoints,
  dimensionFor,
  measure,
  removeItems,
  toggleConstruction,
} from './edit';
export { ORIGIN_SNAP, snap } from './snap';
export type { PointInference, SnapGuide, SnapKind, SnapOptions, SnapResult } from './snap';
export { inferLine, inferRadius } from './infer';
export {
  arcFrom3,
  circleFrom2,
  circleFrom3,
  endTangent,
  tangentArcFrom,
  tangentCircle,
} from './construct';
export type { ArcFit, CircleFit } from './construct';
export type { LineInference } from './infer';
export {
  defaultPlacement,
  dimensionTarget,
  movePlacement,
  placeDimension,
} from './dimension-placement';
export type { DimensionTarget } from './dimension-placement';
export { SPLINE_TOLERANCE, computeRegions } from './regions';
export type { RegionsResult, SketchRegion } from './regions';
export type { ConstraintSolver, SolveInput, SolveResult, SolveStatus } from './solver';
