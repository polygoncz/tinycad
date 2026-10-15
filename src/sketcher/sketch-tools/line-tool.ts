// The line tool (spec 10, "Nástroje a akce skicáře"): a polyline. The first click starts a chain,
// each further click adds a line from the last point (one addGeometry); a click on the first point
// of the chain closes and ends it. Lines within 3° of an axis get horizontal / vertical.

import type { Vec2 } from '@/core';
import type { SketchConstraint, SketchEntity, SketchEntityId } from '@/sketch';
import { isPlainEscape } from '@/interaction';
import type { Tool, ToolContext } from '@/interaction';
import type { SketchEditor } from '../sketch-editor';
import type { SketchSession } from '../sketch-session';
import {
  MIN_LENGTH,
  clearPreview,
  clickTool,
  snapGrid,
  distance,
  newConstraintId,
  newEntityId,
  previewPairs,
} from './common';
import { placePoint, snapAt } from './snap';
import type { PlacedPoint } from './snap';

/** A line within this angle of the x or y axis of the plane gets horizontal / vertical. */
const AXIS_TOLERANCE = (3 * Math.PI) / 180;

interface Chain {
  readonly first: PlacedPoint;
  readonly last: PlacedPoint;
  /** What the first point still has to add (written with the first line). */
  readonly pending: PlacedPoint | null;
  readonly lines: number;
}

export function createLineTool(sketches: SketchEditor): Tool {
  let chain: Chain | null = null;

  function end(ctx: ToolContext): void {
    chain = null;
    clearPreview(ctx);
  }

  function addLine(
    ctx: ToolContext,
    session: SketchSession,
    from: PlacedPoint,
    to: PlacedPoint,
    pending: PlacedPoint | null,
  ): void {
    const id = newEntityId(ctx);
    const line: SketchEntity = { kind: 'line', id, p1: from.id, p2: to.id };
    const axis = axisConstraint(ctx, id, from.at, to.at);
    const entities = [...(pending?.entities ?? []), ...to.entities, line];
    const constraints = [
      ...(pending?.constraints ?? []),
      ...to.constraints,
      ...(axis === null ? [] : [axis]),
    ];
    const started = chain;
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
      const target = snapAt(ctx, session, x, y, snapGrid(sketches, mods));
      if (target === null) return;
      previewPairs(ctx, session, [chain.last.at, target.at]);
    },
    onClick(ctx, session, x, y, mods) {
      const target = snapAt(ctx, session, x, y, snapGrid(sketches, mods));
      if (target === null) return;
      if (chain === null) {
        const first = placePoint(ctx, target);
        chain = { first, last: first, pending: first, lines: 0 };
        return;
      }
      const { first, last, pending, lines } = chain;
      if (target.kind === 'point' && target.id === last.id) return;
      if (target.kind === 'point' && target.id === first.id) {
        // Closing needs two lines already, otherwise it would double the only one.
        if (lines < 2) return;
        // The first point is in the sketch already (written with the first line).
        addLine(ctx, session, last, { ...first, entities: [], constraints: [] }, null);
        end(ctx);
        return;
      }
      if (distance(last.at, target.at) <= MIN_LENGTH) return;
      const next = placePoint(ctx, target);
      // The chain moves on before the write, so the next line starts from this point.
      chain = { first, last: next, pending: null, lines: lines + 1 };
      addLine(ctx, session, last, next, pending);
    },
    onKey(ctx, _session, e) {
      if (!isPlainEscape(e) || chain === null) return false;
      end(ctx);
      return true;
    },
  });
}

/** horizontal / vertical for a line within 3° of the x / y axis of the plane, otherwise null. */
function axisConstraint(
  ctx: ToolContext,
  line: SketchEntityId,
  from: Vec2,
  to: Vec2,
): SketchConstraint | null {
  const angle = Math.atan2(Math.abs(to[1] - from[1]), Math.abs(to[0] - from[0]));
  if (angle <= AXIS_TOLERANCE) return { kind: 'horizontal', id: newConstraintId(ctx), line };
  if (angle >= Math.PI / 2 - AXIS_TOLERANCE) {
    return { kind: 'vertical', id: newConstraintId(ctx), line };
  }
  return null;
}
