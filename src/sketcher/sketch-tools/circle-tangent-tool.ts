// The tangent circle tools (spec 12, "Oblouky a kružnice (M27)"):
// - 2 tangents: a click on curve A, a click on curve B, the move chooses the position
//   (tangentCircle([A, B], cursor)), a click writes it;
// - 3 tangents: clicks on three curves, the third writes tangentCircle([A, B, C], centroid of the
//   three clicks).
// The circle gets a new centre point and a tangent with every picked curve (required). A curve
// is a line, circle or arc of the edited sketch within 6 px (the snapper over the curves only);
// a click off a curve does nothing. The picked curves are selected in the session while the tool
// works (drawn 'selected'), Escape forgets them. The click and the preview of a move share one
// step (circleTangentStep), so the preview shows exactly the constraints the click adds.

import type { Vec2 } from '@/core';
import { curve2, isPattern, pointsById, tangentCircle } from '@/sketch';
import type {
  CircleFit,
  SketchConstraint,
  SketchConstraintId,
  SketchData,
  SketchEntity,
  SketchEntityId,
} from '@/sketch';
import { isPlainEscape } from '@/interaction';
import type { Tool, ToolContext } from '@/interaction';
import type { SketchEditor } from '../sketch-editor';
import type { GlyphKind } from '../sketch-glyphs';
import type { SketchSession } from '../sketch-session';
import {
  MIN_LENGTH,
  circlePoints,
  clearPreview,
  clickTool,
  cursorAt,
  newConstraintId,
  newEntityId,
  previewInference,
  previewPolyline,
} from './common';
import { sessionData, snapAt } from './snap';

/** A picked curve and where in the plane it was clicked. */
interface PickedCurve {
  readonly curve: SketchEntityId;
  readonly at: Vec2;
}

/** The curve under the cursor: its id and the point of it nearest to the cursor. */
interface CurveHit {
  readonly curve: SketchEntityId;
  readonly at: Vec2;
}

/**
 * What a click does: nothing (off a curve, no tangent circle), pick one more curve, or add the
 * circle `fit` tangent to `curves`; `hit` is the curve the click picks for it (the third curve of
 * the 3-tangent tool), null when the click only places the circle (the 2-tangent tool).
 */
type CircleTangentStep =
  | { readonly kind: 'none' }
  | { readonly kind: 'curve'; readonly hit: CurveHit }
  | {
      readonly kind: 'circle';
      readonly fit: CircleFit;
      readonly curves: readonly SketchEntityId[];
      readonly hit: CurveHit | null;
    };

/** The tool of `count` tangents: 2 = sketch.circle2t, 3 = sketch.circle3t. */
export function createCircleTangentTool(sketches: SketchEditor, count: 2 | 3): Tool {
  let picked: readonly PickedCurve[] = [];
  /** The session whose selection shows the picked curves. */
  let owner: SketchSession | null = null;

  function forget(): void {
    if (picked.length > 0 && owner?.state.get().open === true) owner.clearSelection();
    picked = [];
    owner = null;
  }

  function pick(session: SketchSession, p: PickedCurve): void {
    session.select(p.curve, { additive: picked.length > 0 });
    picked = [...picked, p];
    owner = session;
  }

  function stepAt(ctx: ToolContext, session: SketchSession, x: number, y: number) {
    const cursor = cursorAt(ctx, session, x, y);
    if (cursor === null) return null;
    const data = sessionData(session, []);
    const hit = curveAt(ctx, session, x, y, data, picked);
    return { cursor, step: circleTangentStep(data, count, picked, hit, cursor) };
  }

  return clickTool(sketches, {
    reset: forget,
    onMove(ctx, session, x, y) {
      const at = stepAt(ctx, session, x, y);
      if (at === null) return;
      const { cursor, step } = at;
      const hit = step.kind === 'none' ? null : step.hit;
      previewInference(session, hit?.at ?? cursor, stepInferences(step), []);
      // Degenerate input draws no circle (spec 12).
      if (step.kind === 'circle') {
        previewPolyline(ctx, session, circlePoints(step.fit.center, step.fit.radius));
      } else {
        clearPreview(ctx);
      }
    },
    onClick(ctx, session, x, y) {
      const at = stepAt(ctx, session, x, y);
      if (at === null) return;
      const { step } = at;
      switch (step.kind) {
        case 'none':
          return;
        case 'curve':
          pick(session, step.hit);
          return;
        case 'circle':
          clearPreview(ctx);
          forget();
          addTangentCircle(ctx, session, step.fit, step.curves);
          return;
      }
    },
    onKey(ctx, _session, e) {
      if (!isPlainEscape(e) || picked.length === 0) return false;
      forget();
      clearPreview(ctx);
      return true;
    },
  });
}

