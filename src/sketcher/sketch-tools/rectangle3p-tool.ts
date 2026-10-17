// The 3-point rectangle tool (spec 12, "Nové kreslicí nástroje (M31)"): two corners are the first
// side, the third click the height perpendicular to it (rectangleFrom3) → a rotated rectangle
// held by rectangle3Shape: 4 lines, perpendicular and 2× parallel (required). The clicked corners
// go through the snapper; the two computed corners too, at their place, without the grid and
// never onto the clicked corners. The first side gets horizontal or vertical from inferLine
// within 3° (automatic, B3); Ctrl/Cmd turns it off. A degenerate rectangle makes nothing. The
// click and the preview of a move share one step (rectangle3pStep).
//
// The numeric input (spec 12, M32): the first corner has the fields x and y, the second length and
// angle from the first, the third the height (to the side of the cursor). A locked length becomes
// a required distance of ab, a locked height of bc; a locked angle replaces the automatic axis of
// the side: 0/180° → a required horizontal, 90/270° → vertical, another angle none.

import { vec2 } from '@/core';
import type { Vec2 } from '@/core';
import { rectangle3Shape, rectangleFrom3 } from '@/sketch';
import type { SketchConstraint, SketchData, SketchEntityId } from '@/sketch';
import { isPlainEscape } from '@/interaction';
import type { Tool, ToolContext } from '@/interaction';
import type { SketchEditor } from '../sketch-editor';
import type { GlyphKind } from '../sketch-glyphs';
import {
  HEIGHT_FIELDS,
  MIN_LENGTH,
  POLAR_FIELDS,
  XY_FIELDS,
  axisOfAngle,
  clearPreview,
  clickTool,
  constrainPolar,
  constrainXY,
  distanceDimension,
  inputValues,
  leftNormal,
  measurePolar,
  measureXY,
  previewInference,
  previewPairs,
  previewPolyline,
  signedOffset,
  snapMode,
} from './common';
import { placePoint, samePoint, sessionData, snapAt, snapToleranceAt } from './snap';
import type { SnapTarget } from './snap';
import {
  addShape,
  axisConstraint,
  shapeIds,
  sideAxis,
  snapComputed,
  withoutOwnAlignment,
  withTyped,
  computedTolerance,
} from './shape';
import type { AxisKind } from './shape';

/**
 * The first side a → b with the axis it gets (null = none); `typed` = the axis is of a locked
 * angle (M32): required, not automatic. `length` = the locked length of the side (M32), or null.
 */
interface Side {
  readonly a: SnapTarget;
  readonly b: SnapTarget;
  readonly axis: AxisKind | null;
  readonly typed: boolean;
  readonly length: number | null;
}

/**
 * What a click at a target does: nothing (degenerate), take the first corner, take the second
 * corner (the first side), or add the rectangle of the side and the two snapped computed corners.
 */
type Rectangle3pStep =
  | { readonly kind: 'none' }
  | { readonly kind: 'first'; readonly target: SnapTarget }
  | { readonly kind: 'side'; readonly side: Side }
  | {
      readonly kind: 'rectangle';
      readonly side: Side;
      readonly corners: readonly [SnapTarget, SnapTarget, SnapTarget, SnapTarget];
    };

/** The work in progress: the first corner, or the first side. */
type Progress =
  | { readonly kind: 'first'; readonly a: SnapTarget }
  | { readonly kind: 'side'; readonly side: Side };

export function createRectangle3pTool(sketches: SketchEditor): Tool {
  let progress: Progress | null = null;

  return clickTool(sketches, {
    reset() {
      progress = null;
    },
    hint() {
      if (progress === null) return 'hint.rectangle3p.first';
      return progress.kind === 'first' ? 'hint.rectangle3p.second' : 'hint.rectangle3p.height';
    },
    inputFields() {
      if (progress === null) return XY_FIELDS;
      return progress.kind === 'first' ? POLAR_FIELDS : HEIGHT_FIELDS;
    },
    constrain(cursor, values) {
      if (progress === null) return constrainXY(cursor, values);
      if (progress.kind === 'first') return constrainPolar(progress.a.at, cursor, values);
      return constrainHeight(progress.side, cursor, values);
    },
    measure(at) {
      if (progress === null) return measureXY(at);
      if (progress.kind === 'first') return measurePolar(progress.a.at, at);
      return measureHeight(progress.side, at);
    },
    onMove(ctx, session, x, y, mods) {
      const mode = snapMode(sketches, mods);
      const target = snapAt(ctx, session, x, y, mode);
      const tolerance = snapToleranceAt(ctx, session, x, y);
      if (target === null || tolerance === null) return;
      const data = sessionData(session, []);
      const values = inputValues(mods);
      const step = rectangle3pStep(
        data,
        progress,
        target,
        computedTolerance(mode, tolerance),
        mode.infer,
        values,
      );
      previewInference(session, target.at, stepInferences(step), target.guides);
      if (progress === null) return;
      // A degenerate side or rectangle is not drawn.
      switch (step.kind) {
        case 'side':
          previewPairs(ctx, session, [step.side.a.at, step.side.b.at]);
          return;
        case 'rectangle': {
          const [a, b, c, d] = step.corners;
          previewPolyline(ctx, session, [a.at, b.at, c.at, d.at, a.at]);
          return;
        }
        default:
          clearPreview(ctx);
      }
    },
    onClick(ctx, session, x, y, mods) {
      const mode = snapMode(sketches, mods);
      const target = snapAt(ctx, session, x, y, mode);
      const tolerance = snapToleranceAt(ctx, session, x, y);
      if (target === null || tolerance === null) return;
      const data = sessionData(session, []);
      const values = inputValues(mods);
      const step = rectangle3pStep(
        data,
        progress,
        target,
        computedTolerance(mode, tolerance),
        mode.infer,
        values,
      );
      switch (step.kind) {
        case 'none':
          return;
        case 'first':
          progress = { kind: 'first', a: step.target };
          return;
        case 'side':
          progress = { kind: 'side', side: step.side };
          return;
        case 'rectangle': {
          progress = null;
          clearPreview(ctx);
          const [a, b, c, d] = step.corners;
          const placed = [
            placePoint(ctx, a),
            placePoint(ctx, b),
            placePoint(ctx, c),
            placePoint(ctx, d),
          ] as const;
          const [pa, pb, pc, pd] = placed;
          const draft = rectangle3Shape([pa.id, pb.id, pc.id, pd.id], shapeIds(ctx));
          const axis = axisConstraint(ctx, step.side.axis, draft.axis);
          const typed = typedConstraints(ctx, [pa.id, pb.id, pc.id], step.side, values);
          if (step.side.typed) addShape(session, placed, withTyped(draft, [...axis, ...typed]));
          else addShape(session, placed, withTyped(draft, typed), axis);
          return;
        }
      }
    },
    onKey(ctx, _session, e) {
      if (!isPlainEscape(e) || progress === null) return false;
      progress = null;
      clearPreview(ctx);
      return true;
    },
  });
}

