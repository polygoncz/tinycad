// The line tool (spec 10, "Nástroje a akce skicáře"; spec 12, M26): a polyline. The first click
// starts a chain, each further click adds a line from the last point (one addGeometry); a click on
// the first point of the chain closes and ends it. Every point goes through the snapper and every
// line through inferLine (axis, parallel, perpendicular, tangent, equal with the previous line of
// the chain); Ctrl/Cmd turns the inference off. The click and the preview of a move share one
// step (lineStep), so the preview shows exactly the constraints the click adds.
//
// A press on the last point of the chain dragged past the click tolerance draws a tangent arc
// instead (spec 12, M27, "Tečný oblouk v polyline"): tangent to the previous line or arc of the
// chain, written on release, and the chain goes on from its end. Without a previous curve the
// drag is ignored; Escape cancels the drag and keeps the chain.

import type { Vec2 } from '@/core';
import { endTangent, inferLine } from '@/sketch';
import type {
  LineInference,
  PointInference,
  SketchConstraint,
  SketchData,
  SketchEntity,
  SketchEntityId,
} from '@/sketch';
import { isPlainEscape } from '@/interaction';
import type { KeyMods, Tool, ToolContext } from '@/interaction';
import type { SketchEditor } from '../sketch-editor';
import type { SketchSession } from '../sketch-session';
import {
  ANGLE_TOLERANCE,
  MIN_LENGTH,
  clearInference,
  clearPreview,
  clickTool,
  distance,
  existingLine,
  newConstraintId,
  newEntityId,
  previewArcFit,
  previewInference,
  previewPairs,
  snapMode,
} from './common';
import { placePoint, sessionData, snapAt } from './snap';
import type { PlacedPoint, SnapTarget } from './snap';
import { tangentArcGeometry, tangentArcInferences, tangentArcTo } from './tangent-arc';
import type { TangentArc, TangentStart } from './tangent-arc';

interface Chain {
  readonly first: PlacedPoint;
  readonly last: PlacedPoint;
  /** What the first point still has to add (written with the first line). */
  readonly pending: PlacedPoint | null;
  readonly lines: number;
  /**
   * The last line or arc of the chain (`previous` of inferLine, the curve a tangent arc
   * continues); null before the first line.
   */
  readonly previous: SketchEntityId | null;
  /**
   * The entities of the chain, which may not be written yet: the snapper and inferLine see them
   * like the data, so the first point can be hit to close the chain before its write settles.
   */
  readonly entities: readonly SketchEntity[];
}

/**
 * What a click at a target does: nothing, start a chain, or add a line to the target (`close` =
 * back to the first point of the chain). `target` of a line has its inferences without the
 * alignment with the start of the line, `inferences` the constraints of the line (that axis
 * included); a line between two points an existing line joins (`existing`) adds nothing.
 */
type LineStep =
  | { readonly kind: 'none' }
  | { readonly kind: 'start'; readonly target: SnapTarget }
  | {
      readonly kind: 'line';
      readonly target: SnapTarget;
      readonly close: boolean;
      readonly existing: SketchEntityId | null;
      readonly inferences: readonly LineInference[];
    };

const NO_STEP: LineStep = { kind: 'none' };

