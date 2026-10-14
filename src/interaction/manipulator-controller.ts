// ManipulatorController (spec 10, "ManipulatorController", ADR 0021, ADR 0022): computes the frame
// of the feature with an open dialog from its live params, the anchors of the last regeneration
// and the mode, mirrors its handles into ManipulatorPort, turns a drag of a handle into
// session.setParams and exposes the HUD (the toolbar of modes and the value field) for ui. It is
// a layer of events above refPick and the active tool (ToolManager). It never calls ops: the
// dialog holds the transaction (Q069), so OK, Cancel, undo and merging in the log work unchanged.

import { ObservableValue, vec3 } from '@/core';
import type { Disposable, Observable, RegistryReader, Unsubscribe, Vec3 } from '@/core';
import type { FeatureEditor, FeatureEditSession } from './feature-editor';
import {
  EDGE_ON_LIMIT,
  angularParam,
  linearParam,
  planarParam,
  pointParam,
  snapValue,
  unwrapDelta,
} from './manipulator-drag';
import type { Ray } from './manipulator-drag';
import type {
  AngularHandle,
  Handle,
  HandleTint,
  HandleUnit,
  LinearHandle,
  ManipulatorDescriptor,
  ManipulatorFrame,
  ManipulatorMode,
  Patch,
  PlanarHandle,
  PointHandle,
} from './manipulators';
import type { FeatureAnchors, RegenStatusPort } from './regen-status-port';
import { CLICK_TOLERANCE_PX } from './select-tool';
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
  /** M19: the HUD for ui; null = no manipulator. */
  readonly hud: Observable<ManipulatorHud | null>;
  /** M19: switches the mode (an id of hud.modes); an unknown id or no manipulator → nothing. */
  setMode(id: string): void;
  /**
   * M19: writes the shown value of a scalar handle from the field of the HUD
   * (value = shown / displayScale, clipped, not snapped); NaN or an infinity → nothing (M19.1).
   */
  setValue(handleId: string, shown: number): void;
}

/** M19: the presentation model of the toolbar of modes and the value field (spec 10, ADR 0022). */
export interface ManipulatorHud {
  /** [] = no toolbar. */
  readonly modes: readonly {
    readonly id: string;
    readonly label: string;
    readonly icon: string;
    readonly active: boolean;
  }[];
  /** frame.center: the toolbar stands right above its projection. */
  readonly center: Vec3;
  readonly field: HudField | null;
}

/** M19: the value field of the last used scalar handle. */
export interface HudField {
  readonly handleId: string;
  /** The kind of the handle: ui picks the offset of the field by it. */
  readonly kind: 'linear' | 'angular';
  /** linear: position, angular: center. */
  readonly at: Vec3;
  /**
   * The unit direction in the world ui moves the field along: linear = direction, angular = zero
   * turned by 45° around axis (the middle of the quarter circle).
   */
  readonly direction: Vec3;
  /** The shown value (value · displayScale). */
  readonly value: number;
  readonly unit: HandleUnit;
  /** ui shows X/Y/Z. */
  readonly tint: HandleTint;
  /** true while dragging (the field only shows), false = editable. */
  readonly dragging: boolean;
}

type ScalarHandle = LinearHandle | AngularHandle;

const NO_VIEWS: readonly HandleView[] = Object.freeze([]);
const NO_MODES: ManipulatorHud['modes'] = Object.freeze([]);

/** What every drag has: the handle and the anchors as they were at the down, frozen for the drag. */
interface DragBase {
  readonly session: FeatureEditSession;
  readonly anchors: FeatureAnchors;
  /** Params of the keys of toParams(value₀) before the drag; Escape writes them back. */
  readonly original: Patch;
}

/** A running drag by the kind of its handle (spec 10, "Matematika tažení"). */
type Drag =
  | (DragBase & {
      readonly kind: 'linear';
      readonly handle: LinearHandle;
      /** t₀ of the arrow. */
      readonly start: number;
      /** The last snapped value; setParams only when it changes. */
      last: number;
    })
  | (DragBase & {
      readonly kind: 'angular';
      readonly handle: AngularHandle;
      /** The last angle and the unwrapped sum of the steps since the down. */
      prevAngle: number;
      turned: number;
      last: number;
    })
  | (DragBase & {
      readonly kind: 'planar';
      readonly handle: PlanarHandle;
      /** (a₀, b₀). */
      readonly start: readonly [number, number];
      last: readonly [number, number];
    })
  | (DragBase & {
      readonly kind: 'point';
      readonly handle: PointHandle;
      /** q₀; the plane of the drag goes through it, perpendicular to the ray of the down. */
      readonly start: Vec3;
      readonly normal: Vec3;
      last: Vec3;
    });

