// Test-only entry point of persistence: the DocumentStore contract suite and a manual Scheduler.
// dependency-cruiser allows importing it only from *.test.ts.
//
// The suite knows only the DocumentStore interface: every implementation (memory, IndexedDB
// over RPC) runs the same tests. Errors are checked with storeErrorCode, never instanceof,
// because over core/rpc a store error arrives as an RpcError carrying the same code.

import { beforeEach, describe, expect, it } from 'vitest';
import type { DocumentId, DocumentMeta, FeatureId } from '@/document';
import { aDocument, aFeature } from '@/document/testing';
import { OP_VERSION } from '@/ops';
import type { DocumentRenameOp, FeatureRenameOp, LogEntry } from '@/ops';
import { anOpsSession } from '@/ops/testing';
import { createSnapshot } from './snapshot';
import type { DocumentSnapshot } from './snapshot';
import { storeErrorCode } from './store';
import type { DocumentStore, DocumentStoreErrorCode } from './store';
import type { Scheduler } from './service';

/** Creates a fresh, empty store for every test; the suite drives its clock through `now`. */
export type DocumentStoreFactory = (deps: { now: () => number }) => Promise<DocumentStore>;

// Branded ids are created by a cast at one place in tests.
const docId = (s: string): DocumentId => s as DocumentId;
const featureA = 'a' as FeatureId;

function metaOf(id: string): DocumentMeta {
  return { id: docId(id), name: `Doc ${id}`, createdAt: 0 };
}

/** The base snapshot (atSeq 0) of a document with one feature 'a'. */
function baseOf(id: string): DocumentSnapshot {
  return createSnapshot(
    aDocument({ meta: metaOf(id), features: [aFeature({ id: 'a', name: 'A' })] }),
    0,
  );
}

/**
 * `count` real log entries of document `id` (renames of feature 'a') and the snapshot
 * after each of them: snapshots[n] is the state after entry n.
 */
function aHistory(
  id: string,
  count: number,
): { entries: readonly LogEntry[]; snapshots: readonly DocumentSnapshot[] } {
  const session = anOpsSession({ meta: metaOf(id), features: [aFeature({ id: 'a', name: 'A' })] });
  const snapshots = [createSnapshot(session.doc, 0)];
  for (let n = 1; n <= count; n++) {
    const rename: FeatureRenameOp = {
      type: 'feature.rename',
      v: OP_VERSION['feature.rename'],
      featureId: featureA,
      name: `A${String(n)}`,
    };
    session.dispatcher.dispatch(rename);
    snapshots.push(createSnapshot(session.doc, n));
  }
  return { entries: session.log.entries(), snapshots };
}

/**
 * Log entries of document `id`, one per item of `names`: a document.rename to that name, or for
 * '' a rename of feature 'a' (an entry without a document rename).
 */
function aRenameHistory(id: string, names: readonly string[]): readonly LogEntry[] {
  const session = anOpsSession({ meta: metaOf(id), features: [aFeature({ id: 'a', name: 'A' })] });
  names.forEach((name, n) => {
    if (name === '') {
      const rename: FeatureRenameOp = {
        type: 'feature.rename',
        v: OP_VERSION['feature.rename'],
        featureId: featureA,
        name: `A${String(n)}`,
      };
      session.dispatcher.dispatch(rename);
    } else {
      const rename: DocumentRenameOp = {
        type: 'document.rename',
        v: OP_VERSION['document.rename'],
        name,
      };
      session.dispatcher.dispatch(rename);
    }
  });
  return session.log.entries();
}

/** Item `i` of a test fixture list; fails the test instead of a non-null assertion. */
function nth<T>(list: readonly T[], i: number): T {
  const item = list[i];
  if (item === undefined) expect.fail(`Fixture has no item ${String(i)}`);
  return item;
}

