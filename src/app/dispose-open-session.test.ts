import { describe, expect, it } from 'vitest';
import { createSequentialIdGenerator } from '@/core';
import type { DocumentId } from '@/document';
import { createMemoryDocumentStore } from '@/persistence';
import type { DocumentStore } from '@/persistence';
import { createManualScheduler } from '@/persistence/testing';
import { createFakeSolver } from '@/sketch/testing';
import { disposeOpenSession } from './dispose-open-session';
import { BUILT_IN_PLUGINS, createAppSession } from './index';
import { aKernelFactory, FakeAppViewport, settle } from './testing';

const DOC = 'doc1' as DocumentId; // test value

/** A session part whose flush the test settles by hand; calls are recorded in `log`. */
function aSession(log: string[]) {
  let settleFlush: { resolve: () => void; reject: (e: unknown) => void } | null = null;
  return {
    session: {
      dispose: () => {
        log.push('session.dispose');
      },
      flush: () => {
        log.push('session.flush');
        return new Promise<void>((resolve, reject) => {
          settleFlush = { resolve, reject };
        });
      },
    },
    resolveFlush: () => {
      settleFlush?.resolve();
    },
    rejectFlush: (e: unknown) => {
      settleFlush?.reject(e);
    },
  };
}

function setup() {
  const log: string[] = [];
  const errors: unknown[] = [];
  const fake = aSession(log);
  disposeOpenSession({
    session: fake.session,
    viewport: {
      dispose: () => {
        log.push('viewport.dispose');
      },
    },
    afterFlush: {
      dispose: () => {
        log.push('storage.dispose');
      },
    },
    onError: (e) => errors.push(e),
  });
  return { log, errors, ...fake };
}

describe('disposeOpenSession', () => {
  it('releases the session and the viewport at once, the storage only after the flush', async () => {
    const { log, resolveFlush } = setup();
    expect(log).toEqual(['session.dispose', 'viewport.dispose', 'session.flush']);
    await settle();
    expect(log).not.toContain('storage.dispose');
    resolveFlush();
    await settle();
    expect(log.at(-1)).toBe('storage.dispose');
  });

  it('releases the storage also when the flush fails, and reports the error', async () => {
    const { log, errors, rejectFlush } = setup();
    const failure = new Error('write failed');
    rejectFlush(failure);
    await settle();
    expect(log.at(-1)).toBe('storage.dispose');
    expect(errors).toEqual([failure]);
  });

  it('with a real session the storage is released after the queue is written', async () => {
    const memory = createMemoryDocumentStore({ now: () => 0 });
    const gated = aGatedAppendStore(memory);
    const session = await createAppSession({
      plugins: BUILT_IN_PLUGINS,
      store: gated.store,
      docId: DOC,
      createKernel: aKernelFactory().create,
      viewport: new FakeAppViewport(),
      scheduler: createManualScheduler(),
      now: () => 0,
      ids: createSequentialIdGenerator('f'),
      translate: (key) => key,
      confirm: () => true,
      readOnly: false,
      solver: createFakeSolver(),
      download: () => undefined,
    });
    await settle();
    const edit = session.features.create('box');
    edit.commit();
    let released = false;
    disposeOpenSession({
      session,
      viewport: { dispose: () => undefined },
      afterFlush: {
        dispose: () => {
          released = true;
        },
      },
      onError: (e) => {
        throw e;
      },
    });
    await settle();
    expect(released).toBe(false);
    gated.release();
    await settle();
    expect(released).toBe(true);
    const stored = await memory.load(DOC);
    expect(stored?.entries.length).toBeGreaterThan(0);
  });
});

/** A store whose appendEntries waits until `release` is called. */
function aGatedAppendStore(inner: DocumentStore): { store: DocumentStore; release: () => void } {
  let release = (): void => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    store: {
      listDocuments: () => inner.listDocuments(),
      createDocument: (meta, initial) => inner.createDocument(meta, initial),
      deleteDocument: (id) => inner.deleteDocument(id),
      appendEntries: (id, entries) => gate.then(() => inner.appendEntries(id, entries)),
      saveSnapshot: (id, snapshot) => inner.saveSnapshot(id, snapshot),
      load: (id) => inner.load(id),
    },
    release: () => {
      release();
    },
  };
}