export function createLineTool(sketches: SketchEditor): Tool {
  let chain: Chain | null = null;
  /** The start of the tangent arc being dragged; null without a drag. */
  let arc: TangentStart | null = null;

  function end(ctx: ToolContext): void {
    chain = null;
    clearPreview(ctx);
  }

  /** The tangent arc to the target of a drag at (x, y) from `start`, or null (degenerate). */
  function arcAt(
    ctx: ToolContext,
    session: SketchSession,
    current: Chain,
    start: TangentStart,
    x: number,
    y: number,
    mods: KeyMods,
  ) {
    const target = snapAt(ctx, session, x, y, {
      ...snapMode(sketches, mods),
      pending: current.entities,
    });
    return target === null ? null : tangentArcTo(start, target);
  }

  /**
   * Adds the line of `step` from the end of the current chain to `to` and moves the chain on to
   * `to`. An existing line between them is not doubled; the chain just moves on.
   */
  function addLine(
    ctx: ToolContext,
    session: SketchSession,
    current: Chain,
    to: PlacedPoint,
    step: Extract<LineStep, { kind: 'line' }>,
  ): void {
    const { last: from, pending } = current;
    if (step.existing !== null) {
      chain = { ...current, last: to, lines: current.lines + 1, previous: step.existing };
      return;
    }
    const id = newEntityId(ctx);
    const line: SketchEntity = { kind: 'line', id, p1: from.id, p2: to.id };
    const entities = [...(pending?.entities ?? []), ...to.entities, line];
    const constraints = [
      ...(pending?.constraints ?? []),
      ...to.constraints,
      ...step.inferences.map((i) => lineConstraint(ctx, id, i)),
    ];
    // The chain moves on before the write, so the next line starts from this point.
    const started: Chain = {
      first: current.first,
      last: to,
      pending: null,
      lines: current.lines + 1,
      previous: id,
      entities: [...current.entities, ...to.entities, line],
    };
    chain = started;
    void session.addGeometry({ entities, constraints }).then((written) => {
      // A refused line would leave the chain on a point that is not in the sketch.
      if (!written && chain === started) chain = null;
    });
  }

  return clickTool(sketches, {
    reset() {
      chain = null;
      arc = null;
    },
    onMove(ctx, session, x, y, mods) {
      const mode = snapMode(sketches, mods);
      const pending = chain?.entities ?? [];
      const target = snapAt(ctx, session, x, y, { ...mode, pending });
      if (target === null) return;
      const step = lineStep(sessionData(session, pending), chain, target, mode.infer);
      const inferences = step.kind === 'line' ? step.inferences : [];
      const inferred = step.kind === 'none' ? [] : step.target.inferred;
      previewInference(session, target.at, [...inferred, ...inferences], target.guides);
      if (chain !== null) previewPairs(ctx, session, [chain.last.at, target.at]);
    },
    onClick(ctx, session, x, y, mods) {
      const mode = snapMode(sketches, mods);
      const current = chain;
      const pending = current?.entities ?? [];
      const target = snapAt(ctx, session, x, y, { ...mode, pending });
      if (target === null) return;
      const step = lineStep(sessionData(session, pending), current, target, mode.infer);
      switch (step.kind) {
        case 'none':
          return;
        case 'start': {
          const first = placePoint(ctx, step.target);
          chain = {
            first,
            last: first,
            pending: first,
            lines: 0,
            previous: null,
            entities: first.entities,
          };
          return;
        }
        case 'line': {
          if (current === null) return;
          // The first point is in the sketch already (written with the first line).
          const to = step.close
            ? { ...current.first, entities: [], constraints: [] }
            : placePoint(ctx, step.target);
          addLine(ctx, session, current, to, step);
          if (step.close) end(ctx);
          return;
        }
      }
    },
    onKey(ctx, _session, e) {
      if (!isPlainEscape(e) || chain === null) return false;
      end(ctx);
      return true;
    },
    onDragStart(ctx, session, x, y, mods) {
      const current = chain;
      if (current === null) return false;
      const pending = current.entities;
      const target = snapAt(ctx, session, x, y, { ...snapMode(sketches, mods), pending });
      if (target === null) return false;
      arc = tangentStart(sessionData(session, pending), current, target);
      return arc !== null;
    },
    onDrag(ctx, session, x, y, mods) {
      const current = chain;
      const start = arc;
      if (current === null || start === null) return;
      const step = arcAt(ctx, session, current, start, x, y, mods);
      if (step === null) {
        // A degenerate arc (the end on the line of the direction) is not drawn.
        clearInference(session);
        clearPreview(ctx);
        return;
      }
      previewInference(session, step.end.at, tangentArcInferences(step), step.end.guides);
      previewArcFit(ctx, session, step.fit, start.at, step.end.at);
    },
    onDragEnd(ctx, session, x, y, mods) {
      const current = chain;
      const start = arc;
      arc = null;
      clearPreview(ctx);
      if (current === null || start === null) return;
      const step = arcAt(ctx, session, current, start, x, y, mods);
      if (step === null) return;
      addArc(ctx, session, current, start, step);
    },
    onDragCancel(ctx) {
      arc = null;
      clearPreview(ctx);
    },
  });

  /**
   * Adds the tangent arc from the end of the chain and moves the chain on to the end of the arc
   * (the point at the cursor, also when a clockwise arc swaps its ends in the data).
   */
  function addArc(
    ctx: ToolContext,
    session: SketchSession,
    current: Chain,
    start: TangentStart,
    step: TangentArc,
  ): void {
    const geometry = tangentArcGeometry(ctx, start, step);
    const { pending } = current;
    const entities = [...(pending?.entities ?? []), ...geometry.entities];
    const constraints = [...(pending?.constraints ?? []), ...geometry.constraints];
    const started: Chain = {
      first: current.first,
      last: geometry.end,
      pending: null,
      lines: current.lines + 1,
      previous: geometry.arc,
      entities: [...current.entities, ...geometry.entities],
    };
    // An arc onto the first point closes the chain and ends it, like a closing line.
    const closes = geometry.end.id === current.first.id;
    chain = closes ? null : started;
    void session
      .addGeometry({ entities, constraints }, { required: geometry.required })
      .then((written) => {
        // A refused arc would leave the chain on a point that is not in the sketch.
        if (!written && chain === started) chain = null;
      });
  }
}

