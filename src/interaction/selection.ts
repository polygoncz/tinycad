// The selection (spec 10, "Výběr"): temporary session state, never stored in the document
// or the log. Items are compared by value; the snapshot holds no duplicates and keeps the
// order in which items were added. Face and edge indices are valid for one regeneration
// only, so a face or edge item carries its topological name from the last snapshot and a new
// generation from RegenStatusPort moves it to the indices of that name (M14, R102); an item
// without a name is removed. Features, bodies and planes stay.

import { ObservableValue, assertNever } from '@/core';
import type { Observable, Unsubscribe } from '@/core';
import type { BodyId, FeatureId, PlaneId, TopoName } from '@/document';
import { isParamVisible, sketchId } from '@/document';
import type { FeatureEditor, FeatureEditSession } from './feature-editor';
import { bodyOfRef, regionRefsOf, topoRefsOf } from './ref-values';
import { nameOfHit } from './regen-status-port';
import type { RegenSnapshot, RegenStatusPort, TopoNames } from './regen-status-port';
import type { HighlightPort, HighlightTarget } from './viewport-port';

export type SelectionItem =
  | { readonly kind: 'feature'; readonly feature: FeatureId }
  | { readonly kind: 'body'; readonly body: BodyId }
  /** name: filled in by the model from RegenBody.names (M14); the caller's one is ignored. */
  | {
      readonly kind: 'face';
      readonly body: BodyId;
      readonly faceIndex: number;
      readonly name?: TopoName;
    }
  | {
      readonly kind: 'edge';
      readonly body: BodyId;
      readonly edgeIndex: number;
      readonly name?: TopoName;
    }
  /** A plane from the Browser: where a new sketch goes (M12). */
  | { readonly kind: 'plane'; readonly plane: PlaneId };

export interface SelectionModel {
  readonly items: Observable<readonly SelectionItem[]>;
  set(items: readonly SelectionItem[]): void;
  toggle(item: SelectionItem): void;
  clear(): void;
  /** Unsubscribes from RegenStatusPort; the selection still works, it just does not follow regenerations. */
  dispose(): void;
}

/** What selection consumers (tools, tree) get: no dispose, that belongs to app. */
export type SelectionCommands = Omit<SelectionModel, 'dispose'>;

/** Same kind, id and index; the name does not count (M14). */
export function sameSelectionItem(a: SelectionItem, b: SelectionItem): boolean {
  switch (a.kind) {
    case 'feature':
      return b.kind === 'feature' && a.feature === b.feature;
    case 'body':
      return b.kind === 'body' && a.body === b.body;
    case 'face':
      return b.kind === 'face' && a.body === b.body && a.faceIndex === b.faceIndex;
    case 'edge':
      return b.kind === 'edge' && a.body === b.body && a.edgeIndex === b.edgeIndex;
    case 'plane':
      return b.kind === 'plane' && a.plane === b.plane;
    default:
      return assertNever(a);
  }
}

const EMPTY: readonly SelectionItem[] = Object.freeze([]);

export function createSelectionModel(deps: { regen: RegenStatusPort }): SelectionModel {
  const items = new ObservableValue<readonly SelectionItem[]>(EMPTY);

  /** Publishes `next` unless it has the same content as the current snapshot. */
  const publish = (next: readonly SelectionItem[]): void => {
    const current = items.get();
    if (sameItems(current, next)) return;
    items.set(next.length === 0 ? EMPTY : Object.freeze(next));
  };

  let generation = deps.regen.state.get().generation;
  const unsubscribe = deps.regen.state.subscribe(() => {
    const snapshot = deps.regen.state.get();
    if (snapshot.generation === generation) return;
    generation = snapshot.generation;
    const current = items.get();
    const next = remapped(current, snapshot);
    // Remapped items are reused when nothing moved, so identity tells a change (names too).
    if (next.length === current.length && next.every((item, i) => item === current[i])) return;
    items.set(next.length === 0 ? EMPTY : Object.freeze(next));
  });

  return {
    items: items.asObservable(),
    set(requested) {
      const current = items.get();
      const snapshot = deps.regen.state.get();
      const next: SelectionItem[] = [];
      for (const item of requested) {
        if (next.some((kept) => sameSelectionItem(kept, item))) continue;
        // Reuse the existing object so unchanged items stay identical in the new snapshot.
        next.push(
          current.find((old) => sameSelectionItem(old, item)) ?? frozenCopy(item, snapshot),
        );
      }
      publish(next);
    },
    toggle(item) {
      const current = items.get();
      const without = current.filter((old) => !sameSelectionItem(old, item));
      publish(
        without.length < current.length
          ? without
          : [...current, frozenCopy(item, deps.regen.state.get())],
      );
    },
    clear() {
      publish(EMPTY);
    },
    dispose() {
      unsubscribe();
    },
  };
}

