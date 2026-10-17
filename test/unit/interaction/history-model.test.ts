import { describe, expect, it } from 'vitest';
import { Emitter } from '@/core';
import { OP_VERSION } from '@/ops';
import type { DocumentRenameOp, StudioSetRollbackOp } from '@/ops';
import { createOpHandlerRegistry } from '@/ops';
import { createFeatureSchemaRegistry } from '@/document';
import { aDocument } from '@/document/testing';
import { createOperationDispatcher, createOperationLog, createUndoManager } from '@/ops/testing';
import type { LegacyUndoManager as UndoManager, OperationLogReader } from '@/ops/testing';
import { HISTORY_LIMIT, createHistoryModel } from '@/interaction/history-model';
import type { HistoryLog, HistoryRow } from '@/interaction/history-model';

/** A real op that works on an empty document: moving the bar to the end. */
const BAR: StudioSetRollbackOp = {
  type: 'studio.setRollback',
  v: OP_VERSION['studio.setRollback'],
  index: 0,
};

/** Renaming the document: outside undo, so outside the history panel (M19.2, D5). */
const RENAME: DocumentRenameOp = {
  type: 'document.rename',
  v: OP_VERSION['document.rename'],
  name: 'Díl',
};

/** The port over the in-memory log and undo of ops/testing.ts. */
function historyLogOf(log: OperationLogReader, undo: UndoManager): HistoryLog {
  const emitter = new Emitter<{ changed: undefined }>();
  log.events.on('appended', () => {
    emitter.emit('changed', undefined);
  });
  return {
    entries: () =>
      log.entries().map((entry) => ({
        seq: entry.seq,
        kind: entry.kind,
        ...(entry.target === undefined ? {} : { target: entry.target }),
        label: entry.label,
        time: entry.time,
        opType: entry.op.type,
      })),
    stacks: () => undo.stacks(),
    events: emitter.asSubscribable(),
  };
}

/** The in-memory log, dispatcher and undo of before M52 (until M52 task 2). */
function legacySession() {
  const log = createOperationLog();
  let clock = 0;
  const dispatcher = createOperationDispatcher({
    doc: aDocument(),
    handlers: createOpHandlerRegistry({ schemas: createFeatureSchemaRegistry() }),
    log,
    now: () => ++clock,
  });
  return { log, dispatcher, undo: createUndoManager({ dispatcher, log }) };
}

function setup() {
  const ops = legacySession();
  const history = createHistoryModel({ log: historyLogOf(ops.log, ops.undo) });
  const doOp = (label: string): void => {
    ops.dispatcher.dispatch(BAR, { kind: 'do', label });
  };
  return { ...ops, history, doOp, rows: () => history.state.get().rows };
}

const brief = (row: HistoryRow) => ({
  seq: row.seq,
  kind: row.kind,
  target: row.target,
  status: row.status,
});

