// refPick (spec 10, "Referenční parametr dialogu", Q066): while a dialog has a focused
// reference param, the refPick layer of ToolManager takes the viewport events instead of
// the active tool. A click fills the param, Escape drops the focus. It is not a
// registered tool: the layer creates it for the session and drops it again (M20, A4.3).
// The focused param decides what can be picked, what is hovered and what a click writes: the
// table of reference kinds (ref-kinds.ts, M20). A topo param takes a face or an edge by its name
// from the last regeneration (M14, R103), in its pickable bodies (M21, ADR 0025: the input of the
// edited feature, so the index of a hit and its name belong to the same state).

import type { Disposable, Unsubscribe } from '@/core';
import type { DocumentReader, RefParamSpec } from '@/document';
import type { InputLayer } from '../input-layer';
import { isPlainEscape } from '../key-events';
import type { FeatureEditor, FeatureEditSession } from './feature-editor';
import { behaviorOf, isRefParamSpec } from './ref-kinds';
import type { RefHitContext, RefKindBehavior } from './ref-kinds';
import type { RegenStatusPort } from '../regen-status-port';
import { CLICK_TOLERANCE_PX } from '../constants';
import type {
  HighlightPort,
  PickFilter,
  PickResult,
  ViewKeyEvent,
  ViewPointerEvent,
  ViewportPort,
} from '../viewport-port';

const NOTHING: PickFilter = Object.freeze([]);

export interface RefPick {
  onPointer(e: ViewPointerEvent): void;
  /** true = the event was handled. */
  onKey(e: ViewKeyEvent): boolean;
  /** Clears the hover; the manager drops the tool afterwards. */
  dispose(): void;
}

/** The viewport as refPick uses it: picking and the hover. */
export interface RefPickViewport extends Pick<ViewportPort, 'pick'> {
  readonly highlight: Pick<HighlightPort, 'setHover'>;
}

export function createRefPick(
  session: FeatureEditSession,
  viewport: RefPickViewport,
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

  /**
   * pick with the filter of the focused param; an empty filter does not ask the viewport, and
   * neither does the in-between state (inputPending): a hit there is ignored, hover and click.
   */
  function pickAt(x: number, y: number): PickResult | null {
    if (inputPending()) return null;
    const focused = focusedParam();
    const filter = focused === null ? NOTHING : focused.behavior.pickFilter(focused.spec);
    return filter.length === 0 ? null : viewport.pick(x, y, filter);
  }

  /** The focused reference param with its behaviour, null without one. */
  function focusedParam(): {
    readonly name: string;
    readonly spec: RefParamSpec;
    readonly behavior: RefKindBehavior;
  } | null {
    const name = session.state.get().activeRefParam;
    const spec = name === null ? undefined : session.schema.params[name];
    // focusRefParam takes reference params only; the check narrows the type.
    if (name === null || spec === undefined || !isRefParamSpec(spec)) return null;
    return { name, spec, behavior: behaviorOf(spec) };
  }

  /**
   * The in-between state of ADR 0025 (point 4): the pickable bodies are not the input of the
   * session's feature (the final state, or the input of another feature) until the regeneration
   * with the moved bar publishes it, so the index of a hit may not match the name. Without a port
   * there is no snapshot and no names, so nothing to wait for.
   */
  function inputPending(): boolean {
    return regen !== undefined && regen.state.get().pick.feature !== session.featureId;
  }

  /** What turning a hit into a reference reads, as it is now (the last snapshot). */
  function hitContext(): RefHitContext {
    return { doc, snapshot: regen?.state.get() };
  }

  /** The hover of a hit: only what the focused param shows (axis, topo: hits it can take). */
  function hoverOf(hit: PickResult | null): PickResult | null {
    if (hit === null) return null;
    const focused = focusedParam();
    return focused === null || focused.behavior.hovers(hit, hitContext()) ? hit : null;
  }

  /** Converts the hit into a reference of the focused param. */
  function pickInto(hit: PickResult): void {
    const focused = focusedParam();
    if (focused === null) return;
    const value = session.state.get().params[focused.name];
    // The filters already allow only the kinds the param takes.
    const ctx = hitContext();
    const change = focused.behavior.fromHit(hit, value, ctx);
    if (change !== null) session.setParam(focused.name, change.value);
    // hovers = the hit is a reference of the kind, also one already in the value.
    if (focused.behavior.pickEndsFocus && focused.behavior.hovers(hit, ctx)) {
      session.focusRefParam(null);
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

/** The refPick layer: an InputLayer that knows by itself when it covers the tool. */
export interface RefPickLayer extends InputLayer, Disposable {}

/**
 * The layer of refPick for ToolManager (spec 10, M20 A4.3). It follows `features.current` and
 * the state of its session: while the session has a focused reference param, refPick takes
 * every event (the active tool is covered, it gets nothing and stays active); otherwise the
 * layer handles nothing. A key refPick does not handle goes to `unhandledKey`, not to the tool.
 * It shows the shared hover itself, so the tool gets no synthetic leave (`leaveBelow: false`).
 */
export function createRefPickLayer(deps: {
  features: Pick<FeatureEditor, 'current'>;
  viewport: RefPickViewport;
  doc: DocumentReader;
  /** Names of the bodies for topo params (M14); without it a hit into topo adds nothing. */
  regen?: RegenStatusPort;
  /** Keys refPick did not handle while it covers the tool (app: ActionRegistry.handleKey). */
  unhandledKey?: (e: ViewKeyEvent) => boolean;
}): RefPickLayer {
  let session: FeatureEditSession | null = null;
  let unsubscribeSession: Unsubscribe | null = null;
  let refPick: RefPick | null = null;
  /** The focused param of the current session; the hover is cleared when it changes. */
  let refParam: string | null = null;
  let disposed = false;

  /** Creates or drops refPick by the focused reference param of the current session. */
  function syncRefPick(): void {
    const next = session?.state.get().activeRefParam ?? null;
    if (session === null || next === null) {
      dropRefPick();
      refParam = null;
      return;
    }
    refPick ??= createRefPick(session, deps.viewport, deps.doc, deps.regen);
    // Another param may allow other targets: the old hover must not stay (spec 10).
    if (refParam !== null && refParam !== next) deps.viewport.highlight.setHover(null);
    refParam = next;
  }

  function dropRefPick(): void {
    const last = refPick;
    refPick = null;
    last?.dispose();
  }

  function onSessionChanged(): void {
    const next = deps.features.current.get();
    if (next === session) return;
    unsubscribeSession?.();
    unsubscribeSession = null;
    // refPick belongs to the old session.
    dropRefPick();
    session = next;
    if (next !== null) unsubscribeSession = next.state.subscribe(syncRefPick);
    syncRefPick();
  }

  const unsubscribeEditor = deps.features.current.subscribe(onSessionChanged);
  onSessionChanged();

  return {
    leaveBelow: false,
    onPointer(e) {
      if (refPick === null) return false;
      refPick.onPointer(e);
      return true;
    },
    onKey(e) {
      if (refPick === null) return false;
      if (!refPick.onKey(e)) deps.unhandledKey?.(e);
      return true;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribeEditor();
      unsubscribeSession?.();
      unsubscribeSession = null;
      session = null;
      dropRefPick();
    },
  };
}
