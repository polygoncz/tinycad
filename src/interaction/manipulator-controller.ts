// ManipulatorController (spec 10, "ManipulatorController", ADR 0021): computes the handles of the
// feature with an open dialog from its live params and the anchors of the last regeneration,
// mirrors them into ManipulatorPort and turns a drag of a handle into session.setParams. It is a
// layer of events above refPick and the active tool (ToolManager). It never calls ops: the dialog
// holds the transaction (Q069), so OK, Cancel, undo and merging in the log work unchanged.

import type { Disposable, RegistryReader, Unsubscribe } from '@/core';
import type { FeatureEditor, FeatureEditSession } from './feature-editor';
import { angularParam, linearParam, snapValue, unwrapDelta } from './manipulator-drag';
import type { Ray } from './manipulator-drag';
import type { Handle, HandleUnit, ManipulatorDescriptor } from './manipulators';
import type { FeatureAnchors, RegenStatusPort } from './regen-status-port';
import type {
  HandleState,
  HandleView,
  ViewKeyEvent,
  ViewPointerEvent,
  ViewportPort,
} from './viewport-port';

export interface ManipulatorController extends Disposable {
  /** A layer of events for ToolManager; true = the event is handled and goes no further. */
  onPointer(e: ViewPointerEvent): boolean;
  onKey(e: ViewKeyEvent): boolean;
}

/** The label stands this many px right of and below the cursor (spec 10). */
const LABEL_OFFSET_PX = 16;

const NO_VIEWS: readonly HandleView[] = Object.freeze([]);

/** A running drag: the handle and the anchors as they were at the down, frozen for the drag. */
interface Drag {
  readonly session: FeatureEditSession;
  readonly handle: Handle;
  readonly anchors: FeatureAnchors;
  /** Params of the keys of toParams(value₀) before the drag; Escape writes them back. */
  readonly original: Readonly<Record<string, unknown>>;
  /** t₀ of a linear handle, a₀ of an angular one. */
  readonly start: number;
  /** Angular only: the last angle and the unwrapped sum of the steps since the down. */
  prevAngle: number;
  turned: number;
  /** The last snapped value; setParams only when it changes. */
  last: number;
}

