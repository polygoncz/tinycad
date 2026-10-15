import { describe, expect, it } from 'vitest';
import { createOperationLog } from '@/ops/log';
import type { LogEntry } from '@/ops/log';
import type { Operation } from '@/ops/operation';

const op: Operation = { type: 'studio.setRollback', v: 1 };
const draft = (label = 'x'): Omit<LogEntry, 'seq'> => ({
  kind: 'do',
  op,
  inverse: op,
  label,
  time: 1000,
});

describe('OperationLog', () => {
  it('starts empty with lastSeq 0', () => {
    const log = createOperationLog();
    expect(log.lastSeq).toBe(0);
    expect(log.entries()).toEqual([]);
  });

  it('assigns seq from 1 and updates lastSeq', () => {
    const log = createOperationLog();
    expect(log.append(draft('a')).seq).toBe(1);
    expect(log.append(draft('b')).seq).toBe(2);
    expect(log.lastSeq).toBe(2);
  });

  it('entries(fromSeq) returns entries with seq >= fromSeq as a copy', () => {
    const log = createOperationLog();
    log.append(draft('a'));
    log.append(draft('b'));
    log.append(draft('c'));
    expect(log.entries(2).map((e) => e.label)).toEqual(['b', 'c']);
    expect(log.entries().map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(log.entries(4)).toEqual([]);
    const copy = log.entries() as LogEntry[];
    copy.length = 0;
    expect(log.entries()).toHaveLength(3);
  });

  it('freezes the appended entry', () => {
    const log = createOperationLog();
    const e = log.append(draft());
    expect(Object.isFrozen(e)).toBe(true);
    expect(log.entries()[0]).toBe(e);
  });

  it('emits appended with the new entry', () => {
    const log = createOperationLog();
    const seen: LogEntry[] = [];
    log.events.on('appended', (e) => seen.push(e));
    const e = log.append(draft());
    expect(seen).toEqual([e]);
  });

  it('does not expose emit on events', () => {
    const log = createOperationLog();
    expect('emit' in log.events).toBe(false);
  });

  it('restores from entries and continues seq', () => {
    const a = createOperationLog();
    a.append(draft('a'));
    a.append({ ...draft('b'), kind: 'undo', target: 1 });
    const b = createOperationLog(a.entries());
    expect(b.lastSeq).toBe(2);
    expect(b.entries()).toEqual(a.entries());
    expect(b.append(draft('c')).seq).toBe(3);
  });

  it('restored entries are frozen', () => {
    const log = createOperationLog([{ ...draft(), seq: 1 }]);
    expect(Object.isFrozen(log.entries()[0])).toBe(true);
  });

  it('throws on a gap or when not starting at 1', () => {
    const e = (seq: number): LogEntry => ({ ...draft(), seq });
    expect(() => createOperationLog([e(1), e(3)])).toThrow();
    expect(() => createOperationLog([e(2), e(3)])).toThrow();
    expect(() => createOperationLog([e(1), e(1)])).toThrow();
  });
});