export function createManipulatorController(deps: {
  features: Pick<FeatureEditor, 'current'>;
  regen: RegenStatusPort;
  registry: RegistryReader<ManipulatorDescriptor>;
  viewport: Pick<ViewportPort, 'manipulators' | 'screenToRay' | 'pick'>;
}): ManipulatorController {
  const port = deps.viewport.manipulators;
  const hud = new ObservableValue<ManipulatorHud | null>(null);

  let session: FeatureEditSession | null = null;
  let unsubscribeSession: Unsubscribe | null = null;
  /** The modes of the descriptor of the session and the current mode ('' without a toolbar). */
  let modes: readonly ManipulatorMode[] = [];
  let mode = '';
  /** The frame behind the last views and the anchors it was computed from. */
  let shown: ManipulatorFrame | null = null;
  let shownAnchors: FeatureAnchors | null = null;
  /** The current mode takes clicks on the model (ManipulatorMode.picksPoint) and a frame is shown. */
  let picksPoints = false;
  let hoverId: string | null = null;
  /** Id of the scalar handle the field of the HUD belongs to. */
  let fieldId: string | null = null;
  let drag: Drag | null = null;
  /** A left down off the handles in a mode with pickPoint, waiting for its up. */
  let pendingClick: { readonly x: number; readonly y: number } | null = null;
  let lastViews: readonly HandleView[] = NO_VIEWS;
  let disposed = false;

  function descriptorOf(s: FeatureEditSession): ManipulatorDescriptor | undefined {
    return deps.registry.find(s.schema.type);
  }

  /**
   * The frame of the open session (null = none), or undefined to keep the last state (issues
   * during a drag). Sets shownAnchors and picksPoints for the frame.
   */
  function computeFrame(): ManipulatorFrame | null | undefined {
    shownAnchors = null;
    picksPoints = false;
    if (session === null) return null;
    const state = session.state.get();
    if (!state.open) return null;
    const descriptor = descriptorOf(session);
    if (descriptor === undefined) return null;
    if (state.issues.length > 0) return drag === null ? null : undefined;
    // While dragging the anchors of the down hold: a regeneration may fail or lag behind.
    const anchors = drag?.anchors ?? deps.regen.state.get().anchors.get(session.featureId);
    if (anchors === undefined) return null;
    const frame = descriptor.frame(state.params, anchors, mode);
    if (frame === null) return null;
    shownAnchors = anchors;
    picksPoints = modes.find((m) => m.id === mode)?.picksPoint === true;
    return frame;
  }

  /** Recomputes the frame, sends its views and the HUD when they changed. */
  function sync(): void {
    if (disposed) return;
    // The dialog closed (OK or Cancel) during a drag: it ends without writing.
    if (drag !== null && (drag.session !== session || !session.state.get().open)) drag = null;
    const frame = computeFrame();
    if (frame === undefined) return;
    shown = frame;
    const handles = frame?.handles ?? [];
    send(Object.freeze(handles.map((h) => toView(h, stateOf(h.id)))));
    publishHud(frame);
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

  function publishHud(frame: ManipulatorFrame | null): void {
    if (frame === null) {
      hud.set(null);
      return;
    }
    const field = fieldOf(frame);
    // The field disappears with its handle (another mode, another end type of Extrude).
    if (field === null) fieldId = null;
    const next: ManipulatorHud = Object.freeze({
      modes:
        modes.length > 1
          ? Object.freeze(
              modes.map((m) =>
                Object.freeze({ id: m.id, label: m.label, icon: m.icon, active: m.id === mode }),
              ),
            )
          : NO_MODES,
      center: frame.center,
      field,
    });
    const current = hud.get();
    if (current === null || !sameHud(current, next)) hud.set(next);
  }

  function fieldOf(frame: ManipulatorFrame): HudField | null {
    if (fieldId === null) return null;
    const handle = frame.handles.find((h) => h.id === fieldId);
    if (handle === undefined || !isScalar(handle)) return null;
    return Object.freeze({
      handleId: handle.id,
      kind: handle.kind,
      at: handle.kind === 'linear' ? handle.position : handle.center,
      direction: handle.kind === 'linear' ? handle.direction : quarterMiddle(handle),
      value: handle.value * (handle.displayScale ?? 1),
      unit: handle.unit,
      tint: handle.tint,
      dragging: drag?.handle.id === handle.id,
    });
  }

  function onSessionChanged(): void {
    const next = deps.features.current.get();
    if (next === session) return;
    unsubscribeSession?.();
    unsubscribeSession = null;
    session = next;
    hoverId = null;
    fieldId = null;
    pendingClick = null;
    // A new session starts in the default mode: the first one, '' without modes.
    modes = next === null ? [] : (descriptorOf(next)?.modes ?? []);
    mode = modes[0]?.id ?? '';
    if (next !== null) unsubscribeSession = next.state.subscribe(sync);
    sync();
  }

  /** Id of a shown handle under the cursor; the port may still answer for older views. */
  function pickHandle(x: number, y: number): string | null {
    if (shown === null || shown.handles.length === 0) return null;
    const id = port.pick(x, y);
    return id !== null && shown.handles.some((h) => h.id === id) ? id : null;
  }

  /** A left down on a handle; false = no handle, or its parameter is undefined. */
  function startDrag(handle: Handle, e: ViewPointerEvent): boolean {
    if (session === null || shownAnchors === null) return false;
    const ray = deps.viewport.screenToRay(e.x, e.y);
    const params = session.state.get().params;
    const keys = Object.keys(patchOf(handle));
    const base: DragBase = {
      session,
      anchors: shownAnchors,
      original: Object.freeze(Object.fromEntries(keys.map((k) => [k, params[k]]))),
    };
    const next = beginDrag(base, handle, ray);
    if (next === null) return false;
    drag = next;
    hoverId = handle.id;
    if (isScalar(handle)) fieldId = handle.id;
    sync();
    return true;
  }

  function moveDrag(d: Drag, e: ViewPointerEvent): void {
    const patch = nextPatch(d, deps.viewport.screenToRay(e.x, e.y), e.mods.shift);
    // An undefined parameter (a ray along the arrow, a plane seen edge-on) or the same value.
    if (patch !== null) d.session.setParams(patch);
  }

  /** A click on the model in a mode with pickPoint: the patch of the descriptor, if any. */
  function clickModel(x: number, y: number): void {
    if (session === null || shownAnchors === null) return;
    const descriptor = descriptorOf(session);
    const hit = deps.viewport.pick(x, y, ['face', 'edge']);
    if (descriptor?.pickPoint === undefined || hit === null) return;
    const patch = descriptor.pickPoint(session.state.get().params, shownAnchors, mode, hit.point);
    if (patch !== null) session.setParams(patch);
  }

  function onPointer(e: ViewPointerEvent): boolean {
    if (disposed) return false;
    const d = drag;
    if (d !== null) {
      if (e.type === 'move') moveDrag(d, e);
      else if (e.type === 'up' && e.button === 'left') {
        drag = null;
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
        // In a mode with pickPoint the layers below get no hover over the model either.
        return hoverId !== null || picksPoints;
      case 'down': {
        if (e.button !== 'left') return false;
        const id = pickHandle(e.x, e.y);
        const handle = shown?.handles.find((h) => h.id === id);
        if (handle !== undefined) return startDrag(handle, e);
        if (!picksPoints) return false;
        pendingClick = { x: e.x, y: e.y };
        return true;
      }
      case 'leave':
        hoverId = null;
        sync();
        return false;
      case 'up': {
        const click = pendingClick;
        if (e.button !== 'left' || click === null) return false;
        pendingClick = null;
        // A drag over the model is no click: it writes nothing and goes on.
        if (Math.hypot(e.x - click.x, e.y - click.y) > CLICK_TOLERANCE_PX) return false;
        clickModel(e.x, e.y);
        return true;
      }
    }
  }

  function onKey(e: ViewKeyEvent): boolean {
    const d = drag;
    // Escape with any modifiers: the user may still hold Shift for a fine drag.
    if (disposed || d === null || e.key !== 'Escape') return false;
    drag = null;
    d.session.setParams(d.original);
    sync();
    return true;
  }

  function setMode(id: string): void {
    if (disposed || drag !== null || hud.get() === null || id === mode) return;
    if (!modes.some((m) => m.id === id)) return;
    mode = id;
    hoverId = null;
    fieldId = null;
    pendingClick = null;
    sync();
  }

  function setValue(handleId: string, shownValue: number): void {
    // The field only shows the value while dragging.
    if (disposed || drag !== null || session === null || shown === null) return;
    // NaN or an infinity never reaches the params, whatever ui lets through (M19.1).
    if (!Number.isFinite(shownValue)) return;
    const handle = shown.handles.find((h) => h.id === handleId);
    if (handle === undefined || !isScalar(handle)) return;
    const value = clip(shownValue / (handle.displayScale ?? 1), handle);
    if (value !== handle.value) session.setParams(handle.toParams(value));
  }

  const subscriptions: readonly Unsubscribe[] = [
    deps.features.current.subscribe(onSessionChanged),
    deps.regen.state.subscribe(sync),
  ];
  onSessionChanged();

  return {
    onPointer,
    onKey,
    hud: hud.asObservable(),
    setMode,
    setValue,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const unsubscribe of subscriptions) unsubscribe();
      unsubscribeSession?.();
      unsubscribeSession = null;
      session = null;
      drag = null;
      shown = null;
      pendingClick = null;
      lastViews = NO_VIEWS;
      port.set(NO_VIEWS);
      hud.set(null);
    },
  };
}

