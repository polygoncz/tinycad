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
//
// The numeric input (spec 12, "Číselný vstup (M32)"): the first point has the fields x and y, a
// next point length and angle from the last point. A locked length becomes a required distance of
// the new line; a locked angle replaces the automatic axis: 0/180° → horizontal, 90/270° →
// vertical, another angle with a previous line of the chain → an angle dimension between them.
// A locked angle drops the automatic direction (axis, parallel, perpendicular, tangent), a locked
// length the automatic equal, so the entered values are exact.

import type { Vec2 } from '@/core';
import { endTangent, inferLine, measure } from '@/sketch';
import type {
  LineInference,
  PointInference,
  SketchConstraint,
  SketchConstraintId,
  SketchData,
  SketchEntity,
  SketchEntityId,
} from '@/sketch';
import { isPlainEscape } from '@/interaction';
import type { KeyMods, Tool, ToolContext } from '@/interaction';
import type { SketchEditor } from '../sketch-editor';
import type { GlyphKind } from '../sketch-glyphs';
import type { SketchSession } from '../sketch-session';
import {
  addDrawn,
  ANGLE_TOLERANCE,
  axisOfAngle,
  clearInference,
  clearPreview,
  clickTool,
  constrainPolar,
  constrainXY,
  distance,
  existingLine,
  inputValues,
  measurePolar,
  measureXY,
  MIN_LENGTH,
  newConstraintId,
  newEntityId,
  POLAR_FIELDS,
  previewArcFit,
  previewInference,
  previewPairs,
  snapMode,
  withoutLocked,
  XY_FIELDS,
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
      /** The axis of a locked angle on an axis (M32), required; null = none. */
      readonly typedAxis: AxisKind | null;
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
    values: ReadonlyMap<string, number>,
  ): void {
    const { last: from, pending } = current;
    if (step.existing !== null) {
      chain = { ...current, last: to, lines: current.lines + 1, previous: step.existing };
      return;
    }
    const id = newEntityId(ctx);
    const line: SketchEntity = { kind: 'line', id, p1: from.id, p2: to.id };
    const entities = [...(pending?.entities ?? []), ...to.entities, line];
    const typed = typedConstraints(
      ctx,
      sessionData(session, [...current.entities, ...to.entities, line]),
      current,
      line,
      step.typedAxis,
      values,
    );
    const constraints = [
      ...(pending?.constraints ?? []),
      ...to.constraints,
      ...step.inferences.map((i) => lineConstraint(ctx, id, i)),
      ...typed,
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
    const required = new Set<SketchConstraintId>(typed.map((c) => c.id));
    void addDrawn(session, { entities, constraints }, { required }).then((written) => {
      // A refused line would leave the chain on a point that is not in the sketch.
      if (!written && chain === started) chain = null;
    });
  }

  return clickTool(sketches, {
    reset() {
      chain = null;
      arc = null;
    },
    inputFields() {
      return chain === null ? XY_FIELDS : POLAR_FIELDS;
    },
    constrain(_session, cursor, values) {
      return chain === null
        ? constrainXY(cursor, values)
        : constrainPolar(chain.last.at, cursor, values);
    },
    measure(_session, at) {
      return chain === null ? measureXY(at) : measurePolar(chain.last.at, at);
    },
    onMove(ctx, session, x, y, mods) {
      const mode = snapMode(sketches, mods);
      const pending = chain?.entities ?? [];
      const target = snapAt(ctx, session, x, y, { ...mode, pending });
      if (target === null) return;
      const values = inputValues(mods);
      const step = lineStep(sessionData(session, pending), chain, target, mode.infer, values);
      const inferences: readonly { readonly kind: GlyphKind }[] =
        step.kind === 'line'
          ? [...step.inferences, ...(step.typedAxis === null ? [] : [{ kind: step.typedAxis }])]
          : [];
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
      const values = inputValues(mods);
      const step = lineStep(sessionData(session, pending), current, target, mode.infer, values);
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
          addLine(ctx, session, current, to, step, values);
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
    void addDrawn(session, { entities, constraints }, { required: geometry.required }).then(
      (written) => {
        // A refused arc would leave the chain on a point that is not in the sketch.
        if (!written && chain === started) chain = null;
      },
    );
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
  values: ReadonlyMap<string, number>,
): LineStep {
  if (chain === null) return { kind: 'start', target };
  const { first, last } = chain;
  if (target.point === last.id) return NO_STEP;
  if (target.point === first.id) {
    // Closing needs two lines already, otherwise it would double the only one.
    if (chain.lines < 2) return NO_STEP;
    const closing = { ...target, inferred: [] };
    return lineTo(data, chain, closing, first, { infer, axis: null, close: true, values });
  }
  if (distance(last.at, target.at) <= MIN_LENGTH) return NO_STEP;
  const { inferred, axis } = alignmentWith(target.inferred, last.id);
  const to = { id: target.point, at: target.at };
  return lineTo(data, chain, { ...target, inferred }, to, { infer, axis, close: false, values });
}

/**
 * The line step from the end of the chain to the point `to` (id null = a new point). `axis`
 * replaces an alignment of `to` with the start of the line (one constraint of the line, not of
 * its two points). The locked fields (M32) replace the automatic inferences they fix
 * (withoutLocked): an angle every direction (on an axis it is the required typedAxis), a length
 * equal.
 */
function lineTo(
  data: SketchData,
  chain: Chain,
  target: SnapTarget,
  to: { readonly id: SketchEntityId | null; readonly at: Vec2 },
  opts: {
    readonly infer: boolean;
    readonly axis: AxisKind | null;
    readonly close: boolean;
    readonly values: ReadonlyMap<string, number>;
  },
): LineStep {
  const { last: from } = chain;
  const { close } = opts;
  const existing = to.id === null ? null : existingLine(data, from.id, to.id);
  if (existing !== null) {
    return { kind: 'line', target, close, existing, inferences: [], typedAxis: null };
  }
  const inferred = opts.infer
    ? inferLine({ at: from.at, point: from.id }, to.at, data, {
        previous: chain.previous,
        angleTolerance: ANGLE_TOLERANCE,
      })
    : [];
  const angle = opts.values.get('angle');
  const free = withoutLocked(inferred, {
    direction: angle !== undefined,
    size: opts.values.has('length'),
  });
  if (angle !== undefined) {
    const typedAxis = axisOfAngle(angle);
    return { kind: 'line', target, close, existing: null, inferences: free, typedAxis };
  }
  const { axis } = opts;
  const inferences: readonly LineInference[] =
    axis === null || free.some((i) => i.kind === axis) ? free : [{ kind: axis }, ...free];
  return { kind: 'line', target, close, existing: null, inferences, typedAxis: null };
}

/**
 * The required constraints of the locked fields of a new line (spec 12, M32): `length` → the
 * distance of its points; the angle → typedAxis, or for an angle off the axes with a previous
 * line of the chain the angle dimension between the previous and the new line with the measured
 * value (between the rays from their common point; none for collinear lines). `data` holds the
 * new line.
 */
function typedConstraints(
  ctx: ToolContext,
  data: SketchData,
  chain: Chain,
  line: Extract<SketchEntity, { kind: 'line' }>,
  typedAxis: AxisKind | null,
  values: ReadonlyMap<string, number>,
): readonly SketchConstraint[] {
  const out: SketchConstraint[] = [];
  const length = values.get('length');
  if (length !== undefined) {
    out.push({ kind: 'distance', id: newConstraintId(ctx), a: line.p1, b: line.p2, value: length });
  }
  if (typedAxis !== null) {
    out.push({ kind: typedAxis, id: newConstraintId(ctx), line: line.id });
  } else if (values.has('angle')) {
    const angle = angleToPrevious(ctx, data, chain, line);
    if (angle !== null) out.push(angle);
  }
  return out;
}

/**
 * The angle dimension between the previous line of the chain and the new line `line` (it starts
 * at the last point of the chain): the previous line reversed when it ends there, so both rays go
 * from that point. null without a previous line or for collinear lines (no valid angle).
 */
function angleToPrevious(
  ctx: ToolContext,
  data: SketchData,
  chain: Chain,
  line: Extract<SketchEntity, { kind: 'line' }>,
): SketchConstraint | null {
  const previous = data.entities.find((e) => e.id === chain.previous);
  if (previous?.kind !== 'line') return null;
  const reverseA: { reverseA?: true } = previous.p2 === line.p1 ? { reverseA: true } : {};
  const draft = {
    kind: 'angle',
    id: newConstraintId(ctx),
    a: previous.id,
    b: line.id,
    value: 0,
    ...reverseA,
  } as const;
  const value = measure(data, draft);
  if (value <= MIN_ANGLE || value >= Math.PI - MIN_ANGLE) return null;
  return { ...draft, value };
}

/** Below this an angle between two lines is degenerate (collinear). */
const MIN_ANGLE = 1e-9;

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
