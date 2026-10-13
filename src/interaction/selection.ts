// The selection (spec 10, "Výběr"): temporary session state, never stored in the document
// or the log. Items are compared by value; the snapshot holds no duplicates and keeps the
// order in which items were added. Face and edge indices are valid for one regeneration
// only, so a new generation from RegenStatusPort removes them (Q064).

import { ObservableValue, assertNever } from '@/core';
import type { Observable, Unsubscribe } from '@/core';
import type { BodyId, FeatureId } from '@/document';
import type { RegenStatusPort } from './regen-status-port';
import type { HighlightPort, HighlightTarget } from './viewport-port';

export type SelectionItem =
  | { readonly kind: 'feature'; readonly feature: FeatureId }
  | { readonly kind: 'body'; readonly body: BodyId }
  | { readonly kind: 'face'; readonly body: BodyId; readonly faceIndex: number }
  | { readonly kind: 'edge'; readonly body: BodyId; readonly edgeIndex: number };

export interface SelectionModel {
  readonly items: Observable<readonly SelectionItem[]>;
  set(items: readonly SelectionItem[]): void;
  toggle(item: SelectionItem): void;
  clear(): void;
  /** Unsubscribes from RegenStatusPort; the selection still works, it is just not cleared. */
  dispose(): void;
}

/** What selection consumers (tools, tree) get: no dispose, that belongs to app. */
export type SelectionCommands = Omit<SelectionModel, 'dispose'>;

/** Same kind, id and index. */
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
    const next = deps.regen.state.get().generation;
    if (next === generation) return;
    generation = next;
    publish(items.get().filter((item) => item.kind === 'feature' || item.kind === 'body'));
  });

  return {
    items: items.asObservable(),
    set(requested) {
      const current = items.get();
      const next: SelectionItem[] = [];
      for (const item of requested) {
        if (next.some((kept) => sameSelectionItem(kept, item))) continue;
        // Reuse the existing object so unchanged items stay identical in the new snapshot.
        next.push(current.find((old) => sameSelectionItem(old, item)) ?? frozenCopy(item));
      }
      publish(next);
    },
    toggle(item) {
      const current = items.get();
      const without = current.filter((old) => !sameSelectionItem(old, item));
      publish(without.length < current.length ? without : [...current, frozenCopy(item)]);
    },
    clear() {
      publish(EMPTY);
    },
    dispose() {
      unsubscribe();
    },
  };
}

/** Mirrors the face/edge items of the selection into the highlight; returns the unbinding. */
export function bindSelectionHighlight(
  selection: SelectionModel,
  highlight: HighlightPort,
): Unsubscribe {
  const sync = (): void => {
    highlight.setSelection(selection.items.get().flatMap(toHighlightTarget));
  };
  sync();
  return selection.items.subscribe(sync);
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

/** A frozen item with only the fields of its kind, never shared with the caller. */
function frozenCopy(item: SelectionItem): SelectionItem {
  switch (item.kind) {
    case 'feature':
      return Object.freeze({ kind: 'feature', feature: item.feature });
    case 'body':
      return Object.freeze({ kind: 'body', body: item.body });
    case 'face':
      return Object.freeze({ kind: 'face', body: item.body, faceIndex: item.faceIndex });
    case 'edge':
      return Object.freeze({ kind: 'edge', body: item.body, edgeIndex: item.edgeIndex });
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
    case 'feature':
    case 'body':
      // Highlighting whole features and bodies comes when needed (spec 10).
      return [];
    default:
      return assertNever(item);
  }
}
