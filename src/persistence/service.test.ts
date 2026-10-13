import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DocumentId, DocumentMeta, FeatureId } from '@/document';
import { aFeature } from '@/document/testing';
import { OP_VERSION } from '@/ops';
import type { FeatureRenameOp, LogEntry } from '@/ops';
import { anOpsSession } from '@/ops/testing';
import type { OpsSession } from '@/ops/testing';
import { createMemoryDocumentStore } from './memory-store';
import { createPersistenceService } from './service';
import type { PersistenceService, PersistenceStatus } from './service';
import { createSnapshot } from './snapshot';
import type { DocumentSnapshot } from './snapshot';
import type { DocumentStore } from './store';
import { createManualScheduler } from './testing';
import type { ManualScheduler } from './testing';

// Branded ids are created by a cast at one place in tests.
const id = 'd1' as DocumentId;
const featureA = 'a' as FeatureId;
const meta: DocumentMeta = { id, name: 'Doc', createdAt: 0 };

/** Lets every pending promise settle: the memory store resolves in microtasks. */
function settle(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/** A store promise the test resolves or rejects by hand. */
interface Held {
  release(): void;
  fail(error: unknown): void;
}

/**
 * A DocumentStore over the memory store that records every write and can make the next call
 * of a method fail or wait until the test releases it.
 */
function aControlledStore(inner: DocumentStore) {
  const calls: { method: 'appendEntries' | 'saveSnapshot'; seqs: readonly number[] }[] = [];
  const failNext = { appendEntries: 0, saveSnapshot: 0 };
  let held: Promise<void> | undefined;
  let inFlight = 0;
  let maxInFlight = 0;

  async function write(
    method: 'appendEntries' | 'saveSnapshot',
    seqs: readonly number[],
    run: () => Promise<void>,
  ): Promise<void> {
    calls.push({ method, seqs });
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      const wait = held;
      held = undefined;
      if (wait !== undefined) await wait;
      if (failNext[method] > 0) {
        failNext[method]--;
        throw new Error(`${method} failed`);
      }
      await run();
    } finally {
      inFlight--;
    }
  }

  const store: DocumentStore = {
    listDocuments: () => inner.listDocuments(),
    createDocument: (m, s) => inner.createDocument(m, s),
    deleteDocument: (d) => inner.deleteDocument(d),
    load: (d) => inner.load(d),
    appendEntries: (d, entries: readonly LogEntry[]) =>
      write(
        'appendEntries',
        entries.map((e) => e.seq),
        () => inner.appendEntries(d, entries),
      ),
    saveSnapshot: (d, snapshot: DocumentSnapshot) =>
      write('saveSnapshot', [snapshot.atSeq], () => inner.saveSnapshot(d, snapshot)),
  };
  return {
    store,
    calls,
    failNext,
    /** The next write waits until the test releases or fails it. */
    holdNextCall: (): Held => {
      const control: { release?: () => void; fail?: (error: unknown) => void } = {};
      held = new Promise<void>((resolve, reject) => {
        control.release = resolve;
        control.fail = reject;
      });
      return {
        release: () => {
          control.release?.();
        },
        fail: (error) => {
          control.fail?.(error);
        },
      };
    },
    get maxInFlight() {
      return maxInFlight;
    },
  };
}

