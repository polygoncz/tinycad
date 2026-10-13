// The browser (spec 10, "Prohlížeč"): a presentation model over the bodies of the last
// regeneration and the selection. Visibility is view state (Q071): it is not stored, does not
// go through the dispatcher or undo, and a body that disappears after a regeneration drops
// out of the hidden set. Since ADR 0015 a BodyId is a lineage (origin feature), so it survives a
// history change; storing visibility in the document is for M11 (body metadata, Q071).

import { ObservableValue } from '@/core';
import type { Observable, Unsubscribe } from '@/core';
import type { BodyId, FeatureId } from '@/document';
import type { RegenStatusPort } from './regen-status-port';
import type { SelectionCommands } from './selection';

export interface BrowserBodyRow {
  readonly body: BodyId;
  /** "Body n" by position (1-based); a translation key with the number, translated by ui. */
  readonly name: { readonly key: 'browser.body'; readonly n: number };
  /** The feature that made the body. */
  readonly feature: FeatureId;
  readonly visible: boolean;
  /** The selection contains { kind: 'body', body }. */
  readonly selected: boolean;
}

export interface BrowserModel {
  readonly bodies: Observable<readonly BrowserBodyRow[]>;
  /** app → viewport.setBodyVisible */
  readonly hidden: Observable<ReadonlySet<BodyId>>;
  /** → selection.set / toggle */
  select(body: BodyId, opts?: { additive?: boolean }): void;
  setVisible(body: BodyId, visible: boolean): void;
  dispose(): void;
}

const EMPTY_ROWS: readonly BrowserBodyRow[] = Object.freeze([]);

export function createBrowserModel(deps: {
  regen: RegenStatusPort;
  selection: SelectionCommands;
}): BrowserModel {
  const { regen, selection } = deps;

  // A Set cannot be frozen; each change publishes a new set that is never mutated again.
  const hidden = new ObservableValue<ReadonlySet<BodyId>>(new Set());
  const rows = new ObservableValue<readonly BrowserBodyRow[]>(EMPTY_ROWS);

  /** The rows from all sources, reusing every unchanged row of `prev`. */
  function buildRows(prev: readonly BrowserBodyRow[]): readonly BrowserBodyRow[] {
    const hiddenNow = hidden.get();
    const selected = new Set(
      selection.items.get().flatMap((item) => (item.kind === 'body' ? [item.body] : [])),
    );
    const next = regen.state.get().bodies.map(({ body, feature }, i): BrowserBodyRow => {
      const old = prev[i];
      const row = {
        body,
        feature,
        n: i + 1,
        visible: !hiddenNow.has(body),
        selected: selected.has(body),
      };
      // Rows are matched by position, like the feature tree.
      if (old !== undefined && sameRow(old, row)) return old;
      return Object.freeze({
        body,
        name: Object.freeze({ key: 'browser.body', n: row.n }),
        feature,
        visible: row.visible,
        selected: row.selected,
      });
    });
    const unchanged = prev.length === next.length && next.every((row, i) => row === prev[i]);
    return unchanged ? prev : Object.freeze(next);
  }

  /** Publishes `next` unless it has the same members as the current hidden set. */
  function setHidden(next: ReadonlySet<BodyId>): void {
    const current = hidden.get();
    if (next.size === current.size && [...next].every((body) => current.has(body))) return;
    hidden.set(next);
  }

  function refresh(): void {
    rows.set(buildRows(rows.get()));
  }

  function onRegen(): void {
    const present = new Set(regen.state.get().bodies.map(({ body }) => body));
    setHidden(new Set([...hidden.get()].filter((body) => present.has(body))));
    refresh();
  }

  const unsubscribes: readonly Unsubscribe[] = [
    regen.state.subscribe(onRegen),
    selection.items.subscribe(refresh),
  ];
  refresh();

  return {
    bodies: rows.asObservable(),
    hidden: hidden.asObservable(),
    select(body, opts) {
      const item = { kind: 'body', body } as const;
      if (opts?.additive === true) selection.toggle(item);
      else selection.set([item]);
    },
    setVisible(body, visible) {
      // A body unknown to the last regeneration (e.g. a stale row in the UI) is ignored.
      if (!regen.state.get().bodies.some((b) => b.body === body)) return;
      const next = new Set(hidden.get());
      if (visible) next.delete(body);
      else next.add(body);
      setHidden(next);
      refresh();
    },
    dispose() {
      for (const unsubscribe of unsubscribes) unsubscribe();
    },
  };
}

function sameRow(
  a: BrowserBodyRow,
  b: {
    readonly body: BodyId;
    readonly feature: FeatureId;
    readonly n: number;
    readonly visible: boolean;
    readonly selected: boolean;
  },
): boolean {
  return (
    a.body === b.body &&
    a.feature === b.feature &&
    a.name.n === b.n &&
    a.visible === b.visible &&
    a.selected === b.selected
  );
}
