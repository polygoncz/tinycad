// Ring 1 – sketch data model, data checks, 2D geometry, the curves bounding regions, editing
// helpers and the ConstraintSolver, SketchGeometry and TextOutliner ports (spec 12, ADR 0017).
// Depends only on core.
// Public API of sketch. Everything else in this folder is internal.

export { GEOMETRIC_CONSTRAINT_KINDS, SKETCH_FEATURE_TYPE, SKETCH_PARAM } from './model';
export { DIMENSION_KINDS, isDimension, isLineCarrier } from './model';
export { MAX_TEXT_LENGTH, TEXT_FONTS, textParamsValid } from './model';
export {
  MAX_PATTERN_COUNT,
  circularStep,
  isPattern,
  isPatternSource,
  patternParamsValid,
} from './model';
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
  SketchText,
  SketchXLine,
  TextContour,
  TextFontId,
  TextSegment,
} from './model';
export { patternCopies, patternOfCopy } from './patterns';
export { parseSketchData } from './parse';
export type { SketchIssue } from './parse';
export { XLINE_EXTENT, curve2, regionCurves } from './geometry';
export { pointsById } from './points';
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
  arcSlotFrom,
  arcSlotShape,
  circleFrom2,
  circleFrom3,
  endTangent,
  rectangle3Shape,
  rectangleCenterShape,
  rectangleFrom3,
  rectangleFromCenter,
  slotFromCenters,
  slotFromEnds,
  slotOverallShape,
  slotShape,
  tangentArcFrom,
  tangentCircle,
} from './construct';
export type {
  ArcFit,
  ArcSlotFit,
  ArcSlotPointIds,
  CircleFit,
  RectCornerIds,
  RectCorners,
  ShapeDraft,
  ShapeIds,
  SlotFit,
  SlotOverallPointIds,
  SlotPointIds,
} from './construct';
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
export type { SketchGeometry } from './geometry-port';
export { derivedOwner, textCurves } from './text';
export type { TextOutliner } from './text';
