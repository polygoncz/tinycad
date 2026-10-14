// openAppSession (spec 11, "Kompoziční kořen (app)"): the thin browser layer. It builds what
// createAppSession takes as deps – the OCCT kernel worker, the IndexedDB store, the Web Lock
// (Q038), the three.js viewport and the planegcs solver worker (M12) – and releases them again. Only the e2e test covers it; the
// parts with logic (documents.ts, doc-lock.ts) are tested in Node.

import { createRandomIdGenerator, DisposableStore } from '@/core';
import type { Disposable, IdGenerator } from '@/core';
import type { Result } from '@/core';
import type { DocumentId, DocumentLoadError } from '@/document';
import type { ConfirmRequest } from '@/interaction';
import type { MeshOps } from '@/kernel';
import { createOcctKernel } from '@/kernel-occt';
import type { DocumentInfo, DocumentStore, Scheduler } from '@/persistence';
import { createIdbDocumentStore } from '@/persistence/idb';
import type { FeaturePlugin } from '@/plugin-api';
import { createViewport, DARK_PALETTE, LIGHT_PALETTE } from '@/render';
import { createPlanegcsSolver } from '@/solver-planegcs';
import { acquireDocumentLock } from './doc-lock';
import { disposeOpenSession } from './dispose-open-session';
import * as documents from './documents';
import type { DownloadFile } from './file-exporter';
import { flushOnPageHide } from './page-lifecycle';
import { createAppSession } from './session';
import type { AppSession } from './session';

export interface OpenAppSessionOptions {
  readonly docId: DocumentId;
  readonly plugins: readonly FeaturePlugin[];
  /** Translation of keys: names of new features and documents (ADR 0014). */
  readonly translate: (key: string) => string;
  /** Asks the user a yes/no question (feature.delete with dependents). */
  readonly confirm: (request: ConfirmRequest) => boolean;
  /** The theme at the start, for the palette of the viewport; later AppSession.setTheme. */
  readonly theme: 'light' | 'dark';
  /** M15: downloads an exported file (ui: a Blob and <a download>). */
  readonly download: (file: DownloadFile) => void;
}

/**
 * Opens the document in this tab. Without the document lock (another tab has it) the session
 * is read-only. Rejects like createAppSession; everything made so far is released then.
 * close waits for the final save of the session, then releases the viewport, the store and the
 * lock; dispose returns at once: it releases the viewport, the store and the lock follow when the
 * safety flush of the session has settled.
 */
export async function openAppSession(opts: OpenAppSessionOptions): Promise<AppSession> {
  // The lock and the store, plus `screen` with the viewport: disposed last, it goes first.
  const lifetime = new DisposableStore();
  try {
    // Before loading (spec 05): the lock decides whether this tab may write.
    const lock = lifetime.add(await acquireDocumentLock(navigator.locks, opts.docId));
    const store = lifetime.add(createIdbDocumentStore());
    // dispose releases the viewport (and the solver) before the store and the lock, which wait
    // for the flush.
    const screen = lifetime.add(new DisposableStore());
    // The worker starts on the first solve; released together with the viewport, after the
    // session, so no sketch session outlives it.
    const solver = screen.add(createPlanegcsSolver());
    const viewport = screen.add(
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
      confirm: opts.confirm,
      readOnly: !lock.held,
      solver,
      download: opts.download,
      theme: opts.theme,
      // Replay the whole log on every open while developing (spec 05, "verify").
      verify: import.meta.env.DEV,
    });

    // Q034: a reload right after a change must not lose the queue waiting for the delayed flush.
    const pageHide = flushOnPageHide({
      page: window,
      document,
      flush: () => session.flush(),
      onError: (error) => {
        console.error(error);
      },
    });

    // Reverse order of creation: the viewport, then the store, then the lock.
    let closing: Promise<void> | null = null;
    async function close(): Promise<void> {
      // The session saves for the last time itself; the page must not flush it any more.
      pageHide.dispose();
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
        pageHide.dispose();
        disposeOpenSession({
          session,
          viewport: screen,
          afterFlush: lifetime,
          onError: (error) => {
            console.error(error);
          },
        });
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
 * Stores a parsed document file (M15) as a new document and returns its id; a broken file is an
 * error with issues and stores nothing. The file is checked against the registries of `plugins`.
 */
export function importDocumentFile(
  raw: unknown,
  opts: { readonly plugins: readonly FeaturePlugin[] },
): Promise<Result<DocumentId, DocumentLoadError>> {
  return withStore((store) =>
    documents.importDocumentFile(store, raw, {
      plugins: opts.plugins,
      ids: randomIds(),
      now: Date.now,
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
