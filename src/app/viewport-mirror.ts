// Mirrors view state of the browser into the viewport (spec 11, "Kompoziční kořen (app)"): the
// document holds visibility and colours of bodies (Q071, M15), the browser holds the visible
// origin planes and axes (M12, M13), and the viewport only applies them. One diff of a map serves
// all four: each change sends only what was added, changed or removed since the last state.

import type { Disposable, Observable } from '@/core';
import { ORIGIN_AXES, ORIGIN_PLANES } from '@/document';
import type { AxisId, BodyId, PlaneId } from '@/document';
import type { SketchDrawing, SketchPort } from '@/interaction';
import { axisDrawing, planeDrawing } from '@/sketcher';

/** Where a mirrored map goes; SketchPort is one as it is. */
export interface MapTarget<K, V> {
  set(key: K, value: V): void;
  remove(key: K): void;
}

/** Where a mirrored set goes. */
export interface SetTarget<K> {
  add(key: K): void;
  remove(key: K): void;
}

export interface ViewportMirror extends Disposable {
  /**
   * Sends the whole current state again, not only the difference: after the target dropped it
   * (the view drops the colour of a body it does not show yet, spec 09). After dispose nothing.
   */
  reapply(): void;
}

/**
 * Applies the current map at once (as a difference from an empty one), then on every change
 * only the difference: a new or changed value → set, a missing key → remove. Values are compared
 * with ===, so the same content in a new map sends nothing.
 */
export function mirrorMap<K, V>(
  source: Observable<ReadonlyMap<K, V>>,
  target: MapTarget<K, V>,
): ViewportMirror {
  return mirror(source, () => source.get(), target);
}

/** mirrorMap for a set: a new key → add, a missing key → remove. */
export function mirrorSet<K>(
  source: Observable<ReadonlySet<K>>,
  target: SetTarget<K>,
): ViewportMirror {
  return mirror(source, () => new Map([...source.get()].map((key) => [key, key])), {
    set: (key) => {
      target.add(key);
    },
    remove: (key) => {
      target.remove(key);
    },
  });
}

/**
 * The view state of the browser in the viewport: hidden bodies, body colours, visible origin
 * planes and axes. reapply applies hiding and colours again, which a sync of new bodies needs;
 * the drawings of planes and axes stay in the view across syncs.
 */
export function bindBrowserView(
  browser: {
    readonly hidden: Observable<ReadonlySet<BodyId>>;
    readonly colors: Observable<ReadonlyMap<BodyId, string>>;
    readonly visiblePlanes: Observable<ReadonlySet<PlaneId>>;
    readonly visibleAxes: Observable<ReadonlySet<AxisId>>;
  },
  viewport: {
    setBodyVisible(body: BodyId, visible: boolean): void;
    setBodyColor(body: BodyId, color: string | null): void;
    readonly sketches: SketchPort;
  },
): ViewportMirror {
  const hidden = mirrorSet(browser.hidden, {
    add: (body) => {
      viewport.setBodyVisible(body, false);
    },
    remove: (body) => {
      viewport.setBodyVisible(body, true);
    },
  });
  const colors = mirrorMap(browser.colors, {
    set: (body, color) => {
      viewport.setBodyColor(body, color);
    },
    remove: (body) => {
      viewport.setBodyColor(body, null);
    },
  });
  // Planes and axes are drawn under their own id; an id that is no origin one is not drawn.
  const planes = mirrorSet(
    browser.visiblePlanes,
    originDrawings(viewport.sketches, (id) => {
      const origin = ORIGIN_PLANES.find((p) => p.id === id);
      return origin === undefined ? undefined : planeDrawing(origin.plane);
    }),
  );
  const axes = mirrorSet(
    browser.visibleAxes,
    originDrawings(viewport.sketches, (id) => {
      const origin = ORIGIN_AXES.find((a) => a.id === id);
      return origin === undefined ? undefined : axisDrawing(origin);
    }),
  );
  const parts = [hidden, colors, planes, axes];
  return {
    reapply() {
      hidden.reapply();
      colors.reapply();
    },
    dispose() {
      for (const part of parts) part.dispose();
    },
  };
}

/** A set target drawing the origin plane or axis of an id; ids without a drawing are skipped. */
function originDrawings<K extends string>(
  sketches: SketchPort,
  drawingOf: (id: K) => SketchDrawing | undefined,
): SetTarget<K> {
  return {
    add: (id) => {
      const drawing = drawingOf(id);
      if (drawing !== undefined) sketches.set(id, drawing);
    },
    remove: (id) => {
      if (drawingOf(id) !== undefined) sketches.remove(id);
    },
  };
}

/** The diff of mirrorMap and mirrorSet over the map `read` gives for the current state. */
function mirror<K, V>(
  source: Observable<unknown>,
  read: () => ReadonlyMap<K, V>,
  target: MapTarget<K, V>,
): ViewportMirror {
  let shown: ReadonlyMap<K, V> = new Map();
  let disposed = false;
  const apply = (): void => {
    const next = read();
    for (const [key, value] of next) {
      if (!shown.has(key) || shown.get(key) !== value) target.set(key, value);
    }
    for (const key of shown.keys()) if (!next.has(key)) target.remove(key);
    shown = next;
  };
  apply();
  const unsubscribe = source.subscribe(apply);
  return {
    reapply() {
      if (disposed) return;
      for (const [key, value] of read()) target.set(key, value);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribe();
    },
  };
}
