// The slot tools (spec 12, "Nové kreslicí nástroje (M31)", "Nástroje"): one tool for three kinds.
// A straight slot: two clicks of the axis (the arc centres, or the extreme points for the overall
// length) through the snapper, a third click the width. An arc slot: the centre and the start
// through the snapper, the end projected onto the circle through the start (a new point without
// inferred constraints, like the arc tool), a fourth click the width. The width is the position of
// the cursor (the grid applies, the snapped point and its inferences do not). The construction of
// sketch gives the positions, the computed points (tangency points, centres) are new points
// without the snapper, and the *Shape function gives the curves, the required constraints and the
// axis line (ShapeDraft.axis). The axis of a straight slot gets horizontal/vertical like a first
// side (sideAxis: an alignment of the second point with the first, otherwise inferLine;
// automatic; Ctrl/Cmd turns it off). A degenerate input makes nothing and the picked points stay.
// The click and the preview of a move share one step (slotStep), so the preview shows exactly the
// constraints the click adds.

import type { Vec2 } from '@/core';
import {
  arcSlotFrom,
  arcSlotShape,
  slotFromCenters,
  slotFromEnds,
  slotOverallShape,
  slotShape,
} from '@/sketch';
import type { ArcSlotFit, ShapeDraft, SketchData, SlotFit } from '@/sketch';
import { isPlainEscape } from '@/interaction';
import type { Tool, ToolContext } from '@/interaction';
import type { SketchEditor } from '../sketch-editor';
import type { GlyphKind } from '../sketch-glyphs';
import type { SketchSession } from '../sketch-session';
import { ccwSweep } from '../sketch-angles';
import {
  MIN_LENGTH,
  arcPoints,
  clearPreview,
  clickTool,
  distance,
  previewInference,
  previewPairs,
  previewPolyline,
  snapMode,
} from './common';
import { freeTarget, placePoint, samePoint, sessionData, snapAt } from './snap';
import type { PlacedPoint, SnapTarget } from './snap';
import { addShape, axisConstraint, shapeIds, sideAxis } from './shape';
import type { AxisKind } from './shape';

/** centers = sketch.slot, overall = sketch.slotOverall, arc = sketch.slotArc. */
export type SlotKind = 'centers' | 'overall' | 'arc';

/** A picked point of the axis; the second point of a straight axis carries its inferred axis. */
interface AxisPoint {
  readonly target: SnapTarget;
  readonly axis: AxisKind | null;
}

type SlotFitOf =
  | { readonly kind: 'straight'; readonly fit: SlotFit }
  | { readonly kind: 'arc'; readonly fit: ArcSlotFit };

/**
 * What a click at a target does: nothing (a degenerate input), take the next point of the axis,
 * or add the slot of the fit.
 */
type SlotStep =
  | { readonly kind: 'none' }
  | { readonly kind: 'axis'; readonly point: AxisPoint }
  | { readonly kind: 'slot'; readonly fit: SlotFitOf };

export function createSlotTool(sketches: SketchEditor, kind: SlotKind): Tool {
  let picked: readonly AxisPoint[] = [];

  return clickTool(sketches, {
    reset() {
      picked = [];
    },
    onMove(ctx, session, x, y, mods) {
      const mode = snapMode(sketches, mods);
      const cursor = snapAt(ctx, session, x, y, mode);
      if (cursor === null) return;
      const step = slotStep(sessionData(session, []), kind, picked, cursor, mode.infer);
      // The projected end of an arc slot gets no guides: they hold at the cursor, not at the end.
      const projected = kind === 'arc' && picked.length === 2;
      const at = step.kind === 'axis' ? step.point.target.at : cursor.at;
      previewInference(session, at, stepInferences(step), projected ? [] : cursor.guides);
      previewSlot(ctx, session, kind, picked, cursor.at, step);
    },
    onClick(ctx, session, x, y, mods) {
      const mode = snapMode(sketches, mods);
      const target = snapAt(ctx, session, x, y, mode);
      if (target === null) return;
      const step = slotStep(sessionData(session, []), kind, picked, target, mode.infer);
      switch (step.kind) {
        case 'none':
          return;
        case 'axis':
          picked = [...picked, step.point];
          return;
        case 'slot': {
          const axis = picked;
          picked = [];
          clearPreview(ctx);
          addSlot(ctx, session, kind, axis, step.fit);
          return;
        }
      }
    },
    onKey(ctx, _session, e) {
      if (!isPlainEscape(e) || picked.length === 0) return false;
      // Escape forgets the picked points; a second one ends the tool.
      picked = [];
      clearPreview(ctx);
      return true;
    },
  });
}