/**
 * The selection after a new regeneration (R102): a named face or edge becomes the items for all
 * indices of its name in its body, in place and ascending; one without a name, without its body
 * or with a vanished name is dropped; others stay. Duplicates are dropped, the first one wins.
 * An item whose index and name did not change is the same object.
 */
function remapped(current: readonly SelectionItem[], snapshot: RegenSnapshot): SelectionItem[] {
  const next: SelectionItem[] = [];
  const add = (item: SelectionItem): void => {
    if (!next.some((kept) => sameSelectionItem(kept, item))) next.push(item);
  };
  for (const item of current) {
    if (item.kind !== 'face' && item.kind !== 'edge') {
      add(item);
      continue;
    }
    const { name } = item;
    const names = namesOf(snapshot, item.body);
    if (name === undefined || names === undefined) continue;
    if (item.kind === 'face') {
      for (const faceIndex of names.faces(name)) {
        add(
          faceIndex === item.faceIndex
            ? item
            : Object.freeze({ kind: 'face', body: item.body, faceIndex, name }),
        );
      }
    } else {
      for (const edgeIndex of names.edges(name)) {
        add(
          edgeIndex === item.edgeIndex
            ? item
            : Object.freeze({ kind: 'edge', body: item.body, edgeIndex, name }),
        );
      }
    }
  }
  return next;
}

function namesOf(snapshot: RegenSnapshot, body: BodyId): TopoNames | undefined {
  return snapshot.bodies.find((b) => b.body === body)?.names;
}

/**
 * Mirrors the face/edge/body items of the selection into the highlight (body: M14, R104); returns
 * the unbinding. With `editor` (M13, R76) the references of the visible params of the open session
 * follow, in the order of the schema: regions as { kind: 'sketchRegion', sketch:
 * sketchId(ref.sketch), region } (the drawing of a regenerated sketch has the id of its artifact)
 * and, with `regen` too (M14), topo references as the faces or edges of their name in the last
 * snapshot and bodies as body targets. Duplicate targets are left out, the first one wins.
 */
export function bindSelectionHighlight(
  selection: SelectionModel,
  highlight: HighlightPort,
  editor?: Pick<FeatureEditor, 'current'>,
  regen?: RegenStatusPort,
): Unsubscribe {
  const sync = (): void => {
    const session = editor?.current.get() ?? null;
    highlight.setSelection(
      withoutDuplicates([
        ...selection.items.get().flatMap(toHighlightTarget),
        ...(session === null ? [] : paramTargetsOf(session, regen?.state.get())),
      ]),
    );
  };

  let unsubscribeSession: Unsubscribe | null = null;
  const followSession = (): void => {
    unsubscribeSession?.();
    const session = editor?.current.get() ?? null;
    unsubscribeSession = session === null ? null : session.state.subscribe(sync);
    sync();
  };

  const unsubscribeItems = selection.items.subscribe(sync);
  const unsubscribeEditor = editor?.current.subscribe(followSession);
  // Only the dialog reads the snapshot: without an editor a regeneration changes nothing here.
  const unsubscribeRegen = editor === undefined ? undefined : regen?.state.subscribe(sync);
  followSession();
  return () => {
    unsubscribeItems();
    unsubscribeEditor?.();
    unsubscribeRegen?.();
    unsubscribeSession?.();
    unsubscribeSession = null;
  };
}

/**
 * The references in the values of the visible params of an open session, in schema order:
 * regions always, topo and bodies only with a snapshot (M14).
 */
function paramTargetsOf(
  session: FeatureEditSession,
  snapshot: RegenSnapshot | undefined,
): HighlightTarget[] {
  const { open, params } = session.state.get();
  if (!open) return [];
  return Object.entries(session.schema.params).flatMap(([name, spec]): HighlightTarget[] => {
    if (!isParamVisible(spec, params)) return [];
    const value = params[name];
    switch (spec.kind) {
      case 'region':
        return regionTargets(value);
      case 'topo':
        return snapshot === undefined ? [] : topoTargets(value, spec.entity, snapshot);
      case 'bodies':
        return snapshot === undefined ? [] : bodyTargets(value);
      default:
        return [];
    }
  });
}

