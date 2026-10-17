// The history panel (spec 10, "Historie úprav: HistoryModel", M15): the operation log as a
// read-only timeline, newest first. The log is append-only and undo appends the inverse, so
// "Undo" and "Redo" show as rows of their own and a 'do' says whether it is still in effect.
// The status comes from the undo stacks of the log port (N73: the server computes them by the
// same rule as UndoManager).
// M19.2 (D5): document.rename is outside undo, so it is no step of the history either; its
// entries are left out of the rows and of the counts.

import { ObservableValue } from '@/core';
import type { Disposable, Observable, Subscribable } from '@/core';

/**
 * One entry of the log for the history panel (N73): without the operations, with their type.
 * The server sends exactly this (LogEntryView).
 */
export interface HistoryEntry {
  readonly seq: number;
  readonly kind: 'do' | 'undo' | 'redo';
  /** For undo/redo the seq of the original 'do'. */
  readonly target?: number;
  /** A translation key or the op type (ADR 0014). */
  readonly label: string;
  /** ms since epoch. */
  readonly time: number;
  /** The type of the operation ('feature.setParams', 'document.rename', 'batch'). */
  readonly opType: string;
}

/**
 * Port: the log as the history panel needs it (N73), instead of OperationLogReader: the entries
 * and the undo stacks (seq of the original 'do' entries, the top at the end), which the server
 * computes.
 */
export interface HistoryLog {
  /** All entries, in order. */
  entries(): readonly HistoryEntry[];
  stacks(): { readonly undo: readonly number[]; readonly redo: readonly number[] };
  /** After the entries or the stacks changed. */
  readonly events: Subscribable<{ changed: undefined }>;
}

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
  /** The number of all log entries except document.rename. */
  readonly total: number;
  /** Entries left out of `rows` (older than the newest HISTORY_LIMIT): total - rows.length. */
  readonly older: number;
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

export function createHistoryModel(deps: { log: HistoryLog }): HistoryModel {
  const { log } = deps;

  /** Rows of the last snapshot by seq, so an unchanged row stays the same object. */
  let previous: ReadonlyMap<number, HistoryRow> = new Map();

  function rowOf(entry: HistoryEntry, status: RowStatus): HistoryRow {
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
    const stacks = log.stacks();
    const entries = log.entries().filter((entry) => entry.opType !== 'document.rename');
    const undone = new Set(stacks.redo);
    const active = new Set(stacks.undo);
    const statusOf = (entry: HistoryEntry): RowStatus => {
      if (entry.kind !== 'do') return null;
      if (active.has(entry.seq)) return 'active';
      return undone.has(entry.seq) ? 'undone' : 'abandoned';
    };
    const rows = entries
      .slice(-HISTORY_LIMIT)
      .reverse()
      .map((entry) => rowOf(entry, statusOf(entry)));
    previous = new Map(rows.map((row) => [row.seq, row]));
    return Object.freeze({
      rows: Object.freeze(rows),
      total: entries.length,
      older: entries.length - rows.length,
    });
  }

  function sameState(a: HistoryState, b: HistoryState): boolean {
    return (
      a.total === b.total &&
      a.rows.length === b.rows.length &&
      a.rows.every((row, i) => row === b.rows[i])
    );
  }

  const state = new ObservableValue<HistoryState>(compute());
  const unsubscribe = log.events.on('changed', () => {
    const next = compute();
    if (!sameState(state.get(), next)) state.set(next);
  });

  return {
    state: state.asObservable(),
    dispose: unsubscribe,
  };
}
