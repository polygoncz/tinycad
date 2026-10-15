// The line tool (spec 10, "Nástroje a akce skicáře"; spec 12, M26): a polyline. The first click
// starts a chain, each further click adds a line from the last point (one addGeometry); a click on
// the first point of the chain closes and ends it. Every point goes through the snapper and every
// line through inferLine (axis, parallel, perpendicular, tangent, equal with the previous line of
// the chain); Ctrl/Cmd turns the inference off.

import { inferLine } from '@/sketch';
import type {
  LineInference,
  PointInference,
  SketchConstraint,
  SketchEntity,
  SketchEntityId,
} from '@/sketch';
import { isPlainEscape } from '@/interaction';
import type { Tool, ToolContext } from '@/interaction';
import type { SketchEditor } from '../sketch-editor';
import type { SketchSession } from '../sketch-session';
import {
  ANGLE_TOLERANCE,
  MIN_LENGTH,
  clearPreview,
  clickTool,
  distance,
  existingLine,
  newConstraintId,
  newEntityId,
  previewPairs,
  snapMode,
} from './common';
import { placePoint, sessionData, snapAt } from './snap';
import type { PlacedPoint } from './snap';

interface Chain {
  readonly first: PlacedPoint;
  readonly last: PlacedPoint;
  /** What the first point still has to add (written with the first line). */
  readonly pending: PlacedPoint | null;
  readonly lines: number;
  /** The last line of the chain (`previous` of inferLine); null before the first line. */
  readonly previous: SketchEntityId | null;
  /**
   * The entities of the chain, which may not be written yet: the snapper and inferLine see them
   * like the data, so the first point can be hit to close the chain before its write settles.
   */
  readonly entities: readonly SketchEntity[];
}

export function createLineTool(sketches: SketchEditor): Tool {
  let chain: Chain | null = null;

  function end(ctx: ToolContext): void {
    chain = null;
    clearPreview(ctx);
  }

  /**
   * Adds the line from `from` to `to` of the current chain and moves the chain on to `to`. `axis`
   * replaces an alignment of `to` with `from` (one constraint of the line, not of its two points).
   * Two points an existing line already joins get no second line; the chain just moves on.
   */
  function addLine(
    ctx: ToolContext,
    session: SketchSession,
    current: Chain,
    to: PlacedPoint,
    opts: { readonly infer: boolean; readonly axis: AxisKind | null },
  ): void {
    const { last: from, pending } = current;
    const data = sessionData(session, current.entities);
    const existing = existingLine(data, from.id, to.id);
    if (existing !== null) {
      chain = { ...current, last: to, lines: current.lines + 1, previous: existing };
      return;
    }
    const id = newEntityId(ctx);
    const line: SketchEntity = { kind: 'line', id, p1: from.id, p2: to.id };
    const inferred = opts.infer
      ? inferLine({ at: from.at, point: from.id }, to.at, data, {
          previous: current.previous,
          angleTolerance: ANGLE_TOLERANCE,
        })
      : [];
    const { axis } = opts;
    const all: readonly LineInference[] =
      axis === null || inferred.some((i) => i.kind === axis)
        ? inferred
        : [{ kind: axis }, ...inferred];
    const entities = [...(pending?.entities ?? []), ...to.entities, line];
    const constraints = [
      ...(pending?.constraints ?? []),
      ...to.constraints,
      ...all.map((i) => lineConstraint(ctx, id, i)),
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
    },
    onMove(ctx, session, x, y, mods) {
      if (chain === null) return;
      const target = snapAt(ctx, session, x, y, {
        ...snapMode(sketches, mods),
        pending: chain.entities,
      });
      if (target === null) return;
      previewPairs(ctx, session, [chain.last.at, target.at]);
    },
    onClick(ctx, session, x, y, mods) {
      const mode = snapMode(sketches, mods);
      const target = snapAt(ctx, session, x, y, { ...mode, pending: chain?.entities ?? [] });
      if (target === null) return;
      if (chain === null) {
        const first = placePoint(ctx, target);
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
      const current = chain;
      const { first, last } = current;
      if (target.point === last.id) return;
      if (target.point === first.id) {
        // Closing needs two lines already, otherwise it would double the only one.
        if (current.lines < 2) return;
        // The first point is in the sketch already (written with the first line).
        const to = { ...first, entities: [], constraints: [] };
        addLine(ctx, session, current, to, { infer: mode.infer, axis: null });
        end(ctx);
        return;
      }
      if (distance(last.at, target.at) <= MIN_LENGTH) return;
      const { inferred, axis } = alignmentWith(target.inferred, last.id);
      const to = placePoint(ctx, { ...target, inferred });
      addLine(ctx, session, current, to, { infer: mode.infer, axis });
    },
    onKey(ctx, _session, e) {
      if (!isPlainEscape(e) || chain === null) return false;
      end(ctx);
      return true;
    },
  });
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