/**
 * Topo references of an unchecked value as the faces or edges of their name in the body of the
 * last snapshot, ascending; an unresolved reference and vertices (R101) give nothing.
 */
function topoTargets(
  value: unknown,
  entity: 'face' | 'edge' | 'vertex',
  snapshot: RegenSnapshot,
): HighlightTarget[] {
  return topoRefsOf(value).flatMap(({ body, name }): HighlightTarget[] => {
    const names = namesOf(snapshot, body);
    if (names === undefined) return [];
    switch (entity) {
      case 'face':
        return names.faces(name).map((faceIndex) => ({ kind: 'face', body, faceIndex }));
      case 'edge':
        return names.edges(name).map((edgeIndex) => ({ kind: 'edge', body, edgeIndex }));
      case 'vertex':
        return [];
      default:
        return assertNever(entity);
    }
  });
}

/** Body references of an unchecked value as body targets; render drops bodies it does not show. */
function bodyTargets(value: unknown): HighlightTarget[] {
  const items: readonly unknown[] = Array.isArray(value) ? value : [];
  return items.flatMap((item): HighlightTarget[] => {
    const body = bodyOfRef(item);
    return body === null ? [] : [{ kind: 'body', body }];
  });
}

/** The targets without repeats, in order; the first one wins. */
function withoutDuplicates(targets: readonly HighlightTarget[]): HighlightTarget[] {
  const seen = new Set<string>();
  return targets.filter((target) => {
    const key = targetKey(target);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Kind and identifying fields; JSON keeps ids with any characters apart. */
function targetKey(target: HighlightTarget): string {
  switch (target.kind) {
    case 'face':
      return JSON.stringify([target.kind, target.body, target.faceIndex]);
    case 'edge':
      return JSON.stringify([target.kind, target.body, target.edgeIndex]);
    case 'sketchEntity':
      return JSON.stringify([target.kind, target.sketch, target.entity]);
    case 'sketchRegion':
      return JSON.stringify([target.kind, target.sketch, target.region]);
    case 'body':
      return JSON.stringify([target.kind, target.body]);
    default:
      return assertNever(target);
  }
}

/** Region references of an unchecked value; items of another shape are skipped. */
function regionTargets(value: unknown): HighlightTarget[] {
  // regionRefsOf only lets through owners that sketchId accepts.
  return regionRefsOf(value).map(({ sketch, region }) => ({
    kind: 'sketchRegion',
    sketch: sketchId(sketch),
    region,
  }));
}

function sameItems(a: readonly SelectionItem[], b: readonly SelectionItem[]): boolean {
  return (
    a.length === b.length &&
    a.every((item, i) => {
      const other = b[i];
      return other !== undefined && sameSelectionItem(item, other);
    })
  );
}

/**
 * A frozen item with only the fields of its kind, never shared with the caller. A face or an edge
 * gets its name from the snapshot, never the caller's one; without one it has no name field.
 */
function frozenCopy(item: SelectionItem, snapshot: RegenSnapshot): SelectionItem {
  switch (item.kind) {
    case 'feature':
      return Object.freeze({ kind: 'feature', feature: item.feature });
    case 'body':
      return Object.freeze({ kind: 'body', body: item.body });
    case 'face': {
      const { body, faceIndex } = item;
      const name = nameOfHit(snapshot, body, 'face', faceIndex);
      return Object.freeze(
        name === undefined
          ? { kind: 'face', body, faceIndex }
          : { kind: 'face', body, faceIndex, name },
      );
    }
    case 'edge': {
      const { body, edgeIndex } = item;
      const name = nameOfHit(snapshot, body, 'edge', edgeIndex);
      return Object.freeze(
        name === undefined
          ? { kind: 'edge', body, edgeIndex }
          : { kind: 'edge', body, edgeIndex, name },
      );
    }
    case 'plane':
      return Object.freeze({ kind: 'plane', plane: item.plane });
    default:
      return assertNever(item);
  }
}

function toHighlightTarget(item: SelectionItem): HighlightTarget[] {
  switch (item.kind) {
    case 'face':
      return [{ kind: 'face', body: item.body, faceIndex: item.faceIndex }];
    case 'edge':
      return [{ kind: 'edge', body: item.body, edgeIndex: item.edgeIndex }];
    case 'body':
      // M14 (R104): the whole body.
      return [{ kind: 'body', body: item.body }];
    case 'feature':
    case 'plane':
      // Highlighting whole features and planes comes when needed (spec 10).
      return [];
    default:
      return assertNever(item);
  }
}
