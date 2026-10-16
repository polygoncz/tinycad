// Ring 1 – sketch data model, data checks, 2D geometry, the curves bounding regions, editing
// helpers, the parameter of curves and trim/extend/split (M33) and the ConstraintSolver and
// SketchGeometry ports (spec 12, ADR 0017). Depends only on core.
// Public API of sketch. Everything else in this folder is internal.

export { GEOMETRIC_CONSTRAINT_KINDS, SKETCH_FEATURE_TYPE, SKETCH_PARAM } from './model';
export { DIMENSION_KINDS, isDimension } from './model';
export type {
  AngularPlacement,
  DimensionConstraint,
  DimensionKind,
  DimensionPlacement,
  GeometricConstraintKind,
  LinearPlacement,
  RadialPlacement,
  SketchArc,
  SketchBSpline,
  SketchCircle,
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
  SketchPoint,
} from './model';
export { parseSketchData } from './parse';
export type { SketchIssue } from './parse';
export { curve2, pointsById, regionCurves } from './geometry';
export type { Curve2, SketchRegion } from './geometry';
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
export { SPLINE_TOLERANCE } from './geometry';
export type { ConstraintSolver, SolveInput, SolveResult, SolveStatus } from './solver';
export type { CurveHit, SketchGeometry } from './geometry-port';
export { nearestParam, paramRange, piecePolyline, pointAt, samePoint } from './curve-param';
export { crossingPoints, cutsOf, extendEdit, pieceAt, splitEdit, trimEdit } from './trim';
export type {
  CurveCut,
  CurvePiece,
  ExtendRequest,
  IdSource,
  SketchEdit,
  SplitRequest,
  TrimRequest,
} from './trim';