describe('PersistenceService', () => {
  let session: OpsSession;
  let memory: DocumentStore;
  let controlled: ReturnType<typeof aControlledStore>;
  let scheduler: ManualScheduler;
  let service: PersistenceService | undefined;
  let renames = 0;

  beforeEach(async () => {
    renames = 0;
    session = anOpsSession({ meta, features: [aFeature({ id: 'a', name: 'A' })] });
    memory = createMemoryDocumentStore({ now: () => 1000 });
    // The caller creates the document with its base snapshot, not the service.
    await memory.createDocument(meta, createSnapshot(session.doc, 0));
    controlled = aControlledStore(memory);
    scheduler = createManualScheduler();
  });

  afterEach(() => {
    service?.dispose();
    service = undefined;
  });

  function start(
    options: { flushMs?: number; snapshotEvery?: number; retryMs?: number } = {},
  ): PersistenceService {
    service = createPersistenceService({
      store: controlled.store,
      log: session.log,
      doc: session.doc,
      scheduler,
      ...options,
    });
    return service;
  }

  /** Renames feature 'a' to A1, A2, …: one log entry each. */
  function edit(count = 1): void {
    for (let i = 0; i < count; i++) {
      renames++;
      const op: FeatureRenameOp = {
        type: 'feature.rename',
        v: OP_VERSION['feature.rename'],
        featureId: featureA,
        name: `A${String(renames)}`,
      };
      session.dispatcher.dispatch(op);
    }
  }

  function statusEvents(s: PersistenceService): { status: PersistenceStatus; error?: unknown }[] {
    const events: { status: PersistenceStatus; error?: unknown }[] = [];
    s.events.on('status', (e) => events.push(e));
    return events;
  }

  async function stored() {
    const loaded = await memory.load(id);
    expect(loaded).toBeDefined();
    return loaded;
  }

  async function rejection(p: Promise<unknown>): Promise<unknown> {
    try {
      await p;
    } catch (e) {
      return e;
    }
    expect.fail('Expected flush to reject');
  }

  describe('queue', () => {
    it('starts saved and treats entries already in the log as saved', async () => {
      edit(2);
      // As after loadDocument: the store already holds these entries.
      await memory.appendEntries(id, session.log.entries());
      const s = start();
      expect(s.status).toBe('saved');
      expect(scheduler.pending).toBe(0);
      await s.flush();
      expect(controlled.calls).toEqual([]);
      edit();
      await s.flush();
      expect(controlled.calls).toEqual([{ method: 'appendEntries', seqs: [3] }]);
    });

    it('flush with an empty queue writes nothing and resolves', async () => {
      const s = start();
      await s.flush();
      expect(controlled.calls).toEqual([]);
      expect(s.status).toBe('saved');
    });

    it('writes the whole queue as one appendEntries batch', async () => {
      start();
      edit(5);
      scheduler.advance(300);
      await settle();
      expect(controlled.calls).toEqual([{ method: 'appendEntries', seqs: [1, 2, 3, 4, 5] }]);
      expect((await stored())?.entries).toEqual(session.log.entries());
    });

    it('a successful flush removes the written entries from the queue', async () => {
      const s = start();
      edit(2);
      await s.flush();
      edit();
      await s.flush();
      expect(controlled.calls).toEqual([
        { method: 'appendEntries', seqs: [1, 2] },
        { method: 'appendEntries', seqs: [3] },
      ]);
    });
  });

  describe('timing', () => {
    it('the first entry after a quiet period schedules a flush after flushMs (default 300)', async () => {
      start();
      edit();
      expect(scheduler.pending).toBe(1);
      scheduler.advance(299);
      await settle();
      expect(controlled.calls).toEqual([]);
      scheduler.advance(1);
      await settle();
      expect(controlled.calls).toEqual([{ method: 'appendEntries', seqs: [1] }]);
    });

    it('is a delay, not a debounce: further entries do not postpone the flush', async () => {
      start({ flushMs: 100 });
      edit();
      scheduler.advance(60);
      edit();
      expect(scheduler.pending).toBe(1);
      scheduler.advance(40);
      await settle();
      expect(controlled.calls).toEqual([{ method: 'appendEntries', seqs: [1, 2] }]);
    });

    it('an entry after a flush schedules a new one', async () => {
      start({ flushMs: 100 });
      edit();
      scheduler.advance(100);
      await settle();
      expect(scheduler.pending).toBe(0);
      edit();
      expect(scheduler.pending).toBe(1);
      scheduler.advance(100);
      await settle();
      expect(controlled.calls.map((c) => c.seqs)).toEqual([[1], [2]]);
    });

    it('an explicit flush cancels the scheduled one', async () => {
      const s = start();
      edit();
      await s.flush();
      expect(scheduler.pending).toBe(0);
    });
  });

  describe('snapshots', () => {
    it('creates a snapshot every snapshotEvery entries (default 100)', async () => {
      const s = start();
      edit(250);
      await s.flush();
      expect(controlled.calls).toEqual([
        { method: 'appendEntries', seqs: session.log.entries().map((e) => e.seq) },
        { method: 'saveSnapshot', seqs: [200] },
      ]);
      expect((await stored())?.snapshot).toMatchObject({ atSeq: 200 });
    });

    it('the snapshot holds the state after its seq even though the document changed since', async () => {
      const s = start({ snapshotEvery: 3 });
      edit(3);
      const expected = createSnapshot(session.doc, 3);
      edit(1);
      await s.flush();
      expect((await stored())?.snapshot).toEqual(expected);
    });

    it('keeps only the latest snapshot of the queue', async () => {
      const s = start({ snapshotEvery: 2 });
      edit(5);
      await s.flush();
      expect(controlled.calls.filter((c) => c.method === 'saveSnapshot')).toEqual([
        { method: 'saveSnapshot', seqs: [4] },
      ]);
    });

    it('saves the snapshot only after the entries it covers were written', async () => {
      const s = start({ snapshotEvery: 2 });
      edit(2);
      controlled.failNext.appendEntries = 1;
      await rejection(s.flush());
      expect(controlled.calls).toEqual([{ method: 'appendEntries', seqs: [1, 2] }]);
      await s.flush();
      expect(controlled.calls.slice(1)).toEqual([
        { method: 'appendEntries', seqs: [1, 2] },
        { method: 'saveSnapshot', seqs: [2] },
      ]);
    });

    it('a snapshot whose entry arrived during a running write waits for the next flush', async () => {
      const s = start({ snapshotEvery: 2 });
      edit(1);
      const hold = controlled.holdNextCall();
      const first = s.flush();
      await settle();
      edit(1);
      hold.release();
      await first;
      expect(controlled.calls).toEqual([{ method: 'appendEntries', seqs: [1] }]);
      await s.flush();
      expect(controlled.calls.slice(1)).toEqual([
        { method: 'appendEntries', seqs: [2] },
        { method: 'saveSnapshot', seqs: [2] },
      ]);
    });

    it('a failed snapshot is saved by the next flush without rewriting the entries', async () => {
      const s = start({ snapshotEvery: 2 });
      edit(2);
      controlled.failNext.saveSnapshot = 1;
      await rejection(s.flush());
      expect(s.status).toBe('error');
      await s.flush();
      expect(controlled.calls).toEqual([
        { method: 'appendEntries', seqs: [1, 2] },
        { method: 'saveSnapshot', seqs: [2] },
        { method: 'saveSnapshot', seqs: [2] },
      ]);
      expect((await stored())?.snapshot).toMatchObject({ atSeq: 2 });
      expect(s.status).toBe('saved');
    });
  });

  describe('status', () => {
    it('goes saved -> pending -> saved and emits only on change', async () => {
      const s = start();
      const events = statusEvents(s);
      edit();
      expect(s.status).toBe('pending');
      edit();
      await s.flush();
      expect(s.status).toBe('saved');
      await s.flush();
      expect(events).toEqual([{ status: 'pending' }, { status: 'saved' }]);
    });

    it('stays pending while entries arrive during a running write', async () => {
      const s = start();
      const events = statusEvents(s);
      edit();
      const hold = controlled.holdNextCall();
      const first = s.flush();
      await settle();
      edit();
      hold.release();
      await first;
      expect(s.status).toBe('pending');
      await s.flush();
      expect(events).toEqual([{ status: 'pending' }, { status: 'saved' }]);
    });

    it('error carries the error of the failed write', async () => {
      const s = start();
      const events = statusEvents(s);
      edit();
      controlled.failNext.appendEntries = 1;
      const error = await rejection(s.flush());
      expect(error).toBeInstanceOf(Error);
      expect(s.status).toBe('error');
      expect(events).toEqual([{ status: 'pending' }, { status: 'error', error }]);
    });
  });

  describe('write errors', () => {
    it('an explicit flush rejects with the store error', async () => {
      const s = start();
      edit();
      controlled.failNext.appendEntries = 1;
      expect(await rejection(s.flush())).toEqual(new Error('appendEntries failed'));
    });

    it('do not drop the queue: the next flush writes everything', async () => {
      const s = start();
      edit(2);
      controlled.failNext.appendEntries = 1;
      await rejection(s.flush());
      edit();
      await s.flush();
      expect(controlled.calls.map((c) => c.seqs)).toEqual([
        [1, 2],
        [1, 2, 3],
      ]);
      expect((await stored())?.entries).toEqual(session.log.entries());
      expect(s.status).toBe('saved');
    });

    it('a flush started by the timer reports the error by status, not by rejection', async () => {
      // An unhandled rejection would fail the test run.
      const s = start();
      const events = statusEvents(s);
      edit();
      controlled.failNext.appendEntries = 1;
      scheduler.advance(300);
      await settle();
      expect(s.status).toBe('error');
      expect(events.at(-1)?.status).toBe('error');
    });

    it('retries after retryMs (default 5000)', async () => {
      const s = start();
      edit();
      controlled.failNext.appendEntries = 1;
      scheduler.advance(300);
      await settle();
      expect(scheduler.pending).toBe(1);
      scheduler.advance(4999);
      await settle();
      expect(controlled.calls).toHaveLength(1);
      scheduler.advance(1);
      await settle();
      expect(controlled.calls.map((c) => c.seqs)).toEqual([[1], [1]]);
      expect(s.status).toBe('saved');
      expect(scheduler.pending).toBe(0);
    });

    it('a failing retry schedules another one', async () => {
      const s = start({ retryMs: 1000 });
      edit();
      controlled.failNext.appendEntries = 2;
      scheduler.advance(300);
      await settle();
      scheduler.advance(1000);
      await settle();
      expect(s.status).toBe('error');
      expect(scheduler.pending).toBe(1);
      scheduler.advance(1000);
      await settle();
      expect(controlled.calls).toHaveLength(3);
      expect(s.status).toBe('saved');
    });

    it('a new entry after an error schedules a flush as usual', async () => {
      const s = start({ flushMs: 100, retryMs: 1000 });
      edit();
      controlled.failNext.appendEntries = 1;
      await rejection(s.flush());
      edit();
      scheduler.advance(100);
      await settle();
      expect(controlled.calls.map((c) => c.seqs)).toEqual([[1], [1, 2]]);
      expect(s.status).toBe('saved');
      expect(scheduler.pending).toBe(0);
    });
  });

  describe('a throwing status subscriber (Q030)', () => {
    /** A subscriber that throws whenever the status becomes `on`. */
    function throwOn(s: PersistenceService, on: PersistenceStatus): Error {
      const failure = new Error(`subscriber failed on ${on}`);
      s.events.on('status', (e) => {
        if (e.status === on) throw failure;
      });
      return failure;
    }

    it('on pending: the entry is queued, the snapshot taken and the flush scheduled anyway', async () => {
      const s = start({ snapshotEvery: 1 });
      const failure = throwOn(s, 'pending');
      // The log passes the subscriber error on to the dispatcher, which rethrows it (Q030).
      expect(() => {
        edit();
      }).toThrow(failure);
      expect(scheduler.pending).toBe(1);
      scheduler.advance(300);
      await settle();
      expect(controlled.calls).toEqual([
        { method: 'appendEntries', seqs: [1] },
        { method: 'saveSnapshot', seqs: [1] },
      ]);
      expect(s.status).toBe('saved');
    });

    it('on error: flush rejects with both the store error and the subscriber error', async () => {
      const s = start();
      const failure = throwOn(s, 'error');
      edit();
      controlled.failNext.appendEntries = 1;
      const error = await rejection(s.flush());
      expect(error).toBeInstanceOf(AggregateError);
      // Checked by the instanceof above.
      expect((error as AggregateError).errors).toEqual([
        new Error('appendEntries failed'),
        failure,
      ]);
      expect(s.status).toBe('error');
    });

    it('on error: the retry is scheduled anyway and saves the queue', async () => {
      const s = start({ retryMs: 1000 });
      throwOn(s, 'error');
      edit();
      controlled.failNext.appendEntries = 1;
      await rejection(s.flush());
      expect(scheduler.pending).toBe(1);
      scheduler.advance(1000);
      await settle();
      expect((await stored())?.entries).toEqual(session.log.entries());
      expect(s.status).toBe('saved');
    });

    it('on error in a timer flush: the retry is scheduled anyway', async () => {
      const s = start({ retryMs: 1000 });
      throwOn(s, 'error');
      edit();
      controlled.failNext.appendEntries = 1;
      scheduler.advance(300);
      await settle();
      expect(s.status).toBe('error');
      expect(scheduler.pending).toBe(1);
      scheduler.advance(1000);
      await settle();
      expect(s.status).toBe('saved');
    });

    it('on saved: flush rejects with the subscriber error, but the data are stored', async () => {
      const s = start();
      const failure = throwOn(s, 'saved');
      edit(2);
      expect(await rejection(s.flush())).toBe(failure);
      expect((await stored())?.entries).toEqual(session.log.entries());
      expect(s.status).toBe('saved');
      expect(scheduler.pending).toBe(0);
      // Nothing is left over: the next flush writes nothing.
      await s.flush();
      expect(controlled.calls).toHaveLength(1);
    });
  });

  describe('concurrent flush', () => {
    it('a second flush waits for the running one and then writes what is left', async () => {
      const s = start();
      edit(2);
      const hold = controlled.holdNextCall();
      const first = s.flush();
      await settle();
      edit();
      const second = s.flush();
      await settle();
      expect(controlled.calls).toHaveLength(1);
      hold.release();
      await Promise.all([first, second]);
      expect(controlled.calls.map((c) => c.seqs)).toEqual([[1, 2], [3]]);
      expect(controlled.maxInFlight).toBe(1);
      expect(s.status).toBe('saved');
    });

    it('a second flush still writes when the running one fails', async () => {
      const s = start();
      edit();
      const hold = controlled.holdNextCall();
      const first = s.flush();
      const second = s.flush();
      hold.fail(new Error('boom'));
      expect(await rejection(first)).toEqual(new Error('boom'));
      await second;
      expect(controlled.calls.map((c) => c.seqs)).toEqual([[1], [1]]);
      expect(s.status).toBe('saved');
    });
  });

  describe('dispose', () => {
    it('cancels the scheduled flush', async () => {
      const s = start();
      edit();
      s.dispose();
      expect(scheduler.pending).toBe(0);
      scheduler.advance(10_000);
      await settle();
      expect(controlled.calls).toEqual([]);
    });

    it('unsubscribes from the log', () => {
      const s = start();
      s.dispose();
      edit();
      expect(s.status).toBe('saved');
      expect(scheduler.pending).toBe(0);
    });

    it('does not save, and schedules no retry after a write that fails later', async () => {
      const s = start();
      edit();
      const hold = controlled.holdNextCall();
      const running = s.flush();
      await settle();
      s.dispose();
      hold.fail(new Error('boom'));
      await rejection(running);
      expect(scheduler.pending).toBe(0);
    });
  });
});

describe('createManualScheduler', () => {
  it('runs due tasks in order of due time and counts pending ones', () => {
    const scheduler = createManualScheduler();
    const ran: string[] = [];
    scheduler.schedule(() => ran.push('b'), 20);
    scheduler.schedule(() => ran.push('a'), 10);
    const c = scheduler.schedule(() => ran.push('c'), 15);
    expect(scheduler.pending).toBe(3);
    c.dispose();
    scheduler.advance(10);
    expect(ran).toEqual(['a']);
    scheduler.advance(10);
    expect(ran).toEqual(['a', 'b']);
    expect(scheduler.pending).toBe(0);
  });

  it('runs a task scheduled during advance when it falls due within the window', () => {
    const scheduler = createManualScheduler();
    const ran: number[] = [];
    scheduler.schedule(() => {
      ran.push(1);
      scheduler.schedule(() => ran.push(2), 5);
      scheduler.schedule(() => ran.push(3), 50);
    }, 10);
    scheduler.advance(20);
    expect(ran).toEqual([1, 2]);
    expect(scheduler.pending).toBe(1);
  });
});