/** Points of the axis before the width: 2 for a straight slot, centre, start and end for an arc slot. */
const axisCount = (kind: SlotKind): number => (kind === 'arc' ? 3 : 2);

/**
 * The step of a click at `target` after the points of the axis picked so far. Pure over `data`,
 * so the preview of a move can call it too.
 */
function slotStep(
  data: SketchData,
  kind: SlotKind,
  picked: readonly AxisPoint[],
  target: SnapTarget,
  infer: boolean,
): SlotStep {
  const [first, second, third] = picked.map((p) => p.target.at);
  if (first === undefined) return axisStep(target);
  if (second === undefined) {
    const from = picked[0]?.target;
    if (from === undefined || samePoint(from, target) || distance(first, target.at) <= MIN_LENGTH) {
      return { kind: 'none' };
    }
    if (kind === 'arc') return axisStep(target);
    // Like a first side (spec 12): an alignment with the first point becomes the axis.
    return { kind: 'axis', point: sideAxis(data, from, target, infer) };
  }
  if (kind === 'arc' && third === undefined) {
    // The end is always a new point: projecting an existing point would move it.
    const end = project(first, second, target.at);
    if (end === null || distance(end, second) <= MIN_LENGTH) return { kind: 'none' };
    // No inferences of the snap: they hold at the cursor, not at the projected end (spec 12).
    return axisStep(freeTarget(end));
  }
  // The width: only the coordinates of the snap (with the grid), not its point or inferences.
  const width = target.at;
  switch (kind) {
    case 'centers':
      return slotOf(slotFromCenters(first, second, width));
    case 'overall':
      return slotOf(slotFromEnds(first, second, width));
    case 'arc': {
      if (third === undefined) return { kind: 'none' };
      const fit = arcSlotFrom(first, second, third, width);
      return fit === null ? { kind: 'none' } : { kind: 'slot', fit: { kind: 'arc', fit } };
    }
  }
}

const axisStep = (target: SnapTarget): SlotStep => ({
  kind: 'axis',
  point: { target, axis: null },
});

const slotOf = (fit: SlotFit | null): SlotStep =>
  fit === null ? { kind: 'none' } : { kind: 'slot', fit: { kind: 'straight', fit } };

/** The inferences the click of the step adds: of the picked point and of its axis; the width adds none. */
function stepInferences(step: SlotStep): readonly { readonly kind: GlyphKind }[] {
  switch (step.kind) {
    case 'none':
    case 'slot':
      return [];
    case 'axis': {
      const { target, axis } = step.point;
      return axis === null ? target.inferred : [...target.inferred, { kind: axis }];
    }
  }
}

/**
 * The preview: the line of the axis (an arc slot: the line to the start, then the arc of the
 * axis) until the axis is complete, then the outline of the slot; a degenerate one is not drawn.
 */
function previewSlot(
  ctx: ToolContext,
  session: SketchSession,
  kind: SlotKind,
  picked: readonly AxisPoint[],
  cursor: Vec2,
  step: SlotStep,
): void {
  const [first, second] = picked.map((p) => p.target.at);
  if (first === undefined) return;
  if (picked.length < axisCount(kind)) {
    if (second === undefined) {
      previewPairs(ctx, session, [first, cursor]);
      return;
    }
    const end = project(first, second, cursor);
    if (end === null) {
      clearPreview(ctx);
      return;
    }
    const from = angle(first, second);
    const sweep = ccwSweep(from, angle(first, end));
    previewPolyline(ctx, session, arcPoints(first, distance(first, second), from, sweep));
    return;
  }
  if (step.kind !== 'slot') {
    clearPreview(ctx);
    return;
  }
  previewPolyline(ctx, session, outline(step.fit));
}

