import { shallowRef } from 'vue';
import type { ShallowRef } from 'vue';
import type { DocumentId } from '@/document';

// Switching the open document (spec 11, "Dokumenty"): a change of the hash closes the old
// session – awaiting its final save – and only then opens the new one. Requests are handled one
// at a time and only the latest wins: a session opened for a document nobody wants any more is
// closed again. Generic over the session, so it runs in Node with fakes; App.vue binds it to
// openAppSession and the hashchange event.

/** What the switcher needs from a session (AppSession fits). */
export interface ClosableSession {
  close(): Promise<void>;
  dispose(): void;
}

export interface DocumentView<S> {
  /** The requested document; null = the document list. */
  readonly docId: DocumentId | null;
  /** The open session of `docId`; null while opening, after a failure and on the list. */
  readonly session: S | null;
  readonly opening: boolean;
  /** Why `docId` could not be opened. */
  readonly openError: string | null;
  /** Why the final save of the previous document failed (it is closed anyway). */
  readonly closeError: string | null;
}

export interface DocumentSwitcher<S> {
  /** Frozen snapshot; never put the session into ref()/reactive() (spec 11, rule 2). */
  readonly view: Readonly<ShallowRef<DocumentView<S>>>;
  /** Requests a document (null = the list). Resolves once every pending request is handled. */
  show(docId: DocumentId | null): Promise<void>;
  dismissCloseError(): void;
  /** Releases the open session at once (no final save awaited); later opens are released. */
  dispose(): void;
}

export function createDocumentSwitcher<S extends ClosableSession>(deps: {
  open(docId: DocumentId): Promise<S>;
}): DocumentSwitcher<S> {
  const view = shallowRef<DocumentView<S>>(
    Object.freeze({
      docId: null,
      session: null,
      opening: false,
      openError: null,
      closeError: null,
    }),
  );
  let wanted: DocumentId | null = null;
  /** The document the last open was tried for, so a failed one is not retried in a loop. */
  let attempted: DocumentId | null = null;
  let current: { readonly docId: DocumentId; readonly session: S } | null = null;
  let running: Promise<void> | null = null;
  let disposed = false;

  /** Read through a call: TS would keep the narrowing of `disposed` across an await. */
  function isDisposed(): boolean {
    return disposed;
  }

  function publish(change: Partial<DocumentView<S>>): void {
    view.value = Object.freeze({ ...view.value, ...change });
  }

  async function settle(): Promise<void> {
    for (;;) {
      const target = wanted;
      if (current !== null && current.docId !== target) {
        const old = current;
        current = null;
        publish({ session: null });
        try {
          await old.session.close();
        } catch (e) {
          publish({ closeError: errorText(e) });
        }
        continue;
      }
      if (disposed || current !== null || target === null || attempted === target) return;
      attempted = target;
      publish({ opening: true, openError: null });
      try {
        const session = await deps.open(target);
        if (isDisposed()) {
          session.dispose();
          return;
        }
        current = { docId: target, session };
        // A newer request is handled by the next round, which closes this session again.
        if (wanted === target) publish({ session });
      } catch (e) {
        if (wanted === target) publish({ openError: errorText(e) });
      } finally {
        if (!isDisposed()) publish({ opening: false });
      }
    }
  }

  return {
    view,
    show(docId) {
      if (disposed) return Promise.resolve();
      if (docId !== wanted) {
        wanted = docId;
        attempted = null;
        // The old session leaves the screen at once; it is closed (saved) in the background.
        publish({ docId, session: null, openError: null });
      }
      running ??= settle().finally(() => {
        running = null;
      });
      return running;
    },
    dismissCloseError() {
      publish({ closeError: null });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      const last = current;
      current = null;
      publish({ session: null, opening: false });
      last?.session.dispose();
    },
  };
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