export function createManipulatorController(deps: {
  features: Pick<FeatureEditor, 'current'>;
  regen: RegenStatusPort;
  registry: RegistryReader<ManipulatorDescriptor>;
  viewport: Pick<ViewportPort, 'manipulators' | 'screenToRay'>;
  /** Text of the label; ui brings the units and the format (mm, °), see spec 11. */
  formatValue: (value: number, unit: HandleUnit) => string;
}): ManipulatorController {
  const port = deps.viewport.manipulators;

  let session: FeatureEditSession | null = null;
  let unsubscribeSession: Unsubscribe | null = null;
  /** The handles behind the last views and the anchors they were computed from. */
  let shown: readonly Handle[] = [];
  let shownAnchors: FeatureAnchors | null = null;
  let hoverId: string | null = null;
  let drag: Drag | null = null;
  let lastViews: readonly HandleView[] = NO_VIEWS;
  let disposed = false;

  /**
   * The handles of the open session, or null to keep the last views (issues during a drag).
   * Sets shownAnchors to the anchors the handles come from.
   */
  function computeHandles(): readonly Handle[] | null {
    shownAnchors = null;
    if (session === null) return [];
    const state = session.state.get();
    if (!state.open) return [];
    const descriptor = deps.registry.find(session.schema.type);
    if (descriptor === undefined) return [];
    if (state.issues.length > 0) return drag === null ? [] : null;
    // While dragging the anchors of the down hold: a regeneration may fail or lag behind.
    const anchors = drag?.anchors ?? deps.regen.state.get().anchors.get(session.featureId);
    if (anchors === undefined) return [];
    shownAnchors = anchors;
    return descriptor.handles(state.params, anchors);
  }

  /** Recomputes the handles and sends their views when they changed. */
  function sync(): void {
    if (disposed) return;
    // The dialog closed (OK or Cancel) during a drag: it ends without writing.
    if (drag !== null && (drag.session !== session || !session.state.get().open)) {
      drag = null;
      port.setLabel(null);
    }
    const handles = computeHandles();
    if (handles === null) return;
    shown = handles;
    send(Object.freeze(handles.map((h) => toView(h, stateOf(h.id)))));
  }

  function stateOf(id: string): HandleState {
    if (drag?.handle.id === id) return 'active';
    return drag === null && hoverId === id ? 'hover' : 'idle';
  }

  function send(views: readonly HandleView[]): void {
    if (sameViews(views, lastViews)) return;
    lastViews = views;
    port.set(views);
  }

  function onSessionChanged(): void {
    const next = deps.features.current.get();
    if (next === session) return;
    unsubscribeSession?.();
    unsubscribeSession = null;
    session = next;
    hoverId = null;
    if (next !== null) unsubscribeSession = next.state.subscribe(sync);
    sync();
  }

  /** Id of a shown handle under the cursor; the port may still answer for older views. */
  function pickHandle(x: number, y: number): string | null {
    if (shown.length === 0) return null;
    const id = port.pick(x, y);
    return id !== null && shown.some((h) => h.id === id) ? id : null;
  }

  function showLabel(e: ViewPointerEvent, handle: Handle, value: number): void {
    const shownValue = handle.display?.(value) ?? value;
    port.setLabel(
      Object.freeze({
        x: e.x + LABEL_OFFSET_PX,
        y: e.y + LABEL_OFFSET_PX,
        text: deps.formatValue(shownValue, handle.unit),
      }),
    );
  }

  function startDrag(e: ViewPointerEvent): boolean {
    const id = pickHandle(e.x, e.y);
    const handle = shown.find((h) => h.id === id);
    if (session === null || handle === undefined || shownAnchors === null) return false;
    const start = paramOf(handle, deps.viewport.screenToRay(e.x, e.y));
    if (start === null) return false;
    const params = session.state.get().params;
    const keys = Object.keys(handle.toParams(handle.value));
    drag = {
      session,
      handle,
      anchors: shownAnchors,
      original: Object.freeze(Object.fromEntries(keys.map((k) => [k, params[k]]))),
      start,
      prevAngle: start,
      turned: 0,
      last: handle.value,
    };
    hoverId = handle.id;
    sync();
    showLabel(e, handle, handle.value);
    return true;
  }

  function moveDrag(d: Drag, e: ViewPointerEvent): void {
    const raw = rawValue(d, deps.viewport.screenToRay(e.x, e.y));
    // An undefined parameter (a ray along the arrow, a circle seen edge-on): the value stays.
    if (raw === null) return;
    const value = snapValue(raw, d.handle, e.mods.shift);
    if (value !== d.last) {
      d.session.setParams(d.handle.toParams(value));
      d.last = value;
    }
    showLabel(e, d.handle, value);
  }

  function endDrag(): void {
    drag = null;
    port.setLabel(null);
  }

  function onPointer(e: ViewPointerEvent): boolean {
    if (disposed) return false;
    const d = drag;
    if (d !== null) {
      if (e.type === 'move') moveDrag(d, e);
      else if (e.type === 'up' && e.button === 'left') {
        endDrag();
        sync();
        hoverId = pickHandle(e.x, e.y);
        sync();
      }
      // Other buttons, downs and leave (the pointer is captured) are swallowed.
      return true;
    }
    switch (e.type) {
      case 'move':
        hoverId = pickHandle(e.x, e.y);
        sync();
        return hoverId !== null;
      case 'down':
        return e.button === 'left' && startDrag(e);
      case 'leave':
        hoverId = null;
        sync();
        return false;
      case 'up':
        return false;
    }
  }

  function onKey(e: ViewKeyEvent): boolean {
    const d = drag;
    if (disposed || d === null || e.key !== 'Escape') return false;
    endDrag();
    d.session.setParams(d.original);
    sync();
    return true;
  }

  const subscriptions: readonly Unsubscribe[] = [
    deps.features.current.subscribe(onSessionChanged),
    deps.regen.state.subscribe(sync),
  ];
  onSessionChanged();

  return {
    onPointer,
    onKey,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const unsubscribe of subscriptions) unsubscribe();
      unsubscribeSession?.();
      unsubscribeSession = null;
      session = null;
      drag = null;
      shown = [];
      lastViews = NO_VIEWS;
      port.set(NO_VIEWS);
      port.setLabel(null);
    },
  };
}

/** t of a linear handle or the angle of an angular one under the ray; null = undefined. */
function paramOf(handle: Handle, ray: Ray): number | null {
  return handle.kind === 'linear'
    ? linearParam(handle.position, handle.direction, ray)
    : angularParam(handle.center, handle.axis, handle.zero, ray);
}

/** The value of the drag under the ray before snapping; null = the move is ignored. */
function rawValue(d: Drag, ray: Ray): number | null {
  const param = paramOf(d.handle, ray);
  if (param === null) return null;
  if (d.handle.kind === 'linear') return d.handle.value + (param - d.start);
  // Unwrapping across ±π lets a drag go round more than once.
  d.turned += unwrapDelta(d.prevAngle, param);
  d.prevAngle = param;
  return d.handle.value + d.turned;
}

function toView(h: Handle, state: HandleState): HandleView {
  return h.kind === 'linear'
    ? Object.freeze({
        kind: 'linear',
        id: h.id,
        position: h.position,
        direction: h.direction,
        tint: h.tint,
        state,
      })
    : Object.freeze({
        kind: 'angular',
        id: h.id,
        center: h.center,
        axis: h.axis,
        tint: h.tint,
        state,
      });
}

function sameViews(a: readonly HandleView[], b: readonly HandleView[]): boolean {
  return a.length === b.length && a.every((v, i) => sameView(v, b[i]));
}

function sameView(a: HandleView, b: HandleView | undefined): boolean {
  if (b === undefined || a.id !== b.id || a.tint !== b.tint || a.state !== b.state) return false;
  if (a.kind === 'linear') {
    return (
      b.kind === 'linear' && sameVec(a.position, b.position) && sameVec(a.direction, b.direction)
    );
  }
  return b.kind === 'angular' && sameVec(a.center, b.center) && sameVec(a.axis, b.axis);
}

function sameVec(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}
