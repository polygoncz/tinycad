// The Text tool (spec 12, "Text ve skice (M37)", "Nástroj Text"): a click through the snapper is
// the start of the baseline. The tool asks the TextOutliner of the editor for the advance and the
// outlines of the default text, then writes a horizontal construction line of that length and the
// text on it in one addGeometry without constraints (through addDrawn, so the construction mode
// makes the text construction too) and selects the text; the panel then edits it. The tool keeps
// no work in progress, so Escape ends it; it stays for the next text.

import type { SketchEntity, SketchEntityId, SketchText, TextFontId } from '@/sketch';
import type { Tool, ToolContext } from '@/interaction';
import type { SketchEditor } from '../sketch-editor';
import type { SketchSession } from '../sketch-session';
import { addDrawn, clickTool, newEntityId, previewInference, snapMode } from './common';
import { snapAt } from './snap';
import type { SnapTarget } from './snap';

/** The ids of what a click writes. */
interface PlaceIds {
  readonly p1: SketchEntityId;
  readonly p2: SketchEntityId;
  readonly line: SketchEntityId;
  readonly text: SketchEntityId;
}

/** The hint of the only step (spec 12). */
const PLACE_HINT = 'hint.text.place';

/** The string, font and height of a new text (spec 12). */
const DEFAULT_TEXT: Pick<SketchText, 'text' | 'font' | 'height'> = Object.freeze({
  text: 'Text',
  font: 'sans' satisfies TextFontId,
  height: 10,
});

export function createTextTool(sketches: SketchEditor): Tool {
  /** The ctx of the activation, for the hint; null when inactive. */
  let hintCtx: ToolContext | null = null;

  const tool = clickTool(sketches, {
    reset() {
      // No work in progress.
    },
    onMove(ctx, session, x, y, mods) {
      const target = snapAt(ctx, session, x, y, snapMode(sketches, mods));
      if (target === null) return;
      // The text is written without constraints: only the guides of the snap show.
      previewInference(session, target.at, [], target.guides);
    },
    onClick(ctx, session, x, y, mods) {
      const target = snapAt(ctx, session, x, y, snapMode(sketches, mods));
      if (target === null) return;
      // The ids are minted now, in the click; the outlines come later. An existing point under
      // the click is the start of the baseline.
      const ids: PlaceIds = {
        p1: target.point ?? newEntityId(ctx),
        p2: newEntityId(ctx),
        line: newEntityId(ctx),
        text: newEntityId(ctx),
      };
      void place(sketches, session, target, ids);
    },
  });

  return {
    ...tool,
    activate(ctx) {
      tool.activate(ctx);
      hintCtx = ctx;
      hintCtx.setHint({ key: PLACE_HINT });
    },
    deactivate() {
      // A deactivated tool shows no hint (the manager resets it too).
      hintCtx = null;
      tool.deactivate();
    },
  };
}

/**
 * Writes the baseline from the target and the default text on it, then selects the text. An
 * outliner that fails or a session closed meanwhile writes nothing.
 */
async function place(
  sketches: SketchEditor,
  session: SketchSession,
  target: SnapTarget,
  ids: PlaceIds,
): Promise<void> {
  let advance: number;
  let contours: SketchText['contours'];
  try {
    [advance, contours] = await Promise.all([
      sketches.text.advance(DEFAULT_TEXT),
      sketches.text.outline(DEFAULT_TEXT),
    ]);
  } catch {
    return;
  }
  if (!session.state.get().open) return;
  const [x, y] = target.at;
  const entities: SketchEntity[] = [];
  // A new start point at the snapped position, without the inferred constraints: the text is
  // written without any (spec 12).
  if (target.point === null) entities.push({ kind: 'point', id: ids.p1, x, y });
  entities.push(
    { kind: 'point', id: ids.p2, x: x + advance, y },
    { kind: 'line', id: ids.line, p1: ids.p1, p2: ids.p2, construction: true },
    { kind: 'text', id: ids.text, ...DEFAULT_TEXT, baseline: ids.line, contours },
  );
  const written = await addDrawn(session, { entities, constraints: [] });
  if (written && session.state.get().open) session.select(ids.text);
}