function isScalar(h: Handle): h is ScalarHandle {
  return h.kind === 'linear' || h.kind === 'angular';
}

/** The patch of the current value: its keys are the ones Escape restores. */
function patchOf(h: Handle): Patch {
  switch (h.kind) {
    case 'linear':
    case 'angular':
      return h.toParams(h.value);
    case 'planar':
      return h.toParams(h.value);
    case 'point':
      return h.toParams(h.value);
  }
}

/** The drag of the handle under the ray of the down; null = its parameter is undefined. */
function beginDrag(base: DragBase, handle: Handle, ray: Ray): Drag | null {
  switch (handle.kind) {
    case 'linear': {
      const start = linearParam(handle.position, handle.direction, ray);
      if (start === null) return null;
      return { ...base, kind: 'linear', handle, start, last: handle.value };
    }
    case 'angular': {
      const start = angularParam(handle.center, handle.axis, handle.zero, ray);
      if (start === null) return null;
      return { ...base, kind: 'angular', handle, prevAngle: start, turned: 0, last: handle.value };
    }
    case 'planar': {
      const start = planarParam(handle.origin, handle.u, handle.v, ray);
      if (start === null) return null;
      return { ...base, kind: 'planar', handle, start, last: handle.value };
    }
    case 'point': {
      // The plane of the drag is fixed at the down (spec 10): a later viewChanged does not turn it.
      const start = pointParam(handle.position, ray);
      const normal = vec3.normalize(ray.direction);
      return { ...base, kind: 'point', handle, start, normal, last: handle.value };
    }
  }
}