/** A deep copy of plain JSON data: an input the test owns and may change behind the store. */
function jsonCopy<T>(value: T): T {
  // JSON.parse returns any; the value went in as a T made of plain JSON.
  return JSON.parse(JSON.stringify(value)) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Sets the field at `path` inside JSON data, ignoring readonly types on purpose: the tests
 * change inputs and outputs behind the store's back to check data isolation.
 */
function mutate(data: unknown, path: readonly string[], value: unknown): void {
  let target: unknown = data;
  for (const key of path.slice(0, -1)) {
    if (!isRecord(target)) expect.fail(`No object at '${key}' of ${path.join('.')}`);
    target = target[key];
  }
  const last = path.at(-1);
  if (!isRecord(target) || last === undefined) expect.fail(`Cannot set ${path.join('.')}`);
  target[last] = value;
}

/** The code of the store error the promise rejects with; fails the test if it resolves. */
async function rejectionCode(p: Promise<unknown>): Promise<DocumentStoreErrorCode | undefined> {
  try {
    await p;
  } catch (e) {
    return storeErrorCode(e);
  }
  expect.fail('Expected the store call to reject');
}

export function describeDocumentStoreContract(name: string, factory: DocumentStoreFactory): void {
  describe(`DocumentStore contract: ${name}`, () => {
    let time = 1000;
    let store: DocumentStore;

    beforeEach(async () => {
      time = 1000;
      store = await factory({ now: () => time });
    });

    /** A created document with entries 1..count already appended. */
    async function aStoredDocument(id: string, count = 0) {
      const history = aHistory(id, count);
      await store.createDocument(metaOf(id), baseOf(id));
      if (count > 0) await store.appendEntries(docId(id), history.entries);
      return history;
    }

    async function infoOf(id: string) {
      return (await store.listDocuments()).find((d) => d.meta.id === docId(id));
    }

    describe('errors', () => {
      it('a rejection is an Error whose code storeErrorCode reads', async () => {
        const failed = await store.appendEntries(docId('missing'), []).then(
          () => undefined,
          (e: unknown) => e,
        );
        expect(failed).toBeInstanceOf(Error);
        expect(storeErrorCode(failed)).toBe('not-found');
      });

      it('appendEntries on a missing document rejects with not-found', async () => {
        const { entries } = aHistory('missing', 1);
        expect(await rejectionCode(store.appendEntries(docId('missing'), entries))).toBe(
          'not-found',
        );
      });

      it('saveSnapshot on a missing document rejects with not-found', async () => {
        const { snapshots } = aHistory('missing', 1);
        expect(await rejectionCode(store.saveSnapshot(docId('missing'), nth(snapshots, 1)))).toBe(
          'not-found',
        );
      });
    });

    describe('createDocument', () => {
      it('lists the new document with lastSeq 0 and updatedAt now', async () => {
        time = 5000;
        await store.createDocument(metaOf('d1'), baseOf('d1'));
        expect(await store.listDocuments()).toEqual([
          { meta: metaOf('d1'), lastSeq: 0, updatedAt: 5000 },
        ]);
      });

      it('load returns the initial snapshot as both base and latest, with no entries', async () => {
        await store.createDocument(metaOf('d1'), baseOf('d1'));
        expect(await store.load(docId('d1'))).toEqual({
          snapshot: baseOf('d1'),
          base: baseOf('d1'),
          entries: [],
        });
      });

      it('an existing id rejects with already-exists and keeps the original', async () => {
        await aStoredDocument('d1', 2);
        const other = { ...metaOf('d1'), name: 'Other' };
        expect(await rejectionCode(store.createDocument(other, baseOf('d1')))).toBe(
          'already-exists',
        );
        expect((await infoOf('d1'))?.meta.name).toBe('Doc d1');
        expect((await store.load(docId('d1')))?.entries).toHaveLength(2);
      });

      it('initial.atSeq other than 0 rejects with invalid and creates nothing', async () => {
        const initial = { ...baseOf('d1'), atSeq: 1 };
        expect(await rejectionCode(store.createDocument(metaOf('d1'), initial))).toBe('invalid');
        expect(await store.listDocuments()).toEqual([]);
        expect(await store.load(docId('d1'))).toBeUndefined();
      });

      it('meta.id different from the snapshot document id rejects with invalid', async () => {
        expect(await rejectionCode(store.createDocument(metaOf('d1'), baseOf('d2')))).toBe(
          'invalid',
        );
        expect(await store.listDocuments()).toEqual([]);
      });
    });

    describe('listDocuments', () => {
      it('is empty for an empty store', async () => {
        expect(await store.listDocuments()).toEqual([]);
      });

      it('is sorted by updatedAt, newest first', async () => {
        const { entries } = aHistory('a', 1);
        time = 1;
        await store.createDocument(metaOf('a'), baseOf('a'));
        time = 2;
        await store.createDocument(metaOf('b'), baseOf('b'));
        time = 3;
        await store.createDocument(metaOf('c'), baseOf('c'));
        time = 4;
        await store.appendEntries(docId('a'), entries);
        const list = await store.listDocuments();
        expect(list.map((d) => [d.meta.id, d.updatedAt])).toEqual([
          ['a', 4],
          ['c', 3],
          ['b', 2],
        ]);
      });
    });

    describe('appendEntries', () => {
      it('stores entries, sets lastSeq and updatedAt', async () => {
        const { entries } = aHistory('d1', 3);
        await store.createDocument(metaOf('d1'), baseOf('d1'));
        time = 2000;
        await store.appendEntries(docId('d1'), entries);
        expect(await infoOf('d1')).toEqual({ meta: metaOf('d1'), lastSeq: 3, updatedAt: 2000 });
        expect((await store.load(docId('d1')))?.entries).toEqual(entries);
      });

      it('appends batch after batch; load returns all entries ordered by seq', async () => {
        const { entries } = aHistory('d1', 5);
        await store.createDocument(metaOf('d1'), baseOf('d1'));
        await store.appendEntries(docId('d1'), entries.slice(0, 2));
        await store.appendEntries(docId('d1'), entries.slice(2, 3));
        await store.appendEntries(docId('d1'), entries.slice(3));
        expect((await infoOf('d1'))?.lastSeq).toBe(5);
        expect((await store.load(docId('d1')))?.entries).toEqual(entries);
      });

      it('an empty batch changes nothing, not even updatedAt', async () => {
        const { entries } = await aStoredDocument('d1', 2);
        const before = await infoOf('d1');
        time = 9000;
        await store.appendEntries(docId('d1'), []);
        expect(await infoOf('d1')).toEqual(before);
        expect((await store.load(docId('d1')))?.entries).toEqual(entries);
      });

      it('a first seq beyond lastSeq + 1 rejects with seq-gap and writes nothing', async () => {
        const { entries } = aHistory('d1', 4);
        await store.createDocument(metaOf('d1'), baseOf('d1'));
        await store.appendEntries(docId('d1'), entries.slice(0, 1));
        const before = await infoOf('d1');
        time = 9000;
        expect(await rejectionCode(store.appendEntries(docId('d1'), entries.slice(2, 4)))).toBe(
          'seq-gap',
        );
        expect(await infoOf('d1')).toEqual(before);
        expect((await store.load(docId('d1')))?.entries).toEqual(entries.slice(0, 1));
      });

      it.each([
        ['0', 0],
        ['negative', -1],
        ['not a whole number', 1.5],
      ])('an entry with seq %s rejects with invalid and writes nothing', async (_, seq) => {
        const { entries } = aHistory('d1', 2);
        await store.createDocument(metaOf('d1'), baseOf('d1'));
        const batch = [nth(entries, 0), { ...nth(entries, 1), seq }];
        expect(await rejectionCode(store.appendEntries(docId('d1'), batch))).toBe('invalid');
        expect((await infoOf('d1'))?.lastSeq).toBe(0);
        expect((await store.load(docId('d1')))?.entries).toEqual([]);
      });

      it('a gap inside the batch rejects with seq-gap and writes none of it (atomic)', async () => {
        const { entries } = aHistory('d1', 4);
        await store.createDocument(metaOf('d1'), baseOf('d1'));
        const broken = [nth(entries, 0), nth(entries, 1), nth(entries, 3)];
        expect(await rejectionCode(store.appendEntries(docId('d1'), broken))).toBe('seq-gap');
        expect((await infoOf('d1'))?.lastSeq).toBe(0);
        expect((await store.load(docId('d1')))?.entries).toEqual([]);
      });

      it('entries out of order inside the batch reject with seq-gap', async () => {
        const { entries } = aHistory('d1', 2);
        await store.createDocument(metaOf('d1'), baseOf('d1'));
        const swapped = [nth(entries, 1), nth(entries, 0)];
        expect(await rejectionCode(store.appendEntries(docId('d1'), swapped))).toBe('seq-gap');
        expect((await store.load(docId('d1')))?.entries).toEqual([]);
      });

      it('writing the same batch again is harmless (idempotent retry)', async () => {
        const { entries } = await aStoredDocument('d1', 3);
        await store.appendEntries(docId('d1'), entries);
        expect((await infoOf('d1'))?.lastSeq).toBe(3);
        expect((await store.load(docId('d1')))?.entries).toEqual(entries);
      });

      it('an entry with seq <= lastSeq is overwritten', async () => {
        const { entries } = await aStoredDocument('d1', 3);
        const relabelled = { ...nth(entries, 1), label: 'rewritten' };
        await store.appendEntries(docId('d1'), [relabelled]);
        const loaded = await store.load(docId('d1'));
        expect(loaded?.entries).toEqual([nth(entries, 0), relabelled, nth(entries, 2)]);
        expect((await infoOf('d1'))?.lastSeq).toBe(3);
      });

      it('a batch overlapping the end sets lastSeq to its last seq', async () => {
        const { entries } = aHistory('d1', 5);
        await store.createDocument(metaOf('d1'), baseOf('d1'));
        await store.appendEntries(docId('d1'), entries.slice(0, 3));
        time = 3000;
        await store.appendEntries(docId('d1'), entries.slice(1, 5));
        expect(await infoOf('d1')).toEqual({ meta: metaOf('d1'), lastSeq: 5, updatedAt: 3000 });
        expect((await store.load(docId('d1')))?.entries).toEqual(entries);
      });

      it('rewriting older entries keeps lastSeq (max) and sets updatedAt', async () => {
        const { entries } = await aStoredDocument('d1', 4);
        time = 4000;
        await store.appendEntries(docId('d1'), entries.slice(0, 2));
        expect(await infoOf('d1')).toEqual({ meta: metaOf('d1'), lastSeq: 4, updatedAt: 4000 });
        expect((await store.load(docId('d1')))?.entries).toEqual(entries);
      });
    });

    describe('appendEntries and the name of the document (M19.2, D5)', () => {
      it('a batch with document.rename sets meta.name of the listed document', async () => {
        const entries = aRenameHistory('d1', ['', 'Part']);
        await store.createDocument(metaOf('d1'), baseOf('d1'));
        time = 2000;
        await store.appendEntries(docId('d1'), entries);
        expect(await infoOf('d1')).toEqual({
          meta: { ...metaOf('d1'), name: 'Part' },
          lastSeq: 2,
          updatedAt: 2000,
        });
      });

      it('the last document.rename of the batch wins', async () => {
        const entries = aRenameHistory('d1', ['First', 'Second', '']);
        await store.createDocument(metaOf('d1'), baseOf('d1'));
        await store.appendEntries(docId('d1'), entries);
        expect((await infoOf('d1'))?.meta.name).toBe('Second');
      });

      it('a later batch without document.rename keeps the name', async () => {
        const entries = aRenameHistory('d1', ['Part', '', '']);
        await store.createDocument(metaOf('d1'), baseOf('d1'));
        await store.appendEntries(docId('d1'), entries.slice(0, 1));
        await store.appendEntries(docId('d1'), entries.slice(1));
        expect((await infoOf('d1'))?.meta).toEqual({ ...metaOf('d1'), name: 'Part' });
      });

      it('a batch without document.rename keeps the name', async () => {
        await aStoredDocument('d1', 3);
        expect((await infoOf('d1'))?.meta).toEqual(metaOf('d1'));
      });

      it('a rejected batch with document.rename keeps the name', async () => {
        const entries = aRenameHistory('d1', ['', '', 'Part']);
        await store.createDocument(metaOf('d1'), baseOf('d1'));
        const broken = [nth(entries, 0), nth(entries, 2)];
        expect(await rejectionCode(store.appendEntries(docId('d1'), broken))).toBe('seq-gap');
        expect((await infoOf('d1'))?.meta).toEqual(metaOf('d1'));
      });

      it('load still returns the entries unchanged', async () => {
        const entries = aRenameHistory('d1', ['Part']);
        await store.createDocument(metaOf('d1'), baseOf('d1'));
        await store.appendEntries(docId('d1'), entries);
        expect((await store.load(docId('d1')))?.entries).toEqual(entries);
      });
    });

    describe('saveSnapshot', () => {
      it('load returns the snapshot with the highest atSeq; base stays', async () => {
        const { snapshots } = await aStoredDocument('d1', 3);
        await store.saveSnapshot(docId('d1'), nth(snapshots, 2));
        await store.saveSnapshot(docId('d1'), nth(snapshots, 3));
        await store.saveSnapshot(docId('d1'), nth(snapshots, 1));
        const loaded = await store.load(docId('d1'));
        expect(loaded?.snapshot).toEqual(nth(snapshots, 3));
        expect(loaded?.base).toEqual(baseOf('d1'));
      });

      it('atSeq beyond lastSeq rejects with snapshot-ahead and writes nothing', async () => {
        const { snapshots } = aHistory('d1', 3);
        await store.createDocument(metaOf('d1'), baseOf('d1'));
        await store.appendEntries(docId('d1'), aHistory('d1', 2).entries);
        expect(await rejectionCode(store.saveSnapshot(docId('d1'), nth(snapshots, 3)))).toBe(
          'snapshot-ahead',
        );
        expect((await store.load(docId('d1')))?.snapshot).toEqual(baseOf('d1'));
      });

      it.each([
        ['0 (the base snapshot comes only from createDocument)', 0],
        ['negative', -1],
        ['not a whole number', 1.5],
      ])('atSeq %s rejects with invalid', async (_, atSeq) => {
        const { snapshots } = await aStoredDocument('d1', 3);
        const snapshot = { ...nth(snapshots, 1), atSeq };
        expect(await rejectionCode(store.saveSnapshot(docId('d1'), snapshot))).toBe('invalid');
        const loaded = await store.load(docId('d1'));
        expect(loaded?.snapshot).toEqual(baseOf('d1'));
        expect(loaded?.base).toEqual(baseOf('d1'));
      });

      it('a snapshot of another document rejects with invalid', async () => {
        await aStoredDocument('d1', 2);
        const { snapshots } = aHistory('d2', 2);
        expect(await rejectionCode(store.saveSnapshot(docId('d1'), nth(snapshots, 1)))).toBe(
          'invalid',
        );
        expect((await store.load(docId('d1')))?.snapshot).toEqual(baseOf('d1'));
      });

      it('checks not-found before invalid', async () => {
        const snapshot = { ...nth(aHistory('missing', 1).snapshots, 1), atSeq: 0 };
        expect(await rejectionCode(store.saveSnapshot(docId('missing'), snapshot))).toBe(
          'not-found',
        );
      });

      it('checks invalid before snapshot-ahead', async () => {
        await aStoredDocument('d1', 1);
        const { snapshots } = aHistory('d2', 3);
        // Both of another document and ahead of lastSeq 1.
        expect(await rejectionCode(store.saveSnapshot(docId('d1'), nth(snapshots, 3)))).toBe(
          'invalid',
        );
      });

      it('does not change updatedAt', async () => {
        const { snapshots } = await aStoredDocument('d1', 2);
        const before = await infoOf('d1');
        time = 9000;
        await store.saveSnapshot(docId('d1'), nth(snapshots, 2));
        expect(await infoOf('d1')).toEqual(before);
      });

      it('the same atSeq overwrites the snapshot', async () => {
        const { snapshots } = await aStoredDocument('d1', 2);
        await store.saveSnapshot(docId('d1'), nth(snapshots, 2));
        const renamed = {
          ...nth(snapshots, 2),
          document: { ...nth(snapshots, 2).document, meta: { ...metaOf('d1'), name: 'Renamed' } },
        };
        await store.saveSnapshot(docId('d1'), renamed);
        expect((await store.load(docId('d1')))?.snapshot).toEqual(renamed);
      });

      it('pruning old snapshots never removes the base snapshot', async () => {
        const { snapshots } = await aStoredDocument('d1', 8);
        for (let n = 1; n <= 8; n++) await store.saveSnapshot(docId('d1'), nth(snapshots, n));
        const loaded = await store.load(docId('d1'));
        expect(loaded?.base).toEqual(baseOf('d1'));
        expect(loaded?.snapshot).toEqual(nth(snapshots, 8));
      });
    });

    describe('deleteDocument', () => {
      it('removes the document, its entries and snapshots', async () => {
        const { snapshots } = await aStoredDocument('d1', 2);
        await store.saveSnapshot(docId('d1'), nth(snapshots, 2));
        await aStoredDocument('d2', 1);
        await store.deleteDocument(docId('d1'));
        expect(await store.load(docId('d1'))).toBeUndefined();
        expect((await store.listDocuments()).map((d) => d.meta.id)).toEqual(['d2']);
        // Recreated under the same id, nothing of the old document comes back.
        await store.createDocument(metaOf('d1'), baseOf('d1'));
        expect(await store.load(docId('d1'))).toEqual({
          snapshot: baseOf('d1'),
          base: baseOf('d1'),
          entries: [],
        });
        expect((await infoOf('d1'))?.lastSeq).toBe(0);
      });

      it('keeps other documents intact', async () => {
        const { entries } = await aStoredDocument('d2', 2);
        await aStoredDocument('d1', 1);
        await store.deleteDocument(docId('d1'));
        expect((await store.load(docId('d2')))?.entries).toEqual(entries);
      });

      it('a missing id does nothing (idempotent)', async () => {
        await aStoredDocument('d1');
        await store.deleteDocument(docId('missing'));
        await store.deleteDocument(docId('missing'));
        expect(await store.listDocuments()).toHaveLength(1);
      });
    });

    describe('load', () => {
      it('a missing id resolves to undefined', async () => {
        expect(await store.load(docId('missing'))).toBeUndefined();
      });
    });

    describe('data isolation', () => {
      it('changing createDocument inputs afterwards does not change the stored data', async () => {
        const meta = jsonCopy(metaOf('d1'));
        const initial = jsonCopy(baseOf('d1'));
        await store.createDocument(meta, initial);
        mutate(meta, ['name'], 'changed');
        mutate(initial, ['document', 'studio'], 'changed');
        expect((await infoOf('d1'))?.meta).toEqual(metaOf('d1'));
        expect((await store.load(docId('d1')))?.base).toEqual(baseOf('d1'));
      });

      it('changing appended entries afterwards does not change the stored entries', async () => {
        const { entries } = aHistory('d1', 1);
        await store.createDocument(metaOf('d1'), baseOf('d1'));
        const input = jsonCopy(nth(entries, 0));
        await store.appendEntries(docId('d1'), [input]);
        mutate(input, ['label'], 'changed');
        mutate(input, ['op', 'name'], 'changed');
        expect((await store.load(docId('d1')))?.entries).toEqual(entries);
      });

      it('changing a saved snapshot afterwards does not change the stored one', async () => {
        const { snapshots } = await aStoredDocument('d1', 1);
        const input = jsonCopy(nth(snapshots, 1));
        await store.saveSnapshot(docId('d1'), input);
        mutate(input, ['document', 'meta', 'name'], 'changed');
        expect((await store.load(docId('d1')))?.snapshot).toEqual(nth(snapshots, 1));
      });

      it('never returns the objects it received', async () => {
        const meta = metaOf('d1');
        const base = baseOf('d1');
        const { entries, snapshots } = aHistory('d1', 1);
        await store.createDocument(meta, base);
        await store.appendEntries(docId('d1'), entries);
        const first = await store.load(docId('d1'));
        expect(first?.base).not.toBe(base);
        await store.saveSnapshot(docId('d1'), nth(snapshots, 1));
        const loaded = await store.load(docId('d1'));
        expect(loaded?.entries[0]).not.toBe(nth(entries, 0));
        expect(loaded?.snapshot).not.toBe(nth(snapshots, 1));
        expect((await infoOf('d1'))?.meta).not.toBe(meta);
      });

      it('changing a loaded result does not change the stored data or later results', async () => {
        const { entries, snapshots } = await aStoredDocument('d1', 1);
        await store.saveSnapshot(docId('d1'), nth(snapshots, 1));
        const first = await store.load(docId('d1'));
        expect(first).toBeDefined();
        mutate(first, ['entries', '0', 'label'], 'changed');
        mutate(first, ['snapshot', 'document', 'studio'], 'changed');
        mutate(first, ['base', 'document', 'studio'], 'changed');
        const second = await store.load(docId('d1'));
        expect(second?.entries).toEqual(entries);
        expect(second?.snapshot).toEqual(nth(snapshots, 1));
        expect(second?.base).toEqual(baseOf('d1'));
        expect(second?.entries[0]).not.toBe(first?.entries[0]);
        expect(second?.snapshot).not.toBe(first?.snapshot);
      });

      it('changing a listed DocumentInfo does not change the stored metadata', async () => {
        await aStoredDocument('d1');
        const [info] = await store.listDocuments();
        mutate(info, ['meta', 'name'], 'changed');
        expect((await infoOf('d1'))?.meta).toEqual(metaOf('d1'));
      });
    });
  });
}

/** A Scheduler whose clock the test moves by hand. */
export interface ManualScheduler extends Scheduler {
  /** Moves the clock by `ms` and runs every task due by then, in order of due time. */
  advance(ms: number): void;
  /** Number of scheduled tasks that have neither run nor been disposed. */
  readonly pending: number;
}

/**
 * Tasks run synchronously inside advance(); a task scheduled while advancing runs too if it
 * falls due within the advanced window. Tasks due at the same time run in scheduling order.
 */
export function createManualScheduler(): ManualScheduler {
  interface Task {
    readonly fn: () => void;
    readonly due: number;
    readonly order: number;
  }
  let now = 0;
  let order = 0;
  const tasks = new Set<Task>();
  const nextDue = (until: number): Task | undefined =>
    [...tasks].filter((t) => t.due <= until).sort((a, b) => a.due - b.due || a.order - b.order)[0];
  return {
    schedule(fn, ms) {
      const task: Task = { fn, due: now + ms, order: order++ };
      tasks.add(task);
      return {
        dispose: () => {
          tasks.delete(task);
        },
      };
    },
    advance(ms) {
      const until = now + ms;
      for (let task = nextDue(until); task !== undefined; task = nextDue(until)) {
        tasks.delete(task);
        now = task.due;
        task.fn();
      }
      now = until;
    },
    get pending() {
      return tasks.size;
    },
  };
}
