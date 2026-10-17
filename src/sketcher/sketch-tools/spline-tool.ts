// The spline tools (spec 12, "Spliny (M29)", "Nástroje"): sketch.spline (a bspline through its
// control points) and sketch.fitSpline (a spline through its points), one tool of a kind. Every
// click places a point through the snapper; the points wait in the tool (pending, snapped to like
// the data) and the end writes them, their inferred constraints and the spline in one
// addGeometry. Enter or a click on its own last point ends the spline (the port has no double
// click); a click on its own first point with at least three points closes it by a new last point
// on the first one with a required coincident. The click and the preview of a move share one step
// (splineStep), so the preview shows exactly what the click does.

import { bspline, vec2 } from '@/core';
import type { BSplineShape, Vec2 } from '@/core';
import { SPLINE_TOLERANCE } from '@/sketch';
import type { SketchConstraint, SketchData, SketchEntity } from '@/sketch';
import { isPlainEscape } from '@/interaction';
import type { Tool, ToolContext, ViewKeyEvent } from '@/interaction';
import type { SketchEditor } from '../sketch-editor';
import type { SketchSession } from '../sketch-session';
import {
  addDrawn,
  clearPreview,
  clickTool,
  MIN_LENGTH,
  newConstraintId,
  newEntityId,
  previewInference,
  previewPairs,
  snapMode,
} from './common';
import { freeTarget, placePoint, snapAt, snapToleranceAt } from './snap';
import type { PlacedPoint, SnapTarget } from './snap';

/** The entity kind the tool draws. */
export type SplineToolKind = 'bspline' | 'fitSpline';

/**
 * What a click at a target does: nothing, add a point, end the spline, or close it on its first
 * point.
 */
type SplineStep =
  | { readonly kind: 'none' }
  | { readonly kind: 'add'; readonly target: SnapTarget }
  | { readonly kind: 'end' }
  | { readonly kind: 'close' };

const NONE: SplineStep = { kind: 'none' };
const END: SplineStep = { kind: 'end' };
const CLOSE: SplineStep = { kind: 'close' };

/** A spline closes on its first point only with at least this many points before. */
const MIN_CLOSE_POINTS = 3;

export function createSplineTool(sketches: SketchEditor, kind: SplineToolKind): Tool {
  /** The placed points in order; empty = no spline in progress. */
  let placed: readonly PlacedPoint[] = [];

  /** Ends the spline in progress: writes it when it has two points or more (`close` = closed). */
  function end(ctx: ToolContext, session: SketchSession, close: boolean): void {
    const points = placed;
    placed = [];
    clearPreview(ctx);
    if (points.length < 2) return;
    write(ctx, session, kind, points, close);
  }

  return clickTool(sketches, {
    reset() {
      placed = [];
    },
    onMove(ctx, session, x, y, mods) {
      const mode = snapMode(sketches, mods);
      const target = snapAt(ctx, session, x, y, { ...mode, pending: pendingOf(placed) });
      const tolerance = snapToleranceAt(ctx, session, x, y);
      if (target === null || tolerance === null) return;
      const step = splineStep(kind, placed, target, tolerance);
      const inferred = step.kind === 'add' ? step.target.inferred : [];
      previewInference(session, target.at, inferred, target.guides);
      previewSpline(ctx, session, kind, stepPoints(placed, step));
    },
    onClick(ctx, session, x, y, mods) {
      const mode = snapMode(sketches, mods);
      const target = snapAt(ctx, session, x, y, { ...mode, pending: pendingOf(placed) });
      const tolerance = snapToleranceAt(ctx, session, x, y);
      if (target === null || tolerance === null) return;
      const step = splineStep(kind, placed, target, tolerance);
      switch (step.kind) {
        case 'none':
          return;
        case 'add':
          placed = [...placed, placePoint(ctx, step.target)];
          return;
        case 'end':
          end(ctx, session, false);
          return;
        case 'close':
          end(ctx, session, true);
          return;
      }
    },
    onKey(ctx, session, e) {
      if (placed.length === 0) return false;
      if (isPlainEscape(e)) {
        // Cancels the whole spline; the tool stays (a second Escape ends it).
        placed = [];
        clearPreview(ctx);
        return true;
      }
      if (!isPlainEnter(e)) return false;
      end(ctx, session, false);
      return true;
    },
  });
}

/** Enter without modifiers outside a text field: ends the spline in progress. */
function isPlainEnter(e: ViewKeyEvent): boolean {
  return e.key === 'Enter' && !e.mods.shift && !e.mods.alt && !e.mods.mod && !e.inTextField;
}

/** The new points of the placed ones, which the snapper sees like the data. */
function pendingOf(placed: readonly PlacedPoint[]): readonly SketchEntity[] {
  return placed.flatMap((p) => p.entities);
}

/**
 * The step of a click at `target` after the placed points; `tolerance` = the snap tolerance in
 * mm at the cursor. Pure, so the preview of a move can call it too.
 */