/**
 * The step of a click at `target` with the work in progress `progress` (null = none yet) and the
 * entered values (M32): a locked angle of the side replaces its automatic axis, a locked length is
 * kept for the dimension. Pure over `data`, so the preview of a move can call it too.
 */
function rectangle3pStep(
  data: SketchData,
  progress: Progress | null,
  target: SnapTarget,
  tolerance: number,
  infer: boolean,
  values: ReadonlyMap<string, number>,
): Rectangle3pStep {
  if (progress === null) return { kind: 'first', target };
  if (progress.kind === 'first') {
    const { a } = progress;
    if (samePoint(a, target) || vec2.dist(a.at, target.at) <= MIN_LENGTH) return { kind: 'none' };
    const { target: b, axis } = sideAxis(data, a, target, infer);
    const length = values.get('length') ?? null;
    const angle = values.get('angle');
    if (angle !== undefined) {
      return { kind: 'side', side: { a, b, axis: axisOfAngle(angle), typed: true, length } };
    }
    return { kind: 'side', side: { a, b, axis, typed: false, length } };
  }
  const { side } = progress;
  const corners = rectangleFrom3(side.a.at, side.b.at, target.at);
  // A degenerate rectangle: the click is ignored and the side stays.
  if (corners === null) return { kind: 'none' };
  const computed: readonly [Vec2, Vec2] = [corners[2], corners[3]];
  const [tc, td] = snapComputed(data, computed, tolerance, infer, [side.a, side.b]);
  const [fa, fb, fc, fd] = withoutOwnAlignment([side.a, side.b, tc, td] as const);
  return { kind: 'rectangle', side, corners: [fa, fb, fc, fd] };
}

/**
 * The inferences the click of the step adds and the preview shows: of the clicked first corner,
 * of the second corner with the axis of the side, or of the computed corners c and d (the first
 * side showed its own when it was clicked).
 */
function stepInferences(step: Rectangle3pStep): readonly { readonly kind: GlyphKind }[] {
  switch (step.kind) {
    case 'none':
      return [];
    case 'first':
      return step.target.inferred;
    case 'side': {
      const { b, axis } = step.side;
      return axis === null ? b.inferred : [...b.inferred, { kind: axis }];
    }
    case 'rectangle':
      return step.corners.slice(2).flatMap((t) => t.inferred);
  }
}

/**
 * The third point for the cursor and the entered `height` (spec 12, M32): the corner c at that
 * distance from b perpendicular to the side, on the side of the cursor (a cursor on the side
 * counts as the left one).
 */
function constrainHeight(side: Side, cursor: Vec2, values: ReadonlyMap<string, number>): Vec2 {
  const height = values.get('height');
  const n = leftNormal(side.a.at, side.b.at);
  if (height === undefined || n === null) return cursor;
  const h = signedOffset(side.b.at, n, cursor) < 0 ? -height : height;
  return [side.b.at[0] + h * n[0], side.b.at[1] + h * n[1]];
}

/** The `height` of the rectangle with the third point `at`: its distance from the side. */
function measureHeight(side: Side, at: Vec2): ReadonlyMap<string, number> {
  const n = leftNormal(side.a.at, side.b.at);
  return new Map([['height', n === null ? 0 : Math.abs(signedOffset(side.b.at, n, at))]]);
}

/**
 * The required dimensions of the locked fields (spec 12, M32): the length of the side →
 * distance(a, b), the `height` of the click → distance(b, c).
 */
function typedConstraints(
  ctx: ToolContext,
  [a, b, c]: readonly [SketchEntityId, SketchEntityId, SketchEntityId],
  side: Side,
  values: ReadonlyMap<string, number>,
): readonly SketchConstraint[] {
  return [
    ...distanceDimension(ctx, a, b, side.length),
    ...distanceDimension(ctx, b, c, values.get('height')),
  ];
}