/**
 * The patch for the ray of a move, snapped unless fine; null = the parameter is undefined or the
 * value did not change. Updates the state of the drag.
 */
function nextPatch(d: Drag, ray: Ray, fine: boolean): Patch | null {
  switch (d.kind) {
    case 'linear': {
      const t = linearParam(d.handle.position, d.handle.direction, ray);
      if (t === null) return null;
      const value = snapValue(d.handle.value + (t - d.start), d.handle, fine);
      if (value === d.last) return null;
      d.last = value;
      return d.handle.toParams(value);
    }
    case 'angular': {
      const a = angularParam(d.handle.center, d.handle.axis, d.handle.zero, ray);
      if (a === null) return null;
      // Unwrapping across ±π lets a drag go round more than once.
      d.turned += unwrapDelta(d.prevAngle, a);
      d.prevAngle = a;
      const value = snapValue(d.handle.value + d.turned, d.handle, fine);
      if (value === d.last) return null;
      d.last = value;
      return d.handle.toParams(value);
    }
    case 'planar': {
      const ab = planarParam(d.handle.origin, d.handle.u, d.handle.v, ray);
      if (ab === null) return null;
      const value: readonly [number, number] = [
        snapLength(d.handle.value[0] + (ab[0] - d.start[0]), fine),
        snapLength(d.handle.value[1] + (ab[1] - d.start[1]), fine),
      ];
      if (sameVec(value, d.last)) return null;
      d.last = value;
      return d.handle.toParams(value);
    }
    case 'point': {
      const q = planeHit(d.start, d.normal, ray);
      if (q === null) return null;
      const raw = vec3.add(d.handle.value, vec3.sub(q, d.start));
      const value: Vec3 = [
        snapLength(raw[0], fine),
        snapLength(raw[1], fine),
        snapLength(raw[2], fine),
      ];
      if (sameVec(value, d.last)) return null;
      d.last = value;
      return d.handle.toParams(value);
    }
  }
}