describe('createHistoryModel', () => {
  it('is empty for an empty log', () => {
    const { history } = setup();
    expect(history.state.get()).toEqual({ rows: [], total: 0, older: 0 });
    expect(Object.isFrozen(history.state.get())).toBe(true);
    expect(Object.isFrozen(history.state.get().rows)).toBe(true);
  });

  it('lists three do entries newest first, all active', () => {
    const { doOp, rows, history } = setup();
    doOp('a');
    doOp('b');
    doOp('c');
    expect(rows()).toEqual([
      { seq: 3, kind: 'do', label: 'c', time: 3, target: null, status: 'active' },
      { seq: 2, kind: 'do', label: 'b', time: 2, target: null, status: 'active' },
      { seq: 1, kind: 'do', label: 'a', time: 1, target: null, status: 'active' },
    ]);
    expect(history.state.get().total).toBe(3);
    expect(history.state.get().older).toBe(0);
    expect(rows().every((row) => Object.isFrozen(row))).toBe(true);
  });

  it('shows an undo row with its target and marks the do undone', () => {
    const { doOp, rows, undo } = setup();
    doOp('a');
    doOp('b');
    undo.undo();
    expect(rows().map(brief)).toEqual([
      { seq: 3, kind: 'undo', target: 2, status: null },
      { seq: 2, kind: 'do', target: null, status: 'undone' },
      { seq: 1, kind: 'do', target: null, status: 'active' },
    ]);
    expect(rows()[0]?.label).toBe('b');
  });

  it('marks the do active again after redo', () => {
    const { doOp, rows, undo } = setup();
    doOp('a');
    undo.undo();
    undo.redo();
    expect(rows().map(brief)).toEqual([
      { seq: 3, kind: 'redo', target: 1, status: null },
      { seq: 2, kind: 'undo', target: 1, status: null },
      { seq: 1, kind: 'do', target: null, status: 'active' },
    ]);
  });

  it('marks an undone do abandoned after a new do', () => {
    const { doOp, rows, undo } = setup();
    doOp('a');
    doOp('b');
    undo.undo();
    doOp('c');
    expect(rows().map(brief)).toEqual([
      { seq: 4, kind: 'do', target: null, status: 'active' },
      { seq: 3, kind: 'undo', target: 2, status: null },
      { seq: 2, kind: 'do', target: null, status: 'abandoned' },
      { seq: 1, kind: 'do', target: null, status: 'active' },
    ]);
  });

  it('keeps at most HISTORY_LIMIT rows, total counts all entries, older the left out ones', () => {
    const { doOp, rows, history } = setup();
    for (let i = 1; i <= 250; i++) doOp(`op${String(i)}`);
    expect(HISTORY_LIMIT).toBe(200);
    expect(rows()).toHaveLength(200);
    expect(history.state.get().total).toBe(250);
    expect(history.state.get().older).toBe(50);
    expect(rows()[0]?.seq).toBe(250);
    expect(rows()[199]?.seq).toBe(51);
  });

  it('keeps unchanged rows as the same objects after another entry', () => {
    const { doOp, rows, undo } = setup();
    doOp('a');
    doOp('b');
    const before = rows();
    doOp('c');
    const after = rows();
    expect(after[1]).toBe(before[0]);
    expect(after[2]).toBe(before[1]);
    // An undo changes only the status of the undone row.
    undo.undo();
    const undone = rows();
    expect(undone[1]).not.toBe(after[0]);
    expect(undone[2]).toBe(after[1]);
    expect(undone[3]).toBe(after[2]);
  });

  it('notifies once per appended entry', () => {
    const { doOp, history } = setup();
    let count = 0;
    history.state.subscribe(() => count++);
    doOp('a');
    doOp('b');
    expect(count).toBe(2);
  });

  it('gives the same rows for a log restored from the stored entries', () => {
    const { doOp, undo, log, dispatcher, history } = setup();
    doOp('a');
    doOp('b');
    undo.undo();
    doOp('c');
    undo.undo();
    const restoredLog = createOperationLog(log.entries());
    const restored = createHistoryModel({
      log: historyLogOf(restoredLog, createUndoManager({ dispatcher, log: restoredLog })),
    });
    expect(restored.state.get()).toEqual(history.state.get());
  });

  it('leaves out document.rename: no row, not counted, no notification', () => {
    const { doOp, dispatcher, rows, history, log } = setup();
    doOp('a');
    let count = 0;
    history.state.subscribe(() => count++);
    dispatcher.dispatch(RENAME);
    doOp('b');
    expect(log.lastSeq).toBe(3);
    expect(rows().map(brief)).toEqual([
      { seq: 3, kind: 'do', target: null, status: 'active' },
      { seq: 1, kind: 'do', target: null, status: 'active' },
    ]);
    expect(history.state.get().total).toBe(2);
    expect(history.state.get().older).toBe(0);
    expect(count).toBe(1);
  });

  it('takes the statuses from the stacks of the port, not from the entries', () => {
    const emitter = new Emitter<{ changed: undefined }>();
    const entry = (seq: number) => ({
      seq,
      kind: 'do' as const,
      label: `op${String(seq)}`,
      time: seq,
      opType: 'feature.setParams',
    });
    let stacks = { undo: [1, 2], redo: [] as number[] };
    const log: HistoryLog = {
      entries: () => [entry(1), entry(2)],
      stacks: () => stacks,
      events: emitter.asSubscribable(),
    };
    const history = createHistoryModel({ log });
    expect(history.state.get().rows.map((row) => row.status)).toEqual(['active', 'active']);
    stacks = { undo: [1], redo: [2] };
    emitter.emit('changed', undefined);
    expect(history.state.get().rows.map((row) => row.status)).toEqual(['undone', 'active']);
  });

  it('stops following the log after dispose', () => {
    const { doOp, history } = setup();
    doOp('a');
    const before = history.state.get();
    history.dispose();
    doOp('b');
    expect(history.state.get()).toBe(before);
  });
});
