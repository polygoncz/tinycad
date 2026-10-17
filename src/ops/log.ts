import { assert, Emitter } from '@/core';
import type { Subscribable } from '@/core';
import type { LogEntry } from './ports';

/** Read role of the log (ADR 0011): UndoManager and the tests. */
export interface OperationLogReader {
  /** Entries with seq >= fromSeq (default 1), in order. A copy of the array. */
  entries(fromSeq?: number): readonly LogEntry[];
  /** 0 for an empty log. */
  readonly lastSeq: number;
  readonly events: Subscribable<{ appended: LogEntry }>;
}

/** Write role: only the dispatcher calls append. */
export interface OperationLog extends OperationLogReader {
  /** Assigns seq = lastSeq + 1, shallow-freezes the entry and emits `appended`. */
  append(e: Omit<LogEntry, 'seq'>): LogEntry;
}

/** Empty log, or one restored from stored entries. Entries must have seq 1..n without gaps, otherwise throws. */
export function createOperationLog(entries: readonly LogEntry[] = []): OperationLog {
  return new InMemoryOperationLog(entries);
}

// Append-only: nothing is ever removed, so seq doubles as index + 1.
class InMemoryOperationLog implements OperationLog {
  private readonly emitter = new Emitter<{ appended: LogEntry }>();
  // Only on/once, not the Emitter itself: a cast back to Emitter must not give emit (Q023).
  readonly events: Subscribable<{ appended: LogEntry }> = this.emitter.asSubscribable();
  private readonly list: LogEntry[] = [];

  constructor(restored: readonly LogEntry[]) {
    restored.forEach((e, i) => {
      assert(
        e.seq === i + 1,
        `Log entry at position ${String(i)} has seq ${String(e.seq)}, expected ${String(i + 1)}`,
      );
      this.list.push(Object.freeze({ ...e }));
    });
  }

  get lastSeq(): number {
    return this.list.length;
  }

  append(e: Omit<LogEntry, 'seq'>): LogEntry {
    const entry = Object.freeze({ ...e, seq: this.list.length + 1 });
    this.list.push(entry);
    this.emitter.emit('appended', entry);
    return entry;
  }

  entries(fromSeq = 1): readonly LogEntry[] {
    return this.list.slice(Math.max(fromSeq, 1) - 1);
  }
}
