import { Emitter } from '@/core';
import type { Disposable, Subscribable } from '@/core';
import type { DocumentReader } from '@/document';
import type { LogEntry, OperationLogReader } from '@/ops';
import { createSnapshot } from './snapshot';
import type { DocumentSnapshot } from './snapshot';
import type { DocumentStore } from './store';

export type PersistenceStatus = 'saved' | 'pending' | 'error';

export interface PersistenceService extends Disposable {
  /** Writes the queue. A call during a running flush waits, then writes what is left. Rejects on error. */
  flush(): Promise<void>;
  readonly status: PersistenceStatus;
  readonly events: Subscribable<{ status: { status: PersistenceStatus; error?: unknown } }>;
}

/** Timer scheduler. Ring 1 knows no setTimeout (ADR 0009); app or a test provides it. */
export interface Scheduler {
  schedule(fn: () => void, ms: number): Disposable;
}

/**
 * Saves new log entries and a snapshot every `snapshotEvery` entries to the store (spec 05).
 * The document must already exist in the store; the caller creates it with its base snapshot.
 */
export function createPersistenceService(deps: {
  store: DocumentStore;
  log: OperationLogReader;
  /** id of the document = doc.meta.id */
  doc: DocumentReader;
  scheduler: Scheduler;
  /** Default 300. */
  flushMs?: number;
  /** Default 100. */
  snapshotEvery?: number;
  /** Default 5000. */
  retryMs?: number;
}): PersistenceService {
  return new QueuedPersistenceService(deps);
}

type StatusEvents = { status: { status: PersistenceStatus; error?: unknown } };

// Writes run one at a time: flush() chains onto the running write. Each write takes a copy
// of the queue, and on success removes exactly what it wrote, so entries appended meanwhile
// stay for the next write.
class QueuedPersistenceService implements PersistenceService {
  private readonly emitter = new Emitter<StatusEvents>();
  // Only on/once, not the Emitter itself: a cast back to Emitter must not give emit (Q023).
  readonly events: Subscribable<StatusEvents> = {
    on: (type, fn) => this.emitter.on(type, fn),
    once: (type, fn) => this.emitter.once(type, fn),
  };

  private readonly store: DocumentStore;
  private readonly doc: DocumentReader;
  private readonly scheduler: Scheduler;
  private readonly flushMs: number;
  private readonly snapshotEvery: number;
  private readonly retryMs: number;
  private readonly unsubscribe: () => void;

  private queue: readonly LogEntry[] = [];
  /** Only the latest snapshot matters; an older one is superseded. */
  private snapshot: DocumentSnapshot | undefined;
  /** Highest seq known to be in the store. Entries in the log before the service are saved. */
  private writtenSeq: number;
  private current: PersistenceStatus = 'saved';
  /** Scheduled by the first entry after a quiet period. */
  private flushTimer: Disposable | undefined;
  /** Scheduled by a failed write. */
  private retryTimer: Disposable | undefined;
  /** The last started flush; the next one waits for it. */
  private running: Promise<void> | undefined;
  private disposed = false;

  constructor(deps: Parameters<typeof createPersistenceService>[0]) {
    this.store = deps.store;
    this.doc = deps.doc;
    this.scheduler = deps.scheduler;
    this.flushMs = deps.flushMs ?? 300;
    this.snapshotEvery = deps.snapshotEvery ?? 100;
    this.retryMs = deps.retryMs ?? 5000;
    this.writtenSeq = deps.log.lastSeq;
    this.unsubscribe = deps.log.events.on('appended', (entry) => {
      this.onAppended(entry);
    });
  }

  get status(): PersistenceStatus {
    return this.current;
  }

  flush(): Promise<void> {
    const previous = this.running ?? Promise.resolve();
    // Wait for the running write whatever its outcome; its caller gets its error.
    const run = previous.then(
      () => this.write(),
      () => this.write(),
    );
    this.running = run;
    return run;
  }

  dispose(): void {
    this.disposed = true;
    this.unsubscribe();
    this.cancelTimers();
  }

  private onAppended(entry: LogEntry): void {
    this.queue = [...this.queue, entry];
    // The dispatcher emits `appended` after applying the operation: doc is the state after seq.
    if (entry.seq % this.snapshotEvery === 0) {
      this.snapshot = createSnapshot(this.doc, entry.seq);
    }
    // A delay, not a debounce: further entries do not postpone the scheduled flush.
    this.flushTimer ??= this.scheduler.schedule(() => {
      this.flushTimer = undefined;
      this.flushFromTimer();
    }, this.flushMs);
    // Emitted last: a throwing subscriber must not stop the flush (Q030). An error stays
    // visible until a write succeeds.
    if (this.current === 'saved') this.setStatus('pending');
  }

  private flushFromTimer(): void {
    // Nobody waits for a timer flush: the error is reported by status, not by rejection.
    this.flush().catch(() => undefined);
  }

  private async write(): Promise<void> {
    // This write covers everything queued so far; a timer would only repeat it.
    this.cancelTimers();
    const id = this.doc.meta.id;
    try {
      const batch = this.queue;
      const last = batch.at(-1);
      if (last !== undefined) {
        await this.store.appendEntries(id, batch);
        this.queue = this.queue.slice(batch.length);
        this.writtenSeq = last.seq;
      }
      // Only after its entries are in the store: a snapshot ahead of the log is refused.
      const snapshot = this.snapshot;
      if (snapshot !== undefined && snapshot.atSeq <= this.writtenSeq) {
        await this.store.saveSnapshot(id, snapshot);
        if (this.snapshot === snapshot) this.snapshot = undefined;
      }
    } catch (error) {
      if (!this.disposed) {
        this.retryTimer ??= this.scheduler.schedule(() => {
          this.retryTimer = undefined;
          this.flushFromTimer();
        }, this.retryMs);
      }
      // Emitted after the retry is scheduled: a throwing subscriber must not stop it (Q030).
      try {
        this.setStatus('error', error);
      } catch (subscriberError) {
        // Both matter: the store error says why saving fails, the other is a bug in a subscriber.
        throw new AggregateError(
          [error, subscriberError],
          'Write failed and a status subscriber failed',
          { cause: subscriberError },
        );
      }
      throw error;
    }
    // The queue is already updated; a throwing subscriber rejects flush, the data are stored.
    this.setStatus(this.hasWork() ? 'pending' : 'saved');
  }

  private hasWork(): boolean {
    return this.queue.length > 0 || this.snapshot !== undefined;
  }

  private cancelTimers(): void {
    this.flushTimer?.dispose();
    this.flushTimer = undefined;
    this.retryTimer?.dispose();
    this.retryTimer = undefined;
  }

  private setStatus(status: PersistenceStatus, error?: unknown): void {
    if (status === this.current) return;
    this.current = status;
    this.emitter.emit('status', status === 'error' ? { status, error } : { status });
  }
}
