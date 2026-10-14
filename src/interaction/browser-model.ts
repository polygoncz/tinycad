// The browser (spec 10, "Prohlížeč"): a presentation model over the bodies of the last
// regeneration, the selection and the body metadata of the document. Name and visibility of a
// body live in the document since M11 (spec 03, "Metadata těles", Q071): changes go through the
// dispatcher, so they are saved and undoable. Since ADR 0015 a BodyId is a lineage (origin
// feature), so the metadata never move over to another body after a history change.
// Since M12 it also lists the origin planes (their visibility is a view state, never saved, R48)
// and the sketches of the last regeneration (no eye: a sketch is shown unless edited).

import { ObservableValue } from '@/core';
import type { Observable, Unsubscribe } from '@/core';
import { ORIGIN_PLANES } from '@/document';
import type { BodyId, DocumentReader, FeatureId, PlaneId, SketchId } from '@/document';
import type { BodyRenameOp, BodySetVisibleOp, OperationDispatcher } from '@/ops';
import { OP_VERSION } from '@/ops';
import type { FeatureEditor } from './feature-editor';
import { toggleBodyRef } from './ref-values';
import type { RegenStatusPort } from './regen-status-port';
import type { SelectionCommands } from './selection';

export interface BrowserBodyRow {
  readonly body: BodyId;
  /** "Body n" by position (1-based); a translation key with the number, translated by ui. */
  readonly name: { readonly key: 'browser.body'; readonly n: number };
  /** The name from the metadata (body.rename); ui shows it in place of the automatic one. */
  readonly userName: string | null;
  /** The feature that made the body (origin). */
  readonly feature: FeatureId;
  /** !doc.bodyMeta(body).hidden */
  readonly visible: boolean;
  /** The selection contains { kind: 'body', body }. */
  readonly selected: boolean;
}

/** An origin plane (M12). */
export interface BrowserPlaneRow {
  readonly plane: PlaneId;
  /** The translation key of the plane ('origin.plane.xy' …), translated by ui. */
  readonly label: string;
  /** In visiblePlanes. */
  readonly visible: boolean;
  /** The selection contains { kind: 'plane', plane }. */
  readonly selected: boolean;
}

/** A sketch of the last regeneration (M12). */
export interface BrowserSketchRow {
  readonly sketch: SketchId;
  readonly feature: FeatureId;
  /** The name of the feature in the document. */
  readonly name: string;
  /** The selection contains { kind: 'feature', feature }. */
  readonly selected: boolean;
}

export interface BrowserModel {
  readonly bodies: Observable<readonly BrowserBodyRow[]>;
  /** Bodies of the last regeneration hidden in the metadata; app → viewport.setBodyVisible */
  readonly hidden: Observable<ReadonlySet<BodyId>>;
  /** Into the active bodies param of the dialog, otherwise → selection.set / toggle */
  select(body: BodyId, opts?: { additive?: boolean }): void;
  /**
   * Visibility and name may change: no transaction (dialog) is open and the document is not
   * read-only (the edit lock, R14). Without it setVisible, beginRename and rename do nothing.
   */
  readonly canEdit: Observable<boolean>;
  /** → dispatch body.setVisible */
  setVisible(body: BodyId, visible: boolean): void;
  /** The body in the rename mode (the inline field of the Browser); null = none. */
  readonly renaming: Observable<BodyId | null>;
  /** Puts a body of the last regeneration into the rename mode. */
  beginRename(body: BodyId): void;
  /** Ends the rename mode without renaming; rename() and the loss of canEdit end it too. */
  cancelRename(): void;
  /**
   * Ends the rename mode and → dispatch body.rename (trimmed; '' removes the name). null = the
   * text did not change (ui compares it with what it filled in): no operation.
   */
  rename(body: BodyId, name: string | null): void;
  /** ORIGIN_PLANES in order (M12). */
  readonly planes: Observable<readonly BrowserPlaneRow[]>;
  /** The shown origin planes: a view state, empty at start, never saved; app → plane drawing. */
  readonly visiblePlanes: Observable<ReadonlySet<PlaneId>>;
  /** The sketches of the last regeneration, in its order (M12). */
  readonly sketches: Observable<readonly BrowserSketchRow[]>;
  /** → selection.set / toggle of the plane item */
  selectPlane(plane: PlaneId, opts?: { additive?: boolean }): void;
  /** Shows or hides an origin plane; another plane id does nothing. */
  setPlaneVisible(plane: PlaneId, visible: boolean): void;
  /** → selection.set / toggle of the feature item */
  selectSketch(feature: FeatureId, opts?: { additive?: boolean }): void;
  /** → deps.sketchEdit; without it nothing. */
  editSketch(feature: FeatureId): void;
  dispose(): void;
}