/** The closed outline of the slot counter-clockwise, as points of a polyline. */
function outline(fit: SlotFitOf): readonly Vec2[] {
  if (fit.kind === 'straight') {
    const { c1, c2, radius, l1, l2, r2, r1 } = fit.fit;
    // r1 → r2, the arc around c2 from r2 to l2, l2 → l1, the arc around c1 from l1 to r1.
    return [r1, ...ccwArc(c2, radius, r2, l2), ...ccwArc(c1, radius, l1, r1)];
  }
  const { center, start, end, half, innerStart, innerEnd, outerStart, outerEnd } = fit.fit;
  const inner = ccwArc(center, distance(center, innerStart), innerStart, innerEnd);
  return [
    ...ccwArc(center, distance(center, outerStart), outerStart, outerEnd),
    ...ccwArc(end, half, outerEnd, innerEnd),
    ...inner.toReversed(),
    ...ccwArc(start, half, innerStart, outerStart),
  ];
}

/** Points of the counter-clockwise arc around center from a to b. */
function ccwArc(center: Vec2, radius: number, a: Vec2, b: Vec2): Vec2[] {
  const from = angle(center, a);
  return arcPoints(center, radius, from, ccwSweep(from, angle(center, b)));
}

/**
 * The slot in one addShape: the points of the axis (clicked ones through placePoint), the new
 * computed points, then the curves and constraints of the shape (required) and the inferred axis
 * of a straight slot on the axis line of the draft (automatic).
 */
function addSlot(
  ctx: ToolContext,
  session: SketchSession,
  kind: SlotKind,
  axis: readonly AxisPoint[],
  fit: SlotFitOf,
): void {
  const place = (at: Vec2): PlacedPoint => placePoint(ctx, freeTarget(at));
  const ids = shapeIds(ctx);
  const [p0, p1, p2] = axis.map((p) => placePoint(ctx, p.target));
  if (p0 === undefined || p1 === undefined) return;
  let points: readonly PlacedPoint[];
  let draft: ShapeDraft;
  if (fit.kind === 'arc') {
    if (p2 === undefined) return;
    const f = fit.fit;
    const innerStart = place(f.innerStart);
    const innerEnd = place(f.innerEnd);
    const outerStart = place(f.outerStart);
    const outerEnd = place(f.outerEnd);
    points = [p0, p1, p2, innerStart, innerEnd, outerStart, outerEnd];
    draft = arcSlotShape(
      {
        center: p0.id,
        start: p1.id,
        end: p2.id,
        innerStart: innerStart.id,
        innerEnd: innerEnd.id,
        outerStart: outerStart.id,
        outerEnd: outerEnd.id,
      },
      ids,
    );
  } else {
    const f = fit.fit;
    const computed = kind === 'overall' ? [f.c1, f.c2] : [];
    const centers = computed.map(place);
    const l1 = place(f.l1);
    const l2 = place(f.l2);
    const r2 = place(f.r2);
    const r1 = place(f.r1);
    const tangency = { l1: l1.id, l2: l2.id, r2: r2.id, r1: r1.id };
    const [c1, c2] = centers;
    if (c1 !== undefined && c2 !== undefined) {
      points = [p0, p1, c1, c2, l1, l2, r2, r1];
      draft = slotOverallShape({ e1: p0.id, e2: p1.id, c1: c1.id, c2: c2.id, ...tangency }, ids);
    } else {
      points = [p0, p1, l1, l2, r2, r1];
      draft = slotShape({ c1: p0.id, c2: p1.id, ...tangency }, ids);
    }
  }
  // An arc slot has no axis line (draft.axis null) and its points no axis.
  addShape(session, points, draft, axisConstraint(ctx, axis[1]?.axis ?? null, draft.axis));
}

const angle = (center: Vec2, p: Vec2): number => Math.atan2(p[1] - center[1], p[0] - center[0]);

/** The cursor projected onto the circle around center through start; null on the centre. */
function project(center: Vec2, start: Vec2, cursor: Vec2): Vec2 | null {
  const d = distance(center, cursor);
  if (d <= MIN_LENGTH) return null;
  const r = distance(center, start);
  return [
    center[0] + ((cursor[0] - center[0]) * r) / d,
    center[1] + ((cursor[1] - center[1]) * r) / d,
  ];
}
