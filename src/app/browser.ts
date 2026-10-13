// openAppSession (spec 11, "Kompoziční kořen (app)"): the thin browser layer. It builds what
// createAppSession takes as deps – the OCCT kernel worker, the IndexedDB store, the Web Lock
// (Q038) and the three.js viewport – and releases them again. Only the e2e test covers it; the
// parts with logic (documents.ts, doc-lock.ts) are tested in Node.

import { createRandomIdGenerator, DisposableStore } from '@/core';
import type { Disposable, IdGenerator } from '@/core';
import type { DocumentId } from '@/document';
import type { MeshOps } from '@/kernel';
import { createOcctKernel } from '@/kernel-occt';
import type { DocumentInfo, DocumentStore, Scheduler } from '@/persistence';
import { createIdbDocumentStore } from '@/persistence/idb';
import type { FeaturePlugin } from '@/plugin-api';
import { createViewport, DARK_PALETTE, LIGHT_PALETTE } from '@/render';
import { acquireDocumentLock } from './doc-lock';
import * as documents from './documents';
import { createAppSession } from './session';
import type { AppSession } from './session';

export interface OpenAppSessionOptions {
  readonly docId: DocumentId;
  readonly plugins: readonly FeaturePlugin[];
  /** Translation of keys: names of new features and documents (ADR 0014). */
  readonly translate: (key: string) => string;
  /** The theme at the start, for the palette of the viewport; later AppSession.setTheme. */
  readonly theme: 'light' | 'dark';
}

/**
 * Opens the document in this tab. Without the document lock (another tab has it) the session
 * is read-only. Rejects like createAppSession; everything made so far is released then.
 * close waits for the final save of the session, then releases the viewport, the store and the
 * lock; dispose releases everything at once without waiting for the save.
 */
export async function openAppSession(opts: OpenAppSessionOptions): Promise<AppSession> {
  const lifetime = new DisposableStore();
  try {
    // Before loading (spec 05): the lock decides whether this tab may write.
    const lock = lifetime.add(await acquireDocumentLock(navigator.locks, opts.docId));
    const store = lifetime.add(createIdbDocumentStore());
    const viewport = lifetime.add(
      createViewport({
        meshes: NO_KERNEL_YET,
        palette: opts.theme === 'dark' ? DARK_PALETTE : LIGHT_PALETTE,
      }),
    );
    const session = await createAppSession({
      plugins: opts.plugins,
      store,
      docId: opts.docId,
      createKernel: createOcctKernel,
      viewport,
      scheduler: TIMER_SCHEDULER,
      now: Date.now,
      ids: randomIds(),
      translate: opts.translate,
      readOnly: !lock.held,
      // Replay the whole log on every open while developing (spec 05, "verify").
      verify: import.meta.env.DEV,
    });

    // Reverse order of creation: the viewport, then the store, then the lock.
    let closing: Promise<void> | null = null;
    async function close(): Promise<void> {
      try {
        await session.close();
      } finally {
        lifetime.dispose();
      }
    }
    return Object.freeze({
      ...session,
      close() {
        closing ??= close();
        return closing;
      },
      dispose() {
        session.dispose();
        lifetime.dispose();
      },
    });
  } catch (e) {
    lifetime.dispose();
    throw e;
  }
}

/** All documents, newest first (DocumentList, Q019). */
export function listDocuments(): Promise<readonly DocumentInfo[]> {
  return withStore((store) => documents.listDocuments(store));
}

/** Stores an empty document named `translate('document.untitled')` and returns its id. */
export function createNewDocument(opts: {
  readonly translate: (key: string) => string;
}): Promise<DocumentId> {
  return withStore((store) =>
    documents.createNewDocument(store, {
      ids: randomIds(),
      now: Date.now,
      translate: opts.translate,
    }),
  );
}

/**
 * Deletes the document with its history; a missing id does nothing. Rejects when the document
 * is open in another tab (its lock is held).
 */
export function deleteDocument(id: DocumentId): Promise<void> {
  return withStore((store) => documents.deleteDocument({ store, locks: navigator.locks }, id));
}

/** A store worker for one call of the document list, terminated after it. */
async function withStore<T>(call: (store: DocumentStore) => Promise<T>): Promise<T> {
  const store = createIdbDocumentStore();
  try {
    return await call(store);
  } finally {
    store.dispose();
  }
}

/** Ids of Q002 from the crypto random source (Q022). */
function randomIds(): IdGenerator {
  return createRandomIdGenerator((bytes) => crypto.getRandomValues(bytes));
}

const TIMER_SCHEDULER: Scheduler = {
  schedule(fn, ms): Disposable {
    const handle = setTimeout(fn, ms);
    return {
      dispose: () => {
        clearTimeout(handle);
      },
    };
  },
};

/**
 * MeshOps the viewport is created with. app hands it the real kernel through bodies.reset
 * before the first sync (spec 11, "Jádro startuje na pozadí"), so this is never called.
 */
const NO_KERNEL_YET: MeshOps = {
  tessellate: () => Promise.reject(new Error('The viewport has no kernel yet')),
};
