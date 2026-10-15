// The dimension tool (spec 10, "Nástroje a akce skicáře"): a click on a line → distance of its
// points, on a circle or an arc → radius, on a point and then another point → their distance. The
// value is measured (dimensionFor); the session marks the new dimension as editingDimension.

import { dimensionFor } from '@/sketch';
import type { SketchConstraint, SketchEntity } from '@/sketch';
import type { Tool, ToolContext } from '@/interaction';
import type { SketchEditor } from '../sketch-editor';
import type { SketchSession } from '../sketch-session';
import { clickTool, newConstraintId } from './common';
import { entityAt } from './snap';

export function createDimensionTool(sketches: SketchEditor): Tool {
  /** The first point of a point-to-point dimension. */
  let first: SketchEntity | null = null;

  function add(ctx: ToolContext, session: SketchSession, selected: readonly SketchEntity[]): void {
    const draft = dimensionFor(selected, session.state.get());
    if (draft === null) return;
    const constraint: SketchConstraint = { ...draft, id: newConstraintId(ctx) };
    void session.addConstraint(constraint);
  }

  return clickTool(sketches, {
    reset() {
      first = null;
    },
    onClick(ctx, session, x, y) {
      const entity = entityAt(ctx, session, x, y);
      const start = first;
      first = null;
      if (entity === null) return;
      if (entity.kind !== 'point') {
        add(ctx, session, [entity]);
        return;
      }
      if (start === null) first = entity;
      else if (start.id !== entity.id) add(ctx, session, [start, entity]);
    },
  });
}
