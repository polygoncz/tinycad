// The pattern tools (spec 12, "Zrcadlení a pole (M36)", "Nástroje"): sources → Enter → the axis or
// the centre. The sources are the selection of the session: the points and curves preselected on
// activation, toggled by clicks. Enter either writes the pattern at once (linear) or waits for a
// click on its axis or centre (mirror, circular). The pattern is written by addGeometry as one new
// entity without constraints, becomes the selection (its dimensions show) and the tool starts again.

import { isPatternSource } from '@/sketch';
import type { SketchEntity, SketchEntityId, SketchItemId, SketchPattern } from '@/sketch';
import { isPlainEscape } from '@/interaction';
import type { Tool, ToolContext, ViewKeyEvent } from '@/interaction';
import type { SketchEditor } from '../sketch-editor';
import { sourceBox } from '../sketch-pattern-dimensions';
import type { SketchSession } from '../sketch-session';
import { MIN_LENGTH, clickTool, newEntityId, openSession } from './common';
import { entityAt } from './snap';

/** How a pattern tool ends its sources. */
export type PatternFinish =
  /** Enter writes the pattern built from the sources and the current data. */
  | {
      readonly kind: 'enter';
      readonly build: (
        id: SketchEntityId,
        sources: readonly SketchEntityId[],
        entities: readonly SketchEntity[],
      ) => SketchPattern;
    }
  /** After Enter a click on an entity `accepts` (not a source) writes the pattern built with it. */
  | {
      readonly kind: 'pick';
      readonly accepts: (entity: SketchEntity) => boolean;
      readonly build: (
        id: SketchEntityId,
        sources: readonly SketchEntityId[],
        target: SketchEntityId,
      ) => SketchPattern;
    };

/** Instances of a new linear pattern (spec 12). */
const LINEAR_COUNT = 3;
/** The spacing of a new linear pattern is this × the width of the sources along x. */
const LINEAR_SPACING_FACTOR = 1.5;
/** The spacing of a new linear pattern of sources without width, in mm. */
const LINEAR_FALLBACK_SPACING = 10;
/** Instances of a new circular pattern over the full circle (spec 12). */
const CIRCULAR_COUNT = 4;

export function createLinearPatternTool(sketches: SketchEditor): Tool {
  return createPatternTool(sketches, {
    kind: 'enter',
    build: (id, sources, entities) => ({
      kind: 'linearPattern',
      id,
      sources,
      direction1: { angle: 0, count: LINEAR_COUNT, spacing: defaultSpacing(entities, sources) },
    }),
  });
}

export function createCircularPatternTool(sketches: SketchEditor): Tool {
  return createPatternTool(sketches, {
    kind: 'pick',
    // The origin is no entity of the sketch, so it is never picked here.
    accepts: (e) => e.kind === 'point',
    build: (id, sources, center) => ({
      kind: 'circularPattern',
      id,
      sources,
      center,
      count: CIRCULAR_COUNT,
      angle: 2 * Math.PI,
    }),
  });
}

/** A pattern tool: the sources, then `finish`. */
export function createPatternTool(sketches: SketchEditor, finish: PatternFinish): Tool {
  /** Enter was pressed: the sources are fixed and a click picks the axis or the centre. */
  let picking: readonly SketchEntityId[] | null = null;

  /** Writes the pattern, then selects it once it is in the data; the tool starts again. */
  function write(session: SketchSession, pattern: SketchPattern): void {
    picking = null;
    void session.addGeometry({ entities: [pattern], constraints: [] }).then((ok) => {
      if (ok && session.state.get().open) session.select(pattern.id);
    });
  }

  function onEnter(ctx: ToolContext, session: SketchSession): boolean {
    if (picking !== null) return false;
    const sources = sourcesOf(session);
    if (sources.length === 0) return false;
    if (finish.kind === 'pick') picking = sources;
    else write(session, finish.build(newEntityId(ctx), sources, session.state.get().entities));
    return true;
  }

  const tool = clickTool(sketches, {
    reset() {
      picking = null;
    },
    onClick(ctx, session, x, y) {
      const entity = entityAt(ctx, session, x, y);
      if (entity === null) return;
      const sources = picking;
      if (sources === null) {
        if (isPatternSource(entity)) toggleSource(session, entity.id);
        return;
      }
      if (finish.kind !== 'pick' || !finish.accepts(entity) || sources.includes(entity.id)) return;
      write(session, finish.build(newEntityId(ctx), sources, entity.id));
    },
    onKey(ctx, session, e) {
      if (isPlainEnter(e)) return onEnter(ctx, session);
      if (!isPlainEscape(e)) return false;
      if (picking !== null) {
        picking = null;
        return true;
      }
      if (session.state.get().selection.length === 0) return false;
      session.clearSelection();
      return true;
    },
  });

  return {
    ...tool,
    activate(ctx) {
      tool.activate(ctx);
      const session = openSession(sketches);
      if (session !== null) keepOnly(session, sourcesOf(session));
    },
  };
}

/** The sources: the selected points and curves in selection order. */
function sourcesOf(session: SketchSession): readonly SketchEntityId[] {
  const { entities, selection } = session.state.get();
  const byId = new Map<string, SketchEntity>(entities.map((e) => [e.id, e]));
  return selection.flatMap((id) => {
    const e = byId.get(id);
    return e !== undefined && isPatternSource(e) ? [e.id] : [];
  });
}

/** Toggles a source; whatever else is selected (a pattern just written) leaves the selection. */
function toggleSource(session: SketchSession, id: SketchEntityId): void {
  const sources = sourcesOf(session);
  keepOnly(session, sources);
  session.select(id, { additive: true });
}

/** Narrows the selection to `ids` (a subsequence of it) unless it already is them. */
function keepOnly(session: SketchSession, ids: readonly SketchItemId[]): void {
  const { selection } = session.state.get();
  if (selection.length === ids.length) return;
  session.clearSelection();
  for (const id of ids) session.select(id, { additive: true });
}

/**
 * 1.5 × the width of the defining points of the sources along x (a circle ± its radius), or
 * 10 mm without width (spec 12).
 */
function defaultSpacing(
  entities: readonly SketchEntity[],
  sources: readonly SketchEntityId[],
): number {
  const box = sourceBox(entities, sources);
  const width = box === null ? 0 : box.max[0] - box.min[0];
  return width <= MIN_LENGTH ? LINEAR_FALLBACK_SPACING : LINEAR_SPACING_FACTOR * width;
}

/** Enter without modifiers outside a text field. */
function isPlainEnter(e: ViewKeyEvent): boolean {
  return e.key === 'Enter' && !e.mods.shift && !e.mods.alt && !e.mods.mod && !e.inTextField;
}