/**
 * The step of a click with the curves `picked` so far, `hit` under the cursor (null = none) and
 * the cursor. Pure over `data`, so the preview of a move can call it too.
 */
function circleTangentStep(
  data: SketchData,
  count: 2 | 3,
  picked: readonly PickedCurve[],
  hit: CurveHit | null,
  cursor: Vec2,
): CircleTangentStep {
  // Both tools pick two curves first.
  if (picked.length < 2) return hit === null ? { kind: 'none' } : { kind: 'curve', hit };
  if (count === 3) {
    // The third curve writes the circle at the centroid of the three clicks.
    if (hit === null) return { kind: 'none' };
    const curves = [...picked.map((p) => p.curve), hit.curve];
    const fit = fitTangent(data, curves, centroid([...picked.map((p) => p.at), hit.at]));
    return fit === null ? { kind: 'none' } : { kind: 'circle', fit, curves, hit };
  }
  // The 2-tangent tool: the cursor chooses the position.
  const curves = picked.map((p) => p.curve);
  const fit = fitTangent(data, curves, cursor);
  return fit === null ? { kind: 'none' } : { kind: 'circle', fit, curves, hit: null };
}

/** The inferences the click of the step adds: tangent of the curve it picks (none for a position). */
function stepInferences(step: CircleTangentStep): readonly { readonly kind: GlyphKind }[] {
  return step.kind !== 'none' && step.hit !== null ? [{ kind: 'tangent' }] : [];
}

/** tangentCircle over the curves of the data; a missing curve or a zero radius → null. */
function fitTangent(
  data: SketchData,
  curves: readonly SketchEntityId[],
  hint: Vec2,
): CircleFit | null {
  const points = pointsById(data);
  const shapes = curves.map((id) => {
    const e = data.entities.find((c) => c.id === id);
    return e === undefined || e.kind === 'point' || e.kind === 'text' || isPattern(e)
      ? null
      : curve2(e, points);
  });
  if (shapes.some((s) => s === null)) return null;
  const fit = tangentCircle(
    shapes.filter((s) => s !== null),
    hint,
  );
  return fit === null || fit.radius <= MIN_LENGTH ? null : fit;
}

/**
 * The line, circle or arc of the edited sketch within 6 px of the cursor (spec 12): the snapper
 * step 4 (onCurve) over the curves only – points are excluded, and so are the picked curves (a
 * curve is picked once). A midpoint snap (step 3) lies on its line, so it hits the line too.
 */
function curveAt(
  ctx: ToolContext,
  session: SketchSession,
  x: number,
  y: number,
  data: SketchData,
  picked: readonly PickedCurve[],
): CurveHit | null {
  const exclude = new Set<SketchEntityId>([
    ...data.entities.filter((e) => e.kind === 'point').map((e) => e.id),
    ...picked.map((p) => p.curve),
  ]);
  // The curves snap only with the inference: on even with Ctrl/Cmd, which only drops automatic
  // constraints (the tangents are required). No grid: it never wins over a curve.
  const target = snapAt(ctx, session, x, y, { grid: null, infer: true, exclude });
  if (target === null) return null;
  const [inferred] = target.inferred;
  if (target.kind === 'onCurve' && inferred?.kind === 'pointOnCurve') {
    return { curve: inferred.curve, at: target.at };
  }
  if (target.kind === 'midpoint' && inferred?.kind === 'midpoint') {
    return { curve: inferred.line, at: target.at };
  }
  return null;
}

function centroid(points: readonly Vec2[]): Vec2 {
  const n = Math.max(1, points.length);
  const [sx, sy] = points.reduce<Vec2>((s, p) => [s[0] + p[0], s[1] + p[1]], [0, 0]);
  return [sx / n, sy / n];
}

/** Writes the circle `fit` with a new centre point and a required tangent with every curve. */
function addTangentCircle(
  ctx: ToolContext,
  session: SketchSession,
  fit: CircleFit,
  curves: readonly SketchEntityId[],
): void {
  const centerId = newEntityId(ctx);
  const id = newEntityId(ctx);
  const entities: readonly SketchEntity[] = [
    { kind: 'point', id: centerId, x: fit.center[0], y: fit.center[1] },
    { kind: 'circle', id, center: centerId, radius: fit.radius },
  ];
  const tangents: readonly SketchConstraint[] = curves.map((curve) => ({
    kind: 'tangent',
    id: newConstraintId(ctx),
    a: id,
    b: curve,
  }));
  const required: ReadonlySet<SketchConstraintId> = new Set(tangents.map((c) => c.id));
  void session.addGeometry({ entities, constraints: tangents }, { required });
}
