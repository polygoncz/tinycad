// Debugging the topological names (spec 10, "Ladění jmen: TopoInspector"; spec 08, "Ladění"; R111):
// the name of the face or edge under the cursor. It listens to the viewport on its own, outside
// the tools, so it never changes the selection or the hover; when enabled it picks on top of the
// SelectTool, therefore it starts disabled.

import { ObservableValue } from '@/core';
import type { Observable } from '@/core';
import type { BodyId, TopoName } from '@/document';
import { nameOfHit } from './regen-status-port';
import type { RegenStatusPort } from './regen-status-port';
import type { PickResult, ViewPointerEvent, ViewportPort } from './viewport-port';

export interface TopoHover {
  readonly body: BodyId;
  readonly kind: 'face' | 'edge';
  readonly index: number;
  /** The name in the pickable bodies of the last snapshot (M21: pick); null = none. */
  readonly name: TopoName | null;
}

export interface TopoInspector {
  /** Default false. */
  readonly enabled: Observable<boolean>;
  readonly hovered: Observable<TopoHover | null>;
  setEnabled(on: boolean): void;
  /** setEnabled(!enabled): the switch of the debug panel (spec 11). */
  toggle(): void;
  /** Unsubscribes from the events of the viewport and from the port. */
  dispose(): void;
}

/** The viewport as the inspector uses it: its own pointer events and picking. */
export type TopoInspectorViewport = Pick<ViewportPort, 'pick' | 'events'>;

export function createTopoInspector(deps: {
  viewport: TopoInspectorViewport;
  regen: RegenStatusPort;
}): TopoInspector {
  const { viewport, regen } = deps;
  const enabled = new ObservableValue(false);
  const hovered = new ObservableValue<TopoHover | null>(null);

  /** Publishes `next` unless it describes the current hover; snapshots are frozen. */
  const publish = (next: TopoHover | null): void => {
    const current = hovered.get();
    if (next === null || current === null ? next === current : sameHover(current, next)) return;
    hovered.set(next === null ? null : Object.freeze(next));
  };

  /** The hit as a hover with its name from the last snapshot; other hits and misses → null. */
  const hoverOf = (hit: PickResult | null): TopoHover | null => {
    if (hit === null || (hit.kind !== 'face' && hit.kind !== 'edge')) return null;
    const index = hit.kind === 'face' ? hit.faceIndex : hit.edgeIndex;
    const name = nameOfHit(regen.state.get(), hit.body, hit.kind, index) ?? null;
    return { body: hit.body, kind: hit.kind, index, name };
  };

  const setEnabled = (on: boolean): void => {
    enabled.set(on);
    if (!on) publish(null);
  };

  const onPointer = (e: ViewPointerEvent): void => {
    if (!enabled.get()) return;
    if (e.type === 'move') publish(hoverOf(viewport.pick(e.x, e.y)));
    else if (e.type === 'leave') publish(null);
  };

  const unsubscribePointer = viewport.events.on('pointer', onPointer);
  let generation = regen.state.get().generation;
  const unsubscribeRegen = regen.state.subscribe(() => {
    const next = regen.state.get().generation;
    if (next === generation) return;
    generation = next;
    // Indices of the old generation no longer mean the same face or edge.
    publish(null);
  });

  return {
    enabled: enabled.asObservable(),
    hovered: hovered.asObservable(),
    setEnabled,
    toggle() {
      setEnabled(!enabled.get());
    },
    dispose() {
      unsubscribePointer();
      unsubscribeRegen();
    },
  };
}

function sameHover(a: TopoHover, b: TopoHover): boolean {
  return a.body === b.body && a.kind === b.kind && a.index === b.index && a.name === b.name;
}
