// The select tool of the sketch (spec 10, "Nástroje a akce skicáře"): the default tool of the
// sketch mode. Hover and selection of entities of the session (not the origin), dragging of points.
// It never calls the session after it closed (a late pointer up after Finish is just dropped).

import type { SketchEntityId } from '@/sketch';
import { isPlainEscape } from '../key-events';
import { CLICK_TOLERANCE_PX } from '../select-tool';
import type { SketchEditor } from '../sketch-editor';
import type { SketchSession } from '../sketch-session';
import type { Tool, ToolContext } from '../tools';
import type { ViewPointerEvent } from '../viewport-port';
import { cursorAt, openSession } from './common';
import { entityAt } from './snap';

/** A left press in progress: where, in which session, on which point (null = not on a point). */
interface Press {
  readonly x: number;
  readonly y: number;
  readonly session: SketchSession;
  readonly point: SketchEntityId | null;
  /** Moved beyond the click tolerance. */
  dragging: boolean;
}

export function createSketchSelectTool(sketches: SketchEditor): Tool {
  let ctx: ToolContext | null = null;
  let press: Press | null = null;

  function onMove(c: ToolContext, session: SketchSession, e: ViewPointerEvent): void {
    session.setHover(entityAt(c, session, e.x, e.y)?.id ?? null);
    const p = press;
    if (p?.session !== session || p.point === null) return;
    if (!p.dragging && Math.hypot(e.x - p.x, e.y - p.y) <= CLICK_TOLERANCE_PX) return;
    p.dragging = true;
    const to = cursorAt(c, session, e.x, e.y);
    if (to !== null) session.drag(p.point, to);
  }

  function onUp(c: ToolContext, session: SketchSession, e: ViewPointerEvent): void {
    const p = press;
    press = null;
    if (p?.session !== session) return;
    if (p.dragging) {
      void session.endDrag();
      return;
    }
    if (Math.hypot(e.x - p.x, e.y - p.y) > CLICK_TOLERANCE_PX) return;
    const entity = entityAt(c, session, e.x, e.y);
    if (entity === null) session.clearSelection();
    else session.select(entity.id, { additive: e.mods.shift });
  }

  return {
    activate(c) {
      ctx = c;
    },
    deactivate() {
      openSession(sketches)?.setHover(null);
      ctx = null;
      press = null;
    },
    onPointer(e) {
      const c = ctx;
      const session = openSession(sketches);
      if (c === null || session === null) {
        press = null;
        return;
      }
      switch (e.type) {
        case 'move':
          onMove(c, session, e);
          return;
        case 'leave':
          session.setHover(null);
          return;
        case 'down':
          if (e.button !== 'left') return;
          press = {
            x: e.x,
            y: e.y,
            session,
            point: pointAt(c, session, e.x, e.y),
            dragging: false,
          };
          return;
        case 'up':
          if (e.button === 'left') onUp(c, session, e);
          return;
      }
    },
    onKey(e) {
      const session = openSession(sketches);
      if (ctx === null || session === null || !isPlainEscape(e)) return false;
      if (session.state.get().selection.length === 0) return false;
      session.clearSelection();
      return true;
    },
  };
}

function pointAt(
  ctx: ToolContext,
  session: SketchSession,
  x: number,
  y: number,
): SketchEntityId | null {
  const entity = entityAt(ctx, session, x, y);
  return entity?.kind === 'point' ? entity.id : null;
}
