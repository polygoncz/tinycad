// refPick (spec 10, "Referenční parametr dialogu", Q066): while a dialog has a focused
// reference param, ToolManager hands the viewport events to this inner tool instead of
// the active one. A click fills the param, Escape drops the focus. It is not a
// registered tool: the manager creates it for the session and drops it again.
// The focused param decides what can be picked (pickFilterFor), for the click and the hover.

import type { ParamSpec } from '@/document';
import type { FeatureEditSession } from './feature-editor';
import { isPlainEscape } from './key-events';
import { toggleBodyRef } from './ref-values';
import { CLICK_TOLERANCE_PX } from './select-tool';
import type {
  PickFilter,
  PickResult,
  ViewKeyEvent,
  ViewPointerEvent,
  ViewportPort,
} from './viewport-port';

type TopoEntity = Extract<ParamSpec, { readonly kind: 'topo' }>['entity'];

const NOTHING: PickFilter = Object.freeze([]);
/** A hit on a face or an edge of a body is the body. */
const FACES_AND_EDGES: PickFilter = Object.freeze(['face', 'edge']);
const FACES: PickFilter = Object.freeze(['face']);
const EDGES: PickFilter = Object.freeze(['edge']);
const TOPO_FILTERS: Readonly<Record<TopoEntity, PickFilter>> = Object.freeze({
  face: FACES,
  edge: EDGES,
  // pick returns no vertices until M14.
  vertex: NOTHING,
});

/**
 * What a click into a param of this spec can pick (spec 10, "Referenční parametr dialogu").
 * Sketch regions (region) are not pickable yet; value params pick nothing.
 */
export function pickFilterFor(spec: ParamSpec): PickFilter {
  switch (spec.kind) {
    case 'bodies':
      return FACES_AND_EDGES;
    case 'topo':
      return TOPO_FILTERS[spec.entity];
    // planes: picked in the Browser, not in the view (M12).
    default:
      return NOTHING;
  }
}

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
    const hit = pickAt(e.x, e.y);
    if (hit !== null) pickInto(hit);
  }

  /** pick with the filter of the focused param; an empty filter does not ask the viewport. */
  function pickAt(x: number, y: number): PickResult | null {
    const name = session.state.get().activeRefParam;
    const spec = name === null ? undefined : session.schema.params[name];
    const filter = spec === undefined ? NOTHING : pickFilterFor(spec);
    return filter.length === 0 ? null : viewport.pick(x, y, filter);
  }

  /** Converts the hit into a reference of the focused param; M9 knows bodies only. */
  function pickInto(hit: PickResult): void {
    const state = session.state.get();
    const name = state.activeRefParam;
    if (name === null) return;
    // topo and region need topological naming and sketches (M13/M14). The filter of bodies has
    // no 'sketchEntity'; the check only narrows the type.
    if (session.schema.params[name]?.kind !== 'bodies' || hit.kind === 'sketchEntity') return;
    session.setParam(name, toggleBodyRef(state.params[name], hit.body));
  }

  return {
    onPointer(e) {
      switch (e.type) {
        case 'move':
          viewport.highlight.setHover(pickAt(e.x, e.y));
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
