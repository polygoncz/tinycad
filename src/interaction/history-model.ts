// The history panel (spec 10, "Historie úprav: HistoryModel", M15): the operation log as a
// read-only timeline, newest first. The log is append-only and undo appends the inverse, so
// "Undo" and "Redo" show as rows of their own and a 'do' says whether it is still in effect.
// The status comes from rebuildUndoStacks, the same rule as UndoManager, but the model does
// not depend on UndoManager: the order of the `appended` subscribers would not be certain.

import { ObservableValue } from '@/core';
import type { Disposable, Observable } from '@/core';
import { rebuildUndoStacks } from '@/ops';
import type { LogEntry, OperationLogReader } from '@/ops';

export interface HistoryRow {
  readonly seq: number;
  readonly kind: 'do' | 'undo' | 'redo';
  /** LogEntry.label: a translation key or the op type (ADR 0014); ui translates it. */
  readonly label: string;
  /** ms since epoch. */
  readonly time: number;
  /** For undo/redo the seq of the original 'do', otherwise null. */
  readonly target: number | null;
  /** Only for 'do': on the undo stack / on the redo stack / on neither; null for undo/redo. */
  readonly status: 'active' | 'undone' | 'abandoned' | null;
}

export interface HistoryState {
  readonly rows: readonly HistoryRow[];
  /** The number of all log entries. */
  readonly total: number;
}

/** At most this many rows (a DOM with thousands of rows would be slow). */
export const HISTORY_LIMIT = 200;

export interface HistoryModel extends Disposable {
  readonly state: Observable<HistoryState>;
}

type RowStatus = HistoryRow['status'];

function sameRow(a: HistoryRow, b: HistoryRow): boolean {
  return (
    a.seq === b.seq &&
    a.kind === b.kind &&
    a.label === b.label &&
    a.time === b.time &&
    a.target === b.target &&
    a.status === b.status
  );
}

export function createHistoryModel(deps: { log: OperationLogReader }): HistoryModel {
  const { log } = deps;

  /** Rows of the last snapshot by seq, so an unchanged row stays the same object. */
  let previous: ReadonlyMap<number, HistoryRow> = new Map();

  function rowOf(entry: LogEntry, status: RowStatus): HistoryRow {
    const values: HistoryRow = {
      seq: entry.seq,
      kind: entry.kind,
      label: entry.label,
      time: entry.time,
      target: entry.target ?? null,
      status,
    };
    const old = previous.get(entry.seq);
    return old !== undefined && sameRow(old, values) ? old : Object.freeze(values);
  }

  function compute(): HistoryState {
    const entries = log.entries();
    const stacks = rebuildUndoStacks(entries);
    const undone = new Set(stacks.redo);
    const active = new Set(stacks.undo);
    const statusOf = (entry: LogEntry): RowStatus => {
      if (entry.kind !== 'do') return null;
      if (active.has(entry.seq)) return 'active';
      return undone.has(entry.seq) ? 'undone' : 'abandoned';
    };
    const rows = entries
      .slice(-HISTORY_LIMIT)
      .reverse()
      .map((entry) => rowOf(entry, statusOf(entry)));
    previous = new Map(rows.map((row) => [row.seq, row]));
    return Object.freeze({ rows: Object.freeze(rows), total: entries.length });
  }

  function sameState(a: HistoryState, b: HistoryState): boolean {
    return (
      a.total === b.total &&
      a.rows.length === b.rows.length &&
      a.rows.every((row, i) => row === b.rows[i])
    );
  }

  const state = new ObservableValue<HistoryState>(compute());
  const unsubscribe = log.events.on('appended', () => {
    const next = compute();
    if (!sameState(state.get(), next)) state.set(next);
  });

  return {
    state: state.asObservable(),
    dispose: unsubscribe,
  };
}
