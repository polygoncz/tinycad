// SelectTool (spec 10, "SelectTool"): the default tool. Hover follows the cursor,
// a left click selects a face or an edge (Shift toggles), Escape clears the selection.
// Right and middle buttons drive the camera, so the tool ignores them.

import { isPlainEscape } from './key-events';
import type { SelectionItem } from './selection';
import type { Tool, ToolContext, ToolDescriptor } from './tools';
import type { PickResult, ViewKeyEvent, ViewPointerEvent } from './viewport-port';

/** A left up farther than this from its down is a drag, not a click. */
export const CLICK_TOLERANCE_PX = 4;

export const SELECT_TOOL: ToolDescriptor = Object.freeze({
  id: 'select',
  // A translation key (ADR 0014): ui translates labels of tools.
  label: 'tool.select',
  icon: 'select',
  group: 'select',
  create: createSelectTool,
});

function createSelectTool(): Tool {
  let ctx: ToolContext | null = null;
  /** Position of the last left down, null = no click in progress. */
  let down: { readonly x: number; readonly y: number } | null = null;

  function onUp(context: ToolContext, e: ViewPointerEvent): void {
    const start = down;
    down = null;
    if (start === null) return;
    if (Math.hypot(e.x - start.x, e.y - start.y) > CLICK_TOLERANCE_PX) return;
    const hit = context.viewport.pick(e.x, e.y);
    if (hit === null) {
      if (!e.mods.shift) context.selection.clear();
      return;
    }
    const item = toSelectionItem(hit);
    if (e.mods.shift) context.selection.toggle(item);
    else context.selection.set([item]);
  }

  return {
    activate(c) {
      ctx = c;
    },
    deactivate() {
      ctx?.viewport.highlight.setHover(null);
      ctx = null;
      down = null;
    },
    onPointer(e) {
      if (ctx === null) return;
      switch (e.type) {
        case 'move':
          ctx.viewport.highlight.setHover(ctx.viewport.pick(e.x, e.y));
          return;
        case 'leave':
          ctx.viewport.highlight.setHover(null);
          return;
        case 'down':
          if (e.button === 'left') down = { x: e.x, y: e.y };
          return;
        case 'up':
          if (e.button === 'left') onUp(ctx, e);
          return;
      }
    },
    onKey(e: ViewKeyEvent) {
      if (ctx === null || !isPlainEscape(e)) return false;
      if (ctx.selection.items.get().length === 0) return false;
      ctx.selection.clear();
      return true;
    },
  };
}

/** Only the fields of the kind; the selection would drop point and normal anyway. */
function toSelectionItem(hit: PickResult): SelectionItem {
  return hit.kind === 'face'
    ? { kind: 'face', body: hit.body, faceIndex: hit.faceIndex }
    : { kind: 'edge', body: hit.body, edgeIndex: hit.edgeIndex };
}
