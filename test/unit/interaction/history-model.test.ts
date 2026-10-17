import { describe, expect, it } from 'vitest';
import { Emitter } from '@/core';
import { HISTORY_LIMIT, createHistoryModel } from '@/interaction/history-model';
import type { HistoryEntry, HistoryLog, HistoryRow } from '@/interaction/history-model';

/**
 * A scripted log of the server (N73): entries and undo stacks as the server computes them, one
 * clock tick per entry. document.rename stays outside undo (M19.2, D5).
 */
class ScriptedLog implements HistoryLog {
  private readonly list: HistoryEntry[] = [];
  private undoStack: number[] = [];
  private redoStack: number[] = [];
  private readonly emitter = new Emitter<{ changed: undefined }>();
  readonly events = this.emitter.asSubscribable();

  entries(): readonly HistoryEntry[] {
    return [...this.list];
  }

  stacks() {
    return { undo: [...this.undoStack], redo: [...this.redoStack] };
  }

  get lastSeq(): number {
    return this.list.length;
  }

  do(label: string, opType = 'studio.setRollback'): void {
    const seq = this.append({ kind: 'do', label, opType });
    if (opType === 'document.rename') return;
    this.undoStack.push(seq);
    this.redoStack = [];
    this.emitter.emit('changed', undefined);
  }

  /** document.rename: an entry, but no step of undo; its answer changes nothing of the history. */
  rename(): void {
    this.do('document.rename', 'document.rename');
  }

  undo(): void {
    const target = this.undoStack.pop();
    if (target === undefined) throw new Error('nothing to undo');
    this.redoStack.push(target);
    this.append({
      kind: 'undo',
      target,
      label: this.labelOf(target),
      opType: 'studio.setRollback',
    });
    this.emitter.emit('changed', undefined);
  }

  redo(): void {
    const target = this.redoStack.pop();
    if (target === undefined) throw new Error('nothing to redo');
    this.undoStack.push(target);
    this.append({
      kind: 'redo',
      target,
      label: this.labelOf(target),
      opType: 'studio.setRollback',
    });
    this.emitter.emit('changed', undefined);
  }

  private append(entry: Omit<HistoryEntry, 'seq' | 'time'>): number {
    const seq = this.list.length + 1;
    this.list.push({ ...entry, seq, time: seq });
    return seq;
  }

  private labelOf(seq: number): string {
    return this.list[seq - 1]?.label ?? '';
  }
}

function setup() {
  const log = new ScriptedLog();
  const history = createHistoryModel({ log });
  const doOp = (label: string): void => {
    log.do(label);
  };
  return { log, undo: log, history, doOp, rows: () => history.state.get().rows };
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

  it('gives the same rows for a new model over the same log', () => {
    const { doOp, undo, log, history } = setup();
    doOp('a');
    doOp('b');
    undo.undo();
    doOp('c');
    undo.undo();
    const restored = createHistoryModel({ log });
    expect(restored.state.get()).toEqual(history.state.get());
  });

  it('leaves out document.rename: no row, not counted, no notification', () => {
    const { doOp, rows, history, log } = setup();
    doOp('a');
    let count = 0;
    history.state.subscribe(() => count++);
    log.rename();
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