function splineStep(
  kind: SplineToolKind,
  placed: readonly PlacedPoint[],
  target: SnapTarget,
  tolerance: number,
): SplineStep {
  const first = placed[0];
  const last = placed.at(-1);
  if (first === undefined || last === undefined) return { kind: 'add', target };
  if (target.point === last.id) return END;
  if (target.point === first.id) {
    if (placed.length < MIN_CLOSE_POINTS) return NONE;
    // The closing point lies on the first one: a fit spline cannot have it on the last as well.
    return kind === 'fitSpline' && vec2.dist(first.at, last.at) <= MIN_LENGTH ? NONE : CLOSE;
  }
  if (vec2.dist(target.at, last.at) <= tolerance) return END;
  // The points of a spline are distinct.
  if (placed.some((p) => p.id === target.point)) return NONE;
  return { kind: 'add', target };
}

/** The points of the curve of the step: the placed ones and the added or closing one. */
function stepPoints(placed: readonly PlacedPoint[], step: SplineStep): readonly Vec2[] {
  const at = placed.map((p) => p.at);
  switch (step.kind) {
    case 'add':
      return [...at, step.target.at];
    case 'close':
      return placed[0] === undefined ? at : [...at, placed[0].at];
    case 'none':
    case 'end':
      return at;
  }
}

/** = min(3, n − 1) for n ≥ 2 points (spec 12). */
function degreeOf(n: number): 1 | 2 | 3 {
  if (n >= 4) return 3;
  return n === 3 ? 2 : 1;
}

/** Clamped uniform knots of n poles: the inner knots j / (n − degree), j = 1 … n − degree − 1. */
function uniformKnots(n: number, degree: number): number[] {
  const inner = Array.from({ length: n - degree - 1 }, (_, i) => (i + 1) / (n - degree));
  return [...Array<number>(degree + 1).fill(0), ...inner, ...Array<number>(degree + 1).fill(1)];
}

/** The curve of the kind through (fitSpline) or over (bspline) at least two points. */
function shapeOf(kind: SplineToolKind, points: readonly Vec2[]): BSplineShape {
  if (kind === 'fitSpline') return bspline.interpolate(points);
  const degree = degreeOf(points.length);
  return { degree, poles: points, knots: uniformKnots(points.length, degree) };
}

/**
 * The preview of the curve (tessellated at SPLINE_TOLERANCE like the drawing) and, of a bspline,
 * its control polygon; fewer than two points have none.
 */
function previewSpline(
  ctx: ToolContext,
  session: SketchSession,
  kind: SplineToolKind,
  points: readonly Vec2[],
): void {
  if (points.length < 2) {
    clearPreview(ctx);
    return;
  }
  const size = Math.max(1, ...points.flatMap(([x, y]) => [Math.abs(x), Math.abs(y)]));
  const curve = bspline.tessellate(shapeOf(kind, points), SPLINE_TOLERANCE * size);
  const polygon = kind === 'bspline' ? chainPairs(points) : [];
  previewPairs(ctx, session, [...chainPairs(curve), ...polygon]);
}

/** Segments between consecutive points as pairs. */
function chainPairs(points: readonly Vec2[]): readonly Vec2[] {
  return points.slice(1).flatMap((p, i) => {
    const prev = points[i];
    return prev === undefined ? [] : [prev, p];
  });
}

/**
 * Writes the spline of the points (two or more) with their new points and inferred constraints
 * (automatic). `close` adds a new last point on the first one with a required coincident.
 */
function write(
  ctx: ToolContext,
  session: SketchSession,
  kind: SplineToolKind,
  placed: readonly PlacedPoint[],
  close: boolean,
): void {
  const first = placed[0];
  const closing = close && first !== undefined ? placePoint(ctx, freeTarget(first.at)) : null;
  const points = closing === null ? placed : [...placed, closing];
  const coincident: SketchConstraint | null =
    closing === null || first === undefined
      ? null
      : { kind: 'coincident', id: newConstraintId(ctx), a: closing.id, b: first.id };
  const spline = splineEntity(ctx, kind, points);
  const add: SketchData = {
    entities: [...points.flatMap((p) => p.entities), spline],
    constraints: [
      ...points.flatMap((p) => p.constraints),
      ...(coincident === null ? [] : [coincident]),
    ],
  };
  const required = new Set(coincident === null ? [] : [coincident.id]);
  void addDrawn(session, add, { required });
}

/** The spline entity over the points: uniform knots of a bspline, the interpolation of a fitSpline. */
function splineEntity(
  ctx: ToolContext,
  kind: SplineToolKind,
  points: readonly PlacedPoint[],
): SketchEntity {
  const id = newEntityId(ctx);
  const ids = points.map((p) => p.id);
  if (kind === 'fitSpline') {
    const { degree, params, knots, poles } = bspline.interpolate(points.map((p) => p.at));
    return { kind: 'fitSpline', id, degree, fit: ids, params, knots, poles };
  }
  const degree = degreeOf(points.length);
  return { kind: 'bspline', id, degree, poles: ids, knots: uniformKnots(points.length, degree) };
}