/** Snapping of one component of a planar or point drag (spec 10: unit 'length'). */
function snapLength(value: number, fine: boolean): number {
  return snapValue(value, { unit: 'length' }, fine);
}

/** The intersection of the ray with the plane (point, normal); null for a ray along the plane. */
function planeHit(point: Vec3, normal: Vec3, ray: Ray): Vec3 | null {
  const r = vec3.normalize(ray.direction);
  const cos = vec3.dot(normal, r);
  if (Math.abs(cos) < EDGE_ON_LIMIT) return null;
  const s = vec3.dot(normal, vec3.sub(point, ray.origin)) / cos;
  return vec3.add(ray.origin, vec3.scale(r, s));
}

/** Clips to [min, max] without snapping (the field of the HUD); -0 becomes 0 like snapValue. */
function clip(value: number, h: ScalarHandle): number {
  let v = value;
  if (h.min !== undefined && v < h.min) v = h.min;
  if (h.max !== undefined && v > h.max) v = h.max;
  return v === 0 ? 0 : v;
}

/** zero turned by 45° around axis: the middle of the quarter circle of an angular handle. */
function quarterMiddle(h: AngularHandle): Vec3 {
  const side = vec3.cross(h.axis, h.zero);
  return vec3.add(vec3.scale(h.zero, Math.SQRT1_2), vec3.scale(side, Math.SQRT1_2));
}

function toView(h: Handle, state: HandleState): HandleView {
  const dashed = h.dashed ?? false;
  switch (h.kind) {
    case 'linear':
      return Object.freeze({
        kind: 'linear',
        id: h.id,
        position: h.position,
        direction: h.direction,
        tint: h.tint,
        state,
        dashed,
      });
    case 'angular':
      return Object.freeze({
        kind: 'angular',
        id: h.id,
        center: h.center,
        axis: h.axis,
        zero: h.zero,
        extent: h.extent,
        tint: h.tint,
        state,
        dashed,
      });
    case 'planar':
      return Object.freeze({
        kind: 'planar',
        id: h.id,
        origin: h.origin,
        u: h.u,
        v: h.v,
        tint: h.tint,
        state,
        dashed,
      });
    case 'point':
      return Object.freeze({
        kind: 'point',
        id: h.id,
        position: h.position,
        tint: h.tint,
        state,
        dashed,
      });
  }
}

function sameViews(a: readonly HandleView[], b: readonly HandleView[]): boolean {
  return a.length === b.length && a.every((v, i) => sameView(v, b[i]));
}

function sameView(a: HandleView, b: HandleView | undefined): boolean {
  if (b === undefined || a.id !== b.id || a.tint !== b.tint || a.state !== b.state) return false;
  if (a.dashed !== b.dashed) return false;
  switch (a.kind) {
    case 'linear':
      return (
        b.kind === 'linear' && sameVec(a.position, b.position) && sameVec(a.direction, b.direction)
      );
    case 'angular':
      return (
        b.kind === 'angular' &&
        a.extent === b.extent &&
        sameVec(a.center, b.center) &&
        sameVec(a.axis, b.axis) &&
        sameVec(a.zero, b.zero)
      );
    case 'planar':
      return (
        b.kind === 'planar' && sameVec(a.origin, b.origin) && sameVec(a.u, b.u) && sameVec(a.v, b.v)
      );
    case 'point':
      return b.kind === 'point' && sameVec(a.position, b.position);
  }
}

function sameHud(a: ManipulatorHud, b: ManipulatorHud): boolean {
  return (
    sameVec(a.center, b.center) &&
    a.modes.length === b.modes.length &&
    a.modes.every((m, i) => {
      const n = b.modes[i];
      return (
        n !== undefined &&
        m.id === n.id &&
        m.label === n.label &&
        m.icon === n.icon &&
        m.active === n.active
      );
    }) &&
    sameField(a.field, b.field)
  );
}

function sameField(a: HudField | null, b: HudField | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.handleId === b.handleId &&
    a.kind === b.kind &&
    sameVec(a.at, b.at) &&
    sameVec(a.direction, b.direction) &&
    a.value === b.value &&
    a.unit === b.unit &&
    a.tint === b.tint &&
    a.dragging === b.dragging
  );
}

function sameVec(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}
