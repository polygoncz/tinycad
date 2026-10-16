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

/**
 * A construction line without ends through two sketch points (Onshape Construction line, M31).
 * Always construction: it never bounds a region. Constraints that take a line as its carrier line
 * take it too; those that need a length or ends do not.
 */
export interface SketchXLine {
  readonly kind: 'xline';
  readonly id: SketchEntityId;
  /** Two distinct points; they give the position and the direction. */
  readonly p1: SketchEntityId;
  readonly p2: SketchEntityId;
  readonly construction: true;
}

export type SketchCurve =
  SketchLine | SketchCircle | SketchArc | SketchBSpline | SketchFitSpline | SketchXLine;
export type SketchEntity = SketchPoint | SketchCurve;

export type GeometricConstraintKind =
  | 'coincident'
  | 'horizontal'
  | 'vertical'
  | 'parallel'
  | 'perpendicular'
  | 'equal'
  | 'tangent'
  | 'midpoint'
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
  'midpoint',
  'fix',
]);

export type DimensionKind =
  'distance' | 'hDistance' | 'vDistance' | 'pointLineDistance' | 'angle' | 'radius' | 'diameter';
export const DIMENSION_KINDS: readonly DimensionKind[] = Object.freeze([
  'distance',
  'hDistance',
  'vDistance',
  'pointLineDistance',
  'angle',
  'radius',
  'diameter',
]);

export function isDimensionKind(kind: string): kind is DimensionKind {
  return (DIMENSION_KINDS as readonly string[]).includes(kind);
}

/**
 * A dimension (a constraint or a draft with a value) by its kind, not by its shape: a later
 * constraint with a `value` field is not a dimension by accident.
 */
export function isDimension<C extends { readonly kind: string }>(
  c: C,
): c is Extract<C, { readonly kind: DimensionKind }> {
  return isDimensionKind(c.kind);
}

/**
 * Linear dimension: the dimension line parallel to the measured direction at `offset` (mm, signed:
 * positive = left of the direction a→b; for hDistance up, for vDistance left), the label moved by
 * `along` (mm) from the middle.
 */
export interface LinearPlacement {
  readonly kind: 'linear';
  readonly offset: number;
  readonly along: number;
}

/** Radius/diameter: the label in direction `angle` (rad, from the plane x axis) from the centre, `distance` (mm) away. */
export interface RadialPlacement {
  readonly kind: 'radial';
  readonly angle: number;
  readonly distance: number;
}

/** Angle: the dimension arc of `radius` (mm) around the intersection of the lines, the label at fraction t ∈ [0, 1] of the arc. */
export interface AngularPlacement {
  readonly kind: 'angular';
  readonly radius: number;
  readonly t: number;
}

/** Where a dimension is drawn (spec 12 "Kóty (M28)"); only display data, the solver ignores it. */
export type DimensionPlacement = LinearPlacement | RadialPlacement | AngularPlacement;

export type SketchConstraint =
  /** Two points. */
  | {
      readonly kind: 'coincident';
      readonly id: SketchConstraintId;
      readonly a: SketchEntityId;
      readonly b: SketchEntityId;
    }
  /** A line or an xline (M31). */
  | {
      readonly kind: 'horizontal' | 'vertical';
      readonly id: SketchConstraintId;
      readonly line: SketchEntityId;
    }
  /** Two lines or xlines (M31). */
  | {
      readonly kind: 'parallel' | 'perpendicular';
      readonly id: SketchConstraintId;
      readonly a: SketchEntityId;
      readonly b: SketchEntityId;
    }
  /** Two lines (length) or two circles/arcs (radius); never an xline. */
  | {
      readonly kind: 'equal';
      readonly id: SketchConstraintId;
      readonly a: SketchEntityId;
      readonly b: SketchEntityId;
    }
  /**
   * A line or an xline and a circle/arc (either order), or two circles/arcs; or a line (not an
   * xline) and a spline (either order) when the line shares a point with an end of the spline (M29).
   */
  | {
      readonly kind: 'tangent';
      readonly id: SketchConstraintId;
      readonly a: SketchEntityId;
      readonly b: SketchEntityId;
    }
  /**
   * A point on the whole carrier line of a line or an xline or the whole circle of an arc (M26),
   * or on a spline within its ends (M29); the point is not a defining point of the curve.
   */
  | {
      readonly kind: 'pointOnCurve';
      readonly id: SketchConstraintId;
      readonly point: SketchEntityId;
      readonly curve: SketchEntityId;
    }
  /** A point in the middle of a line (not an xline), not one of its ends (M26). */
  | {
      readonly kind: 'midpoint';
      readonly id: SketchConstraintId;
      readonly point: SketchEntityId;
      readonly line: SketchEntityId;
    }
  /** Two points with the same y (hAlign) or x (vAlign) (M26). */
  | {
      readonly kind: 'hAlign' | 'vAlign';
      readonly id: SketchConstraintId;
      readonly a: SketchEntityId;
      readonly b: SketchEntityId;
    }
  /** The point stays at its coordinates. */
  | { readonly kind: 'fix'; readonly id: SketchConstraintId; readonly point: SketchEntityId }
  /** Two points, value > 0: aligned, |b.x − a.x| or |b.y − a.y|. */
  | {
      readonly kind: 'distance' | 'hDistance' | 'vDistance';
      readonly id: SketchConstraintId;
      readonly a: SketchEntityId;
      readonly b: SketchEntityId;
      readonly value: number;
      readonly placement?: LinearPlacement;
    }
  /**
   * A point and a line or an xline it is not a point of: the distance to the infinite line,
   * value > 0.
   */
  | {
      readonly kind: 'pointLineDistance';
      readonly id: SketchConstraintId;
      readonly point: SketchEntityId;
      readonly line: SketchEntityId;
      readonly value: number;
      readonly placement?: LinearPlacement;
    }
  /**
   * Two different lines or xlines, 0 < value < π (rad): the angle between their directions p1→p2,
   * each reversed by its flag.
   */
  | {
      readonly kind: 'angle';
      readonly id: SketchConstraintId;
      readonly a: SketchEntityId;
      readonly b: SketchEntityId;
      readonly value: number;
      readonly reverseA?: true;
      readonly reverseB?: true;
      readonly placement?: AngularPlacement;
    }
  /** A circle or an arc, value > 0 (the radius, or the diameter = 2 · radius). */
  | {
      readonly kind: 'radius' | 'diameter';
      readonly id: SketchConstraintId;
      readonly curve: SketchEntityId;
      readonly value: number;
      readonly placement?: RadialPlacement;
    };

/** A dimension: a constraint with a value. */
export type DimensionConstraint = Extract<SketchConstraint, { kind: DimensionKind }>;

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
