// openAppSession (spec 11, "Kompoziční kořen (app)"): the thin browser layer. Since M46 (N68) the
// native core is the only path: it builds what createRemoteAppSession takes as deps – the
// gRPC-Web transport to the core, the three.js viewport, the planegcs solver worker (M12), the
// text outliner over the bundled fonts (M37), timers and the sessionStorage of the session (N70) –
// and releases them again. The document list goes over DocumentService too. Only the e2e test covers this file; the parts with logic are tested
// in Node.

import { createRandomIdGenerator, DisposableStore } from '@/core';
import type { Disposable, IdGenerator } from '@/core';
import type { DocumentId } from '@/document';
import { createDocumentListModel, HANDLE_VISIBILITY, MANIPULATOR_GLYPHS } from '@/interaction';
import type { ConfirmRequest, DocumentListModel } from '@/interaction';
import type { MeshOps } from '@/kernel';
import type { FeaturePlugin } from '@/plugin-api';
import { createCoreTransport, createRemoteDocuments, createRemoteSketchGeometry } from '@/remote';
import type { SessionResumeStore, Timers } from '@/remote';
import { createViewport } from '@/render';
import { createPlanegcsSolver } from '@/solver-planegcs';
import type { TextFontId } from '@/sketch';
import { createOpentypeOutliner, fontUrl } from '@/text-opentype';
import type { AppSession, DownloadFile } from './app-session';
import { createRemoteAppSession } from './remote-session';
import { createRemoteDocumentsCatalog } from './remote-documents-catalog';
import { paletteOf } from './view-settings';

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
 * Opens the document in this tab over the core. Read-only when another tab holds it (Q102).
 * Rejects like createRemoteAppSession; everything made so far is released then. close waits for
 * the empty queue of changes and closes the session on the core, then releases the viewport and
 * the solver; dispose returns at once. The page going away (pagehide) closes the session best
 * effort with keepalive (N70); a reload resumes it through sessionStorage if the close got lost.
 */
export async function openAppSession(opts: OpenAppSessionOptions): Promise<AppSession> {
  // The viewport and the solver: disposed after the session.
  const screen = new DisposableStore();
  try {
    const transport = coreTransport();
    // The worker starts on the first solve.
    const solver = screen.add(createPlanegcsSolver());
    const viewport = screen.add(
      createViewport({
        meshes: NO_MESHES_YET,
        palette: paletteOf(opts.theme),
        // render may take only types from interaction, so the values come from here (M20).
        manipulatorGlyphs: MANIPULATOR_GLYPHS,
        handleVisibility: HANDLE_VISIBILITY,
      }),
    );
    const session = await createRemoteAppSession({
      plugins: opts.plugins,
      transport,
      docId: opts.docId,
      viewport,
      timers: TIMERS,
      resume: sessionResume(opts.docId),
      newOperationId: () => crypto.randomUUID(),
      ids: randomIds(),
      translate: opts.translate,
      confirm: opts.confirm,
      solver,
      // M37: the bundled fonts are fetched on the first text in each of them.
      text: createOpentypeOutliner(loadFont),
      // N68: the geometry of the sketch always over GeometryService of the core.
      geometry: createRemoteSketchGeometry(transport),
      download: opts.download,
      theme: opts.theme,
    });

    // N70: closing the tab or a reload closes the session (the lock goes at once); a page
    // restored from the back-forward cache has a closed session, so it loads again.
    const onPageHide = (): void => {
      session.dispose();
      screen.dispose();
    };
    const onPageShow = (e: PageTransitionEvent): void => {
      if (e.persisted) window.location.reload();
    };
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('pageshow', onPageShow);
    const unbindPage = (): void => {
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', onPageShow);
    };

    let closing: Promise<void> | null = null;
    async function close(): Promise<void> {
      unbindPage();
      try {
        await session.close();
      } finally {
        screen.dispose();
      }
    }
    return Object.freeze({
      ...session,
      close() {
        closing ??= close();
        return closing;
      },
      dispose() {
        unbindPage();
        try {
          session.dispose();
        } finally {
          screen.dispose();
        }
      },
    });
  } catch (e) {
    screen.dispose();
    throw e;
  }
}

/** What createDocumentList needs from ui. */
export interface DocumentListOptions {
  /** Translation of keys: the name of a new document (ADR 0014). */
  readonly translate: (key: string) => string;
  /** Asks the user a yes/no question (deleting a document); ui shows the dialog. */
  readonly confirm: (request: ConfirmRequest) => boolean | Promise<boolean>;
}

/**
 * The model of the DocumentList (Q019, M20 A3.5) over DocumentService of the core (N68): the
 * server refuses deleting a document open in a session. Holds nothing between calls, so it needs
 * no dispose.
 */
export function createDocumentList(opts: DocumentListOptions): DocumentListModel {
  return createDocumentListModel({
    catalog: createRemoteDocumentsCatalog({
      documents: createRemoteDocuments(coreTransport(), () => crypto.randomUUID()),
      translate: opts.translate,
    }),
    confirm: opts.confirm,
  });
}

/** The core behind Envoy: '/api' (the Vite proxy) unless VITE_CORE_URL says otherwise (N68). */
function coreTransport(): ReturnType<typeof createCoreTransport> {
  return createCoreTransport(import.meta.env.VITE_CORE_URL || '/api');
}

/** The session id of the document in this tab, kept across a reload (N70). */
function sessionResume(docId: DocumentId): SessionResumeStore {
  const key = `tinycad.session.${docId}`;
  return {
    load: () => sessionStorage.getItem(key),
    save: (id) => {
      if (id === null) sessionStorage.removeItem(key);
      else sessionStorage.setItem(key, id);
    },
  };
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

const TIMERS: Timers = {
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
 * MeshOps the viewport is created with. The session hands it the meshes by content version
 * through bodies.reset before the first sync (N66), so this is never called.
 */
const NO_MESHES_YET: MeshOps = {
  tessellate: () => Promise.reject(new Error('The viewport has no meshes yet')),
};