const EMPTY_ROWS: readonly BrowserBodyRow[] = Object.freeze([]);
const EMPTY_SKETCHES: readonly BrowserSketchRow[] = Object.freeze([]);

export function createBrowserModel(deps: {
  doc: DocumentReader;
  ops: OperationDispatcher;
  regen: RegenStatusPort;
  selection: SelectionCommands;
  editor: Pick<FeatureEditor, 'current'>;
  /** The edit lock (createEditLock): read-only or an open feature dialog. */
  locked: Observable<boolean>;
  /** M12: opens a sketch in the sketcher (SketchEditor.edit). */
  sketchEdit?: (feature: FeatureId) => void;
}): BrowserModel {
  const { doc, ops, regen, selection, editor, locked, sketchEdit } = deps;

  // A Set cannot be frozen; each change publishes a new set that is never mutated again.
  const hidden = new ObservableValue<ReadonlySet<BodyId>>(new Set());
  const rows = new ObservableValue<readonly BrowserBodyRow[]>(EMPTY_ROWS);
  const renaming = new ObservableValue<BodyId | null>(null);
  const visiblePlanes = new ObservableValue<ReadonlySet<PlaneId>>(new Set());
  const planeRows = new ObservableValue<readonly BrowserPlaneRow[]>(buildPlaneRows([]));
  const sketchRows = new ObservableValue<readonly BrowserSketchRow[]>(EMPTY_SKETCHES);
  // Derived from the lock without an own state: it changes exactly when the lock does.
  const canEdit: Observable<boolean> = Object.freeze({
    get: () => !locked.get(),
    subscribe: (fn: () => void): Unsubscribe => locked.subscribe(fn),
  });

  /** The rows from all sources, reusing every unchanged row of `prev`. */
  function buildRows(prev: readonly BrowserBodyRow[]): readonly BrowserBodyRow[] {
    const selected = new Set(
      selection.items.get().flatMap((item) => (item.kind === 'body' ? [item.body] : [])),
    );
    const next = regen.state.get().bodies.map(({ body, feature }, i): BrowserBodyRow => {
      const old = prev[i];
      const meta = doc.bodyMeta(body);
      const row = {
        body,
        feature,
        n: i + 1,
        userName: meta.name ?? null,
        visible: meta.hidden !== true,
        selected: selected.has(body),
      };
      // Rows are matched by position, like the feature tree.
      if (old !== undefined && sameRow(old, row)) return old;
      return Object.freeze({
        body,
        name: Object.freeze({ key: 'browser.body', n: row.n }),
        userName: row.userName,
        feature,
        visible: row.visible,
        selected: row.selected,
      });
    });
    return sameItems(prev, next) ? prev : Object.freeze(next);
  }

  /** Bodies of the last regeneration hidden in the metadata of the document. */
  function buildHidden(): ReadonlySet<BodyId> {
    return new Set(
      regen.state
        .get()
        .bodies.flatMap(({ body }) => (doc.bodyMeta(body).hidden === true ? [body] : [])),
    );
  }

  /** The origin plane rows, reusing every unchanged row of `prev`. */
  function buildPlaneRows(prev: readonly BrowserPlaneRow[]): readonly BrowserPlaneRow[] {
    const selected = new Set(
      selection.items.get().flatMap((item) => (item.kind === 'plane' ? [item.plane] : [])),
    );
    // visiblePlanes is created before the first build, so it can be read here.
    const shown = visiblePlanes.get();
    const next = ORIGIN_PLANES.map(({ id, label }, i): BrowserPlaneRow => {
      const old = prev[i];
      const row = { plane: id, label, visible: shown.has(id), selected: selected.has(id) };
      if (
        old !== undefined &&
        old.plane === row.plane &&
        old.label === row.label &&
        old.visible === row.visible &&
        old.selected === row.selected
      ) {
        return old;
      }
      return Object.freeze(row);
    });
    return sameItems(prev, next) ? prev : Object.freeze(next);
  }

  /**
   * The sketch rows, reusing every unchanged row of `prev`. A sketch whose feature is gone from
   * the document (the next regeneration is on its way) has no name to show, so it is left out.
   */
  function buildSketchRows(prev: readonly BrowserSketchRow[]): readonly BrowserSketchRow[] {
    const selected = new Set(
      selection.items.get().flatMap((item) => (item.kind === 'feature' ? [item.feature] : [])),
    );
    const next = regen.state.get().sketches.flatMap(({ sketch, feature }, i) => {
      const instance = doc.feature(feature);
      if (instance === undefined) return [];
      const old = prev[i];
      const row = { sketch, feature, name: instance.name, selected: selected.has(feature) };
      if (
        old !== undefined &&
        old.sketch === row.sketch &&
        old.feature === row.feature &&
        old.name === row.name &&
        old.selected === row.selected
      ) {
        return [old];
      }
      return [Object.freeze(row)];
    });
    return sameItems(prev, next) ? prev : Object.freeze(next);
  }

  /**
   * hidden, visiblePlanes, bodies, planes, sketches in this order (spec 10); each only when it
   * changed. `shown` is the new set of visible planes (setPlaneVisible), otherwise the current.
   */
  function refresh(shown: ReadonlySet<PlaneId> = visiblePlanes.get()): void {
    const next = buildHidden();
    const current = hidden.get();
    if (next.size !== current.size || [...next].some((body) => !current.has(body))) {
      hidden.set(next);
    }
    visiblePlanes.set(shown);
    rows.set(buildRows(rows.get()));
    planeRows.set(buildPlaneRows(planeRows.get()));
    sketchRows.set(buildSketchRows(sketchRows.get()));
  }

  /** Editing is allowed, the last regeneration knows the body and no transaction is running. */
  function canChange(body: BodyId): boolean {
    return (
      canEdit.get() && !ops.inTransaction && regen.state.get().bodies.some((b) => b.body === body)
    );
  }

  const unsubscribes: readonly Unsubscribe[] = [
    // Wrapped: refresh takes an optional plane set, not the event of the source.
    regen.state.subscribe(() => {
      refresh();
    }),
    selection.items.subscribe(() => {
      refresh();
    }),
    doc.events.on('changed', () => {
      refresh();
    }),
    // The dialog opening (or the document being read-only) ends the rename without a change.
    locked.subscribe(() => {
      if (!canEdit.get()) renaming.set(null);
    }),
  ];
  refresh();

  return {
    bodies: rows.asObservable(),
    hidden: hidden.asObservable(),
    planes: planeRows.asObservable(),
    visiblePlanes: visiblePlanes.asObservable(),
    sketches: sketchRows.asObservable(),
    canEdit,
    renaming: renaming.asObservable(),
    select(body, opts) {
      // An open dialog with a focused bodies param takes the body instead of the selection (R19).
      const session = editor.current.get();
      const state = session?.state.get();
      const name = state?.open === true ? state.activeRefParam : null;
      if (session !== null && state !== undefined && name !== null) {
        if (session.schema.params[name]?.kind === 'bodies') {
          session.setParam(name, toggleBodyRef(state.params[name], body));
          return;
        }
      }
      const item = { kind: 'body', body } as const;
      if (opts?.additive === true) selection.toggle(item);
      else selection.set([item]);
    },
    setVisible(body, visible) {
      if (!canChange(body)) return;
      if ((doc.bodyMeta(body).hidden !== true) === visible) return;
      const op: BodySetVisibleOp = {
        type: 'body.setVisible',
        v: OP_VERSION['body.setVisible'],
        body,
        visible,
      };
      ops.dispatch(op);
    },
    beginRename(body) {
      if (canChange(body)) renaming.set(body);
    },
    cancelRename() {
      renaming.set(null);
    },
    rename(body, name) {
      // The inline field is done whatever happens to the name.
      renaming.set(null);
      if (name === null || !canChange(body)) return;
      const trimmed = name.trim();
      if (trimmed === (doc.bodyMeta(body).name ?? '')) return;
      const op: BodyRenameOp = {
        type: 'body.rename',
        v: OP_VERSION['body.rename'],
        body,
        name: trimmed,
      };
      ops.dispatch(op);
    },
    selectPlane(plane, opts) {
      const item = { kind: 'plane', plane } as const;
      if (opts?.additive === true) selection.toggle(item);
      else selection.set([item]);
    },
    setPlaneVisible(plane, visible) {
      // Only the origin planes have a row; the view state never touches the document (R48).
      if (!ORIGIN_PLANES.some((p) => p.id === plane)) return;
      const current = visiblePlanes.get();
      if (current.has(plane) === visible) return;
      // A Set cannot be frozen; a new set each change, never mutated after.
      const next = new Set(current);
      if (visible) next.add(plane);
      else next.delete(plane);
      refresh(next);
    },
    selectSketch(feature, opts) {
      const item = { kind: 'feature', feature } as const;
      if (opts?.additive === true) selection.toggle(item);
      else selection.set([item]);
    },
    editSketch(feature) {
      sketchEdit?.(feature);
    },
    dispose() {
      for (const unsubscribe of unsubscribes) unsubscribe();
    },
  };
}

/** Same length and the same objects at every position. */
function sameItems<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && b.every((item, i) => item === a[i]);
}

function sameRow(
  a: BrowserBodyRow,
  b: {
    readonly body: BodyId;
    readonly feature: FeatureId;
    readonly n: number;
    readonly userName: string | null;
    readonly visible: boolean;
    readonly selected: boolean;
  },
): boolean {
  return (
    a.body === b.body &&
    a.feature === b.feature &&
    a.name.n === b.n &&
    a.userName === b.userName &&
    a.visible === b.visible &&
    a.selected === b.selected
  );
}
