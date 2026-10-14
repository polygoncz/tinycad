// refPick (spec 10, "Referenční parametr dialogu", Q066): while a dialog has a focused
// reference param, ToolManager hands the viewport events to this inner tool instead of
// the active one. A click fills the param, Escape drops the focus. It is not a
// registered tool: the manager creates it for the session and drops it again.
// The focused param decides what can be picked (pickFilterFor), for the click and the hover.
// A topo param takes a face or an edge by its name from the last regeneration (M14, R103).

import type { AxisRef, DocumentReader, ParamSpec, SketchEntityRef, TopoRef } from '@/document';
import { ownerOfArtifact, parseAxisId, parseSketchId } from '@/document';
import type { FeatureEditSession } from './feature-editor';
import { isPlainEscape } from './key-events';
import {
  isSketchLine,
  toggleAxisRef,
  toggleBodyRef,
  toggleRegionRef,
  toggleTopoRef,
} from './ref-values';
import type { RegenStatusPort } from './regen-status-port';
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
const SKETCH_REGIONS: PickFilter = Object.freeze(['sketchRegion']);
/** An axis drawing or a line of a sketch drawing (M13). */
const SKETCH_ENTITIES: PickFilter = Object.freeze(['sketchEntity']);
const TOPO_FILTERS: Readonly<Record<TopoEntity, PickFilter>> = Object.freeze({
  face: FACES,
  edge: EDGES,
  // pick returns no vertices (postponed, R101).
  vertex: NOTHING,
});

/**
 * What a click into a param of this spec can pick (spec 10, "Referenční parametr dialogu").
 * Value params pick nothing.
 */
export function pickFilterFor(spec: ParamSpec): PickFilter {
  switch (spec.kind) {
    case 'bodies':
      return FACES_AND_EDGES;
    case 'topo':
      return TOPO_FILTERS[spec.entity];
    case 'region':
      return SKETCH_REGIONS;
    case 'axis':
      return SKETCH_ENTITIES;
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

export function createRefPick(
  session: FeatureEditSession,
  viewport: ViewportPort,
  doc: DocumentReader,
  /** Names of the bodies for topo params (M14); without it a hit into topo adds nothing. */
  regen?: RegenStatusPort,
): RefPick {
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
    const spec = focusedSpec();
    const filter = spec === undefined ? NOTHING : pickFilterFor(spec);
    return filter.length === 0 ? null : viewport.pick(x, y, filter);
  }

  /** The hit as the axis of an 'axis' param, or null when it cannot be one (M13). */
  function axisRefOf(hit: PickResult): AxisRef | SketchEntityRef | null {
    if (hit.kind !== 'sketchEntity') return null;
    const axis = parseAxisId(hit.sketch);
    if (axis !== undefined) return Object.freeze({ kind: 'axis', axis });
    // The drawing of a regenerated sketch has the id of its artifact; the edited one does not.
    const sketch = parseSketchId(hit.sketch);
    if (sketch === undefined) return null;
    const owner = ownerOfArtifact(sketch);
    return isSketchLine(doc, owner, hit.entity)
      ? Object.freeze({ kind: 'sketchEntity', sketch: owner, entity: hit.entity })
      : null;
  }

  /**
   * The hit as a reference of a 'topo' param: the name of the face or edge in the last snapshot
   * (M14); null without regen, without the body in the snapshot or without a name.
   */
  function topoRefOf(hit: PickResult): TopoRef | null {
    if (hit.kind !== 'face' && hit.kind !== 'edge') return null;
    const names = regen?.state.get().bodies.find((b) => b.body === hit.body)?.names;
    const name =
      hit.kind === 'face' ? names?.nameOfFace(hit.faceIndex) : names?.nameOfEdge(hit.edgeIndex);
    return name === undefined ? null : Object.freeze({ kind: 'topo', body: hit.body, name });
  }

  /** The spec of the focused param, undefined without one. */
  function focusedSpec(): ParamSpec | undefined {
    const name = session.state.get().activeRefParam;
    return name === null ? undefined : session.schema.params[name];
  }

  /** The hover of a hit: 'axis' (M13) and 'topo' (M14) params show only hits they can take. */
  function hoverOf(hit: PickResult | null): PickResult | null {
    if (hit === null) return null;
    switch (focusedSpec()?.kind) {
      case 'axis':
        return axisRefOf(hit) === null ? null : hit;
      case 'topo':
        return topoRefOf(hit) === null ? null : hit;
      default:
        return hit;
    }
  }

  /** Converts the hit into a reference of the focused param. */
  function pickInto(hit: PickResult): void {
    const state = session.state.get();
    const name = state.activeRefParam;
    if (name === null) return;
    const value = state.params[name];
    // The filters already allow only the kinds below; the checks narrow the types.
    switch (session.schema.params[name]?.kind) {
      case 'bodies':
        if (hit.kind !== 'face' && hit.kind !== 'edge') return;
        session.setParam(name, toggleBodyRef(value, hit.body));
        return;
      case 'topo': {
        // The filter already allows only the entity of the spec.
        const ref = topoRefOf(hit);
        if (ref !== null) session.setParam(name, toggleTopoRef(value, ref));
        return;
      }
      case 'region': {
        if (hit.kind !== 'sketchRegion') return;
        // Only a regenerated sketch has regions to reference; the edited one does not.
        const sketch = parseSketchId(hit.sketch);
        if (sketch === undefined) return;
        session.setParam(name, toggleRegionRef(value, ownerOfArtifact(sketch), hit.region));
        return;
      }
      case 'axis': {
        const ref = axisRefOf(hit);
        if (ref !== null) session.setParam(name, toggleAxisRef(value, ref));
        return;
      }
      default:
        return;
    }
  }

  return {
    onPointer(e) {
      switch (e.type) {
        case 'move':
          viewport.highlight.setHover(hoverOf(pickAt(e.x, e.y)));
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
