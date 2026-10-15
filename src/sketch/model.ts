import type { Brand, Vec2 } from '@/core';

// The data model of a sketch (spec 12 "Data"). Plain immutable data stored in the params of a
// sketch feature; coordinates are already solved, so replaying the log never needs the solver.

export type SketchEntityId = Brand<string, 'SketchEntityId'>;
export type SketchConstraintId = Brand<string, 'SketchConstraintId'>;
/** What can be selected in the sketcher: an entity or a constraint. */
export type SketchItemId = SketchEntityId | SketchConstraintId;

export interface SketchPoint {
  readonly kind: 'point';
  readonly id: SketchEntityId;
  readonly x: number;
  readonly y: number;
}

export interface SketchLine {
  readonly kind: 'line';
  readonly id: SketchEntityId;
  readonly p1: SketchEntityId;
  readonly p2: SketchEntityId;
  readonly construction?: true;
}

export interface SketchCircle {
  readonly kind: 'circle';
  readonly id: SketchEntityId;
  readonly center: SketchEntityId;
  readonly radius: number;
  readonly construction?: true;
}

/** Counter-clockwise arc from start to end around center; radius = |start − center| = |end − center|. */
export interface SketchArc {
  readonly kind: 'arc';
  readonly id: SketchEntityId;
  readonly center: SketchEntityId;
  readonly start: SketchEntityId;
  readonly end: SketchEntityId;
  readonly construction?: true;
}

/** A spline through control points (NURBS without weights). Its ends = the first and last pole (clamped). */
export interface SketchBSpline {
  readonly kind: 'bspline';
  readonly id: SketchEntityId;
  /** = min(3, poles.length − 1). */
  readonly degree: 1 | 2 | 3;
  /** Sketch points, ≥ 2, distinct. */
  readonly poles: readonly SketchEntityId[];
  /** Clamped, non-decreasing, length poles + degree + 1, from 0 to 1. */
  readonly knots: readonly number[];
  readonly construction?: true;
}

/**
 * A spline through points: passes through the fit points; its poles are hidden solver variables
 * and their solved coordinates are stored in the data (regen never calls the solver).
 */
export interface SketchFitSpline {
  readonly kind: 'fitSpline';
  readonly id: SketchEntityId;
  /** = min(3, fit.length − 1). */
  readonly degree: 1 | 2 | 3;
  /** Sketch points, ≥ 2, distinct. */
  readonly fit: readonly SketchEntityId[];
  /** The parameter of each fit point, increasing, first 0, last 1. */
  readonly params: readonly number[];
  /** Solved control points, length = fit.length. */
  readonly poles: readonly Vec2[];
  /** Clamped, length poles + degree + 1. */
  readonly knots: readonly number[];
  readonly construction?: true;
}

export type SketchCurve = SketchLine | SketchCircle | SketchArc | SketchBSpline | SketchFitSpline;
export type SketchEntity = SketchPoint | SketchCurve;

export type GeometricConstraintKind =
  | 'coincident'
  | 'horizontal'
  | 'vertical'
  | 'parallel'
  | 'perpendicular'
  | 'equal'
  | 'tangent'
  | 'fix';

/** In this order: the order of the constraint actions in the toolbar. */
export const GEOMETRIC_CONSTRAINT_KINDS: readonly GeometricConstraintKind[] = Object.freeze([
  'coincident',
  'horizontal',
  'vertical',
  'parallel',
  'perpendicular',
  'equal',
  'tangent',
  'fix',
]);

export type DimensionKind = 'distance' | 'radius';

export type SketchConstraint =
  /** Two points. */
  | {
      readonly kind: 'coincident';
      readonly id: SketchConstraintId;
      readonly a: SketchEntityId;
      readonly b: SketchEntityId;
    }
  | {
      readonly kind: 'horizontal' | 'vertical';
      readonly id: SketchConstraintId;
      readonly line: SketchEntityId;
    }
  /** Two lines. */
  | {
      readonly kind: 'parallel' | 'perpendicular';
      readonly id: SketchConstraintId;
      readonly a: SketchEntityId;
      readonly b: SketchEntityId;
    }
  /** Two lines (length) or two circles/arcs (radius). */
  | {
      readonly kind: 'equal';
      readonly id: SketchConstraintId;
      readonly a: SketchEntityId;
      readonly b: SketchEntityId;
    }
  /**
   * A line and a circle/arc (either order), or two circles/arcs; or a line and a spline (either
   * order) when the line shares a point with an end of the spline (M29).
   */
  | {
      readonly kind: 'tangent';
      readonly id: SketchConstraintId;
      readonly a: SketchEntityId;
      readonly b: SketchEntityId;
    }
  /** The point stays at its coordinates. */
  | { readonly kind: 'fix'; readonly id: SketchConstraintId; readonly point: SketchEntityId }
  /** Two points, value > 0. */
  | {
      readonly kind: 'distance';
      readonly id: SketchConstraintId;
      readonly a: SketchEntityId;
      readonly b: SketchEntityId;
      readonly value: number;
    }
  /** A circle or an arc, value > 0. */
  | {
      readonly kind: 'radius';
      readonly id: SketchConstraintId;
      readonly curve: SketchEntityId;
      readonly value: number;
    };

export interface SketchData {
  readonly entities: readonly SketchEntity[];
  readonly constraints: readonly SketchConstraint[];
}

/** Omit that keeps a union a union (plain Omit would merge its members into one object type). */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** A constraint before it gets its id (ids are generated before the operation, spec 12). */
export type SketchConstraintDraft = DistributiveOmit<SketchConstraint, 'id'>;

/** The feature type of a sketch: the only link of interaction and regen to the sketch plugin. */
export const SKETCH_FEATURE_TYPE = 'sketch';

/**
 * The names of the params of the sketch feature (spec 12, "Featura skici"). The params type itself
 * lives with the plugin (PlaneRef and TopoRef come from document, ADR 0017); its schema checks by
 * type that its keys are exactly these names, interaction reads the params only through them.
 */
export const SKETCH_PARAM = Object.freeze({
  plane: 'plane',
  entities: 'entities',
  constraints: 'constraints',
} as const);