/**
 * The start of a tangent arc dragged from `target`: the last point of the chain, continuing the
 * previous line or arc of the chain; null for another point or without a previous curve.
 */
function tangentStart(data: SketchData, chain: Chain, target: SnapTarget): TangentStart | null {
  const { last, previous } = chain;
  if (previous === null || target.point !== last.id) return null;
  const curve = data.entities.find((e) => e.id === previous);
  if (curve?.kind !== 'line' && curve?.kind !== 'arc') return null;
  const direction = endTangent(curve, last.id, data);
  return direction === null ? null : { point: last.id, at: target.at, curve: previous, direction };
}

/**
 * The step of a click at `target` with the chain `chain` (null = none yet); `infer` = without
 * Ctrl/Cmd. Pure over `data` (the session with the entities of the chain), so the preview of a
 * move can call it too.
 */
function lineStep(
  data: SketchData,
  chain: Chain | null,
  target: SnapTarget,
  infer: boolean,
): LineStep {
  if (chain === null) return { kind: 'start', target };
  const { first, last } = chain;
  if (target.point === last.id) return NO_STEP;
  if (target.point === first.id) {
    // Closing needs two lines already, otherwise it would double the only one.
    if (chain.lines < 2) return NO_STEP;
    const closing = { ...target, inferred: [] };
    return lineTo(data, chain, closing, first, { infer, axis: null, close: true });
  }
  if (distance(last.at, target.at) <= MIN_LENGTH) return NO_STEP;
  const { inferred, axis } = alignmentWith(target.inferred, last.id);
  const to = { id: target.point, at: target.at };
  return lineTo(data, chain, { ...target, inferred }, to, { infer, axis, close: false });
}

/**
 * The line step from the end of the chain to the point `to` (id null = a new point). `axis`
 * replaces an alignment of `to` with the start of the line (one constraint of the line, not of
 * its two points).
 */
function lineTo(
  data: SketchData,
  chain: Chain,
  target: SnapTarget,
  to: { readonly id: SketchEntityId | null; readonly at: Vec2 },
  opts: { readonly infer: boolean; readonly axis: AxisKind | null; readonly close: boolean },
): LineStep {
  const { last: from } = chain;
  const { axis, close } = opts;
  const existing = to.id === null ? null : existingLine(data, from.id, to.id);
  if (existing !== null) return { kind: 'line', target, close, existing, inferences: [] };
  const inferred = opts.infer
    ? inferLine({ at: from.at, point: from.id }, to.at, data, {
        previous: chain.previous,
        angleTolerance: ANGLE_TOLERANCE,
      })
    : [];
  const inferences: readonly LineInference[] =
    axis === null || inferred.some((i) => i.kind === axis)
      ? inferred
      : [{ kind: axis }, ...inferred];
  return { kind: 'line', target, close, existing: null, inferences };
}

type AxisKind = 'horizontal' | 'vertical';

/**
 * The inferences of a new point without its alignment with `from` (the start of the line being
 * drawn), and the axis of the line that replaces it: hAlign → horizontal, vAlign → vertical.
 */
function alignmentWith(
  inferred: readonly PointInference[],
  from: SketchEntityId,
): { readonly inferred: readonly PointInference[]; readonly axis: AxisKind | null } {
  const align = inferred.find(
    (i) => (i.kind === 'hAlign' || i.kind === 'vAlign') && i.with === from,
  );
  if (align === undefined) return { inferred, axis: null };
  return {
    inferred: inferred.filter((i) => i !== align),
    axis: align.kind === 'hAlign' ? 'horizontal' : 'vertical',
  };
}

/** The constraint of an inference of the new line `line`. */
function lineConstraint(
  ctx: ToolContext,
  line: SketchEntityId,
  i: LineInference,
): SketchConstraint {
  const id = newConstraintId(ctx);
  switch (i.kind) {
    case 'horizontal':
    case 'vertical':
      return { kind: i.kind, id, line };
    case 'parallel':
    case 'perpendicular':
    case 'equal':
      return { kind: i.kind, id, a: line, b: i.line };
    case 'tangent':
      return { kind: 'tangent', id, a: line, b: i.curve };
  }
}
