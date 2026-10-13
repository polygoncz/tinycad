// refPick (spec 10, "Referenční parametr dialogu", Q066): while a dialog has a focused
// reference param, ToolManager hands the viewport events to this inner tool instead of
// the active one. A click fills the param, Escape drops the focus. It is not a
// registered tool: the manager creates it for the session and drops it again.

import type { BodyId, BodyRef } from '@/document';
import type { FeatureEditSession } from './feature-editor';
import { isPlainEscape } from './key-events';
import { CLICK_TOLERANCE_PX } from './select-tool';
import type { PickResult, ViewKeyEvent, ViewPointerEvent, ViewportPort } from './viewport-port';

export interface RefPick {
  onPointer(e: ViewPointerEvent): void;
  /** true = the event was handled. */
  onKey(e: ViewKeyEvent): boolean;
  /** Clears the hover; the manager drops the tool afterwards. */
  dispose(): void;
}

export function createRefPick(session: FeatureEditSession, viewport: ViewportPort): RefPick {
  /** Position of the last left down, null = no click in progress. */
  let down: { readonly x: number; readonly y: number } | null = null;

  function onUp(e: ViewPointerEvent): void {
    const start = down;
    down = null;
    if (start === null) return;
    if (Math.hypot(e.x - start.x, e.y - start.y) > CLICK_TOLERANCE_PX) return;
    const hit = viewport.pick(e.x, e.y);
    if (hit !== null) pickInto(hit);
  }

  /** Converts the hit into a reference of the focused param; M9 knows bodies only. */
  function pickInto(hit: PickResult): void {
    const state = session.state.get();
    const name = state.activeRefParam;
    if (name === null) return;
    // topo and region need topological naming and sketches (M13/M14).
    if (session.schema.params[name]?.kind !== 'bodies') return;
    session.setParam(name, toggleBody(state.params[name], hit.body));
  }

  return {
    onPointer(e) {
      switch (e.type) {
        case 'move':
          viewport.highlight.setHover(viewport.pick(e.x, e.y));
          return;
        case 'leave':
          viewport.highlight.setHover(null);
          return;
        case 'down':
          if (e.button === 'left') down = { x: e.x, y: e.y };
          return;
        case 'up':
          if (e.button === 'left') onUp(e);
          return;
      }
    },
    onKey(e) {
      if (!isPlainEscape(e)) return false;
      session.focusRefParam(null);
      return true;
    },
    dispose() {
      viewport.highlight.setHover(null);
      down = null;
    },
  };
}

/**
 * Adds the body at the end, or removes it when it is there already. Keeps the order and
 * any other items; a value that is not an array counts as empty.
 */
function toggleBody(value: unknown, body: BodyId): readonly unknown[] {
  const items: readonly unknown[] = Array.isArray(value) ? value : [];
  const isTheBody = (item: unknown): boolean => isBodyRef(item) && item.body === body;
  if (items.some(isTheBody)) return Object.freeze(items.filter((item) => !isTheBody(item)));
  const ref: BodyRef = Object.freeze({ kind: 'body', body });
  return Object.freeze([...items, ref]);
}

function isBodyRef(value: unknown): value is BodyRef {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    value.kind === 'body' &&
    'body' in value
  );
}
