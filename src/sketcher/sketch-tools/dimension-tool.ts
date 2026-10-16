// The dimension tool (spec 12, "Kóty (M28)", "Nástroj Kóta"): a click on an entity or on two
// entities picks the target; then the dimension hangs on the cursor (a preview in
// SketchState.dimensions) and every move places it anew (placeDimension: the kind, the value and
// the placement). A click writes it, the session marks it as editingDimension; Esc drops it.

import { dimensionTarget, placeDimension } from '@/sketch';
import type {
  DimensionTarget,
  SketchConstraint,
  SketchConstraintDraft,
  SketchEntity,
  SketchLine,
} from '@/sketch';
import { isPlainEscape } from '@/interaction';
import type { Tool, ToolContext } from '@/interaction';
import type { SketchEditor } from '../sketch-editor';
import type { SketchSession } from '../sketch-session';
import { clickTool, cursorAt, newConstraintId } from './common';
import { entityAt } from './snap';

/** The work in progress of the tool. */
type Step =
  | { readonly kind: 'idle' }
  /** A point or an xline (M31, it has no length) clicked: waits for the second entity. */
  | { readonly kind: 'point'; readonly point: SketchEntity }
  /**
   * The dimension hangs on the cursor. `line` = the target is one line, so a click on another
   * line or on a point off it still changes the target (spec 12, "Průběh výběru").
   */
  | {
      readonly kind: 'hanging';
      readonly target: DimensionTarget;
      readonly line: SketchLine | null;
    };

const IDLE: Step = Object.freeze({ kind: 'idle' });

export function createDimensionTool(sketches: SketchEditor): Tool {
  let step: Step = IDLE;
  /** The session showing the preview of this tool, so a reset removes it there. */
  let previewOn: SketchSession | null = null;

  function hidePreview(): void {
    const session = previewOn;
    previewOn = null;
    if (session !== null && session.state.get().open) session.previewDimension(null);
  }

  function reset(): void {
    step = IDLE;
    hidePreview();
  }

  /** The dimension of the target for the cursor at px x, y; null = degenerate or no cursor. */
  function draftAt(
    ctx: ToolContext,
    session: SketchSession,
    target: DimensionTarget,
    x: number,
    y: number,
  ): SketchConstraintDraft | null {
    const cursor = cursorAt(ctx, session, x, y);
    if (cursor === null) return null;
    const data = session.state.get();
    // The data may have changed under the hanging dimension (undo): placeDimension needs its entities.
    if (!targetExists(target, data.entities)) return null;
    return placeDimension(target, cursor, data);
  }

  /** Shows the dimension of the target at the cursor, or hides it when there is none. */
  function preview(
    ctx: ToolContext,
    session: SketchSession,
    target: DimensionTarget,
    x: number,
    y: number,
  ): void {
    const draft = draftAt(ctx, session, target, x, y);
    previewOn = session;
    session.previewDimension(draft);
  }

  function hang(
    ctx: ToolContext,
    session: SketchSession,
    target: DimensionTarget,
    line: SketchLine | null,
    x: number,
    y: number,
  ): void {
    step = { kind: 'hanging', target, line };
    preview(ctx, session, target, x, y);
  }

  /** Writes the dimension at the cursor; a degenerate one writes nothing and keeps hanging. */
  function place(
    ctx: ToolContext,
    session: SketchSession,
    target: DimensionTarget,
    x: number,
    y: number,
  ): void {
    const draft = draftAt(ctx, session, target, x, y);
    if (draft === null) {
      session.previewDimension(null);
      return;
    }
    const constraint: SketchConstraint = { ...draft, id: newConstraintId(ctx) };
    step = IDLE;
    // addConstraint clears the preview of the session.
    previewOn = null;
    void session.addConstraint(constraint);
  }

  /**
   * A click without a target: a line or a curve hangs at once, a point or an xline waits for
   * another entity.
   */
  function start(
    ctx: ToolContext,
    session: SketchSession,
    entity: SketchEntity,
    x: number,
    y: number,
  ): void {
    if (entity.kind === 'point' || entity.kind === 'xline') {
      step = { kind: 'point', point: entity };
      return;
    }
    const target = dimensionTarget([entity]);
    if (target === null) return;
    hang(ctx, session, target, entity.kind === 'line' ? entity : null, x, y);
  }

  return clickTool(sketches, {
    reset,
    onMove(ctx, session, x, y) {
      if (step.kind === 'hanging') preview(ctx, session, step.target, x, y);
    },
    onClick(ctx, session, x, y) {
      const entity = entityAt(ctx, session, x, y);
      const current = step;
      switch (current.kind) {
        case 'idle':
          if (entity !== null) start(ctx, session, entity, x, y);
          return;
        case 'point': {
          step = IDLE;
          if (entity === null || entity.id === current.point.id) return;
          const target = dimensionTarget([current.point, entity]);
          // Like before M28: a second entity that makes no pair with the point starts on its own.
          if (target === null) start(ctx, session, entity, x, y);
          else hang(ctx, session, target, null, x, y);
          return;
        }
        case 'hanging': {
          const changed = current.line === null ? null : retarget(current.line, entity);
          if (changed !== null) hang(ctx, session, changed, null, x, y);
          else place(ctx, session, current.target, x, y);
          return;
        }
      }
    },
    onKey(ctx, session, e) {
      if (!isPlainEscape(e) || step.kind === 'idle') return false;
      reset();
      return true;
    },
  });
}

/**
 * The new target when a dimension of one line hangs: another line or an xline (M31) → the angle,
 * a point that is not an end of the line → the distance of the point from the line; anything
 * else → null (place).
 */
function retarget(line: SketchLine, entity: SketchEntity | null): DimensionTarget | null {
  if (entity === null) return null;
  if ((entity.kind === 'line' || entity.kind === 'xline') && entity.id !== line.id) {
    return dimensionTarget([line, entity]);
  }
  if (entity.kind === 'point') return dimensionTarget([line, entity]);
  return null;
}

/** The entities the target names are all in the data. */
function targetExists(target: DimensionTarget, entities: readonly SketchEntity[]): boolean {
  const ids = new Set<string>(entities.map((e) => e.id));
  switch (target.kind) {
    case 'points':
    case 'lines':
      return ids.has(target.a) && ids.has(target.b);
    case 'pointLine':
      return ids.has(target.point) && ids.has(target.line);
    case 'round':
      return ids.has(target.curve);
  }
}
