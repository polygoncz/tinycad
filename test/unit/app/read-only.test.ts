import { describe, expect, it, vi } from 'vitest';
import { createDocument, createFeatureSchemaRegistry } from '@/document';
import type { DocumentId } from '@/document';
import { createOperationDispatcher, createOperationLog, createOpHandlerRegistry } from '@/ops';
import type { DocumentRenameOp, OperationDispatcher } from '@/ops';
import { createMemoryDocumentStore } from '@/persistence';
import { createManualScheduler } from '@/persistence/testing';
import { storeNewDocument } from '@/app/open-document';
import { createSessionPersistence, refuseChanges } from '@/app/read-only';
import { settle } from '@/app/testing';

// Branded ids are created by a cast at one place in tests.
const DOC = 'doc1' as DocumentId;

async function setup(readOnly: boolean) {
  const store = createMemoryDocumentStore({ now: () => 0 });
  const doc = await storeNewDocument(store, DOC, { translate: (k) => k, now: () => 0 });
  const log = createOperationLog();
  const schemas = createFeatureSchemaRegistry();
  const dispatcher = createOperationDispatcher({
    doc,
    handlers: createOpHandlerRegistry({ schemas }),
    log,
    now: () => 0,
  });
  const scheduler = createManualScheduler();
  const persistence = createSessionPersistence({ readOnly, store, log, doc, scheduler });
  const rename = (name: string): void => {
    const op: DocumentRenameOp = { type: 'document.rename', v: 1, name };
    dispatcher.dispatch(op);
  };
  const appends = vi.spyOn(store, 'appendEntries');
  return { persistence, rename, appends, scheduler };
}

describe('refuseChanges', () => {
  function inner(): OperationDispatcher {
    const schemas = createFeatureSchemaRegistry();
    return createOperationDispatcher({
      doc: createDocument({ meta: { id: DOC, name: 'Doc', createdAt: 0 } }),
      handlers: createOpHandlerRegistry({ schemas }),
      log: createOperationLog(),
      now: () => 0,
    });
  }

  it('dispatch and begin throw, the document is open read-only', () => {
    const guarded = refuseChanges(inner());
    const op: DocumentRenameOp = { type: 'document.rename', v: 1, name: 'x' };
    expect(() => guarded.dispatch(op)).toThrow(/read-only/);
    expect(() => guarded.begin('edit')).toThrow(/read-only/);
  });

  it('keeps the transaction state and the events of the inner dispatcher', () => {
    const wrapped = inner();
    const guarded = refuseChanges(wrapped);
    expect(guarded.inTransaction).toBe(false);
    expect(guarded.events).toBe(wrapped.events);
  });
});

describe('createSessionPersistence', () => {
  it('with the lock: a change is pending, then saved after the delay', async () => {
    const { persistence, rename, appends, scheduler } = await setup(false);
    expect(persistence.status.get()).toBe('saved');
    rename('Other');
    expect(persistence.status.get()).toBe('pending');
    scheduler.advance(1000);
    await settle();
    expect(appends).toHaveBeenCalledTimes(1);
    expect(persistence.status.get()).toBe('saved');
    expect(persistence.error.get()).toBeNull();
  });

  it('with the lock: release writes the queue with one last flush', async () => {
    const { persistence, rename, appends } = await setup(false);
    rename('Other');
    persistence.release(() => undefined);
    await settle();
    expect(appends).toHaveBeenCalledTimes(1);
  });

  it('read-only: always saved, no error, flush and release write nothing', async () => {
    const { persistence, rename, appends, scheduler } = await setup(true);
    rename('Other');
    expect(persistence.status.get()).toBe('saved');
    expect(persistence.error.get()).toBeNull();
    await expect(persistence.flush()).resolves.toBeUndefined();
    scheduler.advance(10_000);
    persistence.release(() => undefined);
    await settle();
    expect(appends).not.toHaveBeenCalled();
  });
});
