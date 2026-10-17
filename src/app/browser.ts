// openAppSession (spec 11, "Kompoziční kořen (app)"): the thin browser layer. It builds what
// createAppSession takes as deps – the OCCT kernel worker, the IndexedDB store, the Web Lock
// (Q038), the three.js viewport, the planegcs solver worker (M12) and the text outliner over the
// bundled fonts (M37) – and releases them again. Only the e2e test covers it; the
// parts with logic (documents.ts, doc-lock.ts) are tested in Node.

import { createRandomIdGenerator, DisposableStore } from '@/core';
import type { Disposable, IdGenerator } from '@/core';
import type { DocumentId } from '@/document';
import { createDocumentListModel, HANDLE_VISIBILITY, MANIPULATOR_GLYPHS } from '@/interaction';
import type { ConfirmRequest, DocumentListModel } from '@/interaction';
import type { MeshOps } from '@/kernel';
import { createOcctKernel } from '@/kernel-occt';
import type { DocumentStore, Scheduler } from '@/persistence';
import { createIdbDocumentStore } from '@/persistence/idb';
import type { FeaturePlugin } from '@/plugin-api';
import { createViewport } from '@/render';
import { createPlanegcsSolver } from '@/solver-planegcs';
import type { TextFontId } from '@/sketch';
import { createOpentypeOutliner, fontUrl } from '@/text-opentype';
import { acquireDocumentLock } from './doc-lock';
import { disposeOpenSession } from './dispose-open-session';
import { createDocumentCatalog } from './documents';
import type { DownloadFile } from './file-exporter';
import { flushOnPageHide } from './page-lifecycle';
import { createAppSession } from './session';
import { paletteOf } from './view-settings';
import type { AppSession } from './session';

export interface OpenAppSessionOptions {
  readonly docId: DocumentId;
  readonly plugins: readonly FeaturePlugin[];
  /** Translation of keys: names of new features and documents (ADR 0014). */
  readonly translate: (key: string) => string;
  /** Asks the user a yes/no question (feature.delete with dependents). */
  readonly confirm: (request: ConfirmRequest) => boolean;
  /** The theme at the start, for the palette of the viewport; later AppSession.viewSettings.setTheme. */
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
        palette: paletteOf(opts.theme),
        // render may take only types from interaction, so the values come from here (M20).
        manipulatorGlyphs: MANIPULATOR_GLYPHS,
        handleVisibility: HANDLE_VISIBILITY,
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
      // Not unbound: performance.now needs `performance` as `this`.
      monotonic: () => performance.now(),
      ids: randomIds(),
      translate: opts.translate,
      confirm: opts.confirm,
      readOnly: !lock.held,
      solver,
      // M37: the bundled fonts are fetched on the first text in each of them.
      text: createOpentypeOutliner(loadFont),
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

/** What createDocumentList needs from ui. */
export interface DocumentListOptions {
  /** The plugins of the sessions: an imported file is checked and a renamed log replayed with them. */
  readonly plugins: readonly FeaturePlugin[];
  /** Translation of keys: the name of a new document (ADR 0014). */
  readonly translate: (key: string) => string;
  /** Asks the user a yes/no question (deleting a document); ui shows the dialog. */
  readonly confirm: (request: ConfirmRequest) => boolean | Promise<boolean>;
}

/**
 * The model of the DocumentList (Q019, M20 A3.5) over the IndexedDB store: a store worker per
 * call of the catalog, the Web Lock of a document for deleting and renaming (refused when the
 * document is open in another tab). Holds nothing between calls, so it needs no dispose.
 */
export function createDocumentList(opts: DocumentListOptions): DocumentListModel {
  return createDocumentListModel({
    catalog: createDocumentCatalog({
      withStore,
      locks: navigator.locks,
      plugins: opts.plugins,
      ids: randomIds(),
      now: Date.now,
      translate: opts.translate,
    }),
    confirm: opts.confirm,
  });
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

/**
 * The bytes of a bundled font (M37, spec 12 "Adaptér text-opentype") over its Vite URL; an HTTP
 * error rejects, so the outliner does not keep the font and tries again next time.
 */
async function loadFont(font: TextFontId): Promise<ArrayBuffer> {
  const response = await fetch(fontUrl(font));
  if (!response.ok)
    throw new Error(`Font '${font}' failed to load: HTTP ${String(response.status)}`);
  return response.arrayBuffer();
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
