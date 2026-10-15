// SelectTool (spec 10, "SelectTool"): the default tool. Hover follows the cursor,
// a left click selects a face or an edge (Shift toggles), Escape clears the selection.
// Right and middle buttons drive the camera, so the tool ignores them. Sketch entities (M12)
// and sketch regions (M13) are not its business: it never asks for them and ignores such a hit.

import { CLICK_TOLERANCE_PX } from './constants';
import { isPlainEscape } from './key-events';
import type { SelectionItem } from './selection';
import type { Tool, ToolContext, ToolDescriptor, ToolViewport } from './tools';
import type { PickResult, ViewKeyEvent, ViewPointerEvent } from './viewport-port';

/** A hit of a body: what the select tool works with. */
type BodyHit = Extract<PickResult, { readonly kind: 'face' | 'edge' }>;

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
    const hit = pickBody(context.viewport, e.x, e.y);
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
          ctx.viewport.highlight.setHover(pickBody(ctx.viewport, e.x, e.y));
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

/**
 * pick with the default filter (faces and edges). A sketch entity or region cannot come back
 * from it; if a viewport returns one anyway, it counts as nothing hit.
 */
function pickBody(viewport: ToolViewport, x: number, y: number): BodyHit | null {
  const hit = viewport.pick(x, y);
  return hit !== null && (hit.kind === 'face' || hit.kind === 'edge') ? hit : null;
}

/** Only the fields of the kind; the selection would drop point and normal anyway. */
function toSelectionItem(hit: BodyHit): SelectionItem {
  return hit.kind === 'face'
    ? { kind: 'face', body: hit.body, faceIndex: hit.faceIndex }
    : { kind: 'edge', body: hit.body, edgeIndex: hit.edgeIndex };
}
