// The document list (spec 11, "Seznam dokumentů"; Q019) as a presentation model (ADR 0010; M20,
// A3.5): the state of loading (never an endless "Loading…", M19.1 U11), one action at a time
// (busy), the confirmation of a delete, delete → load again, the rename of a card (M19.2, D5)
// and the import of a document file (M15, R126). The documents come through the port
// DocumentCatalog (ADR 0011), which app implements over the store; the yes/no question through a
// port ui supplies. The component only draws the state and opens the returned ids.

import { ObservableValue } from '@/core';
import type { Observable, Result } from '@/core';
import type { DocumentId, DocumentLoadError, DocumentMeta } from '@/document';
import type { ConfirmRequest } from './builtin-actions';

/** A document of the list: its meta and the time of its last change (ms since epoch). */
export interface DocumentCatalogEntry {
  readonly meta: DocumentMeta;
  readonly updatedAt: number;
}

/** Port: the stored documents. Every method may reject (I/O, a lock held by another tab). */
export interface DocumentCatalog {
  /** Newest first. */
  list(): Promise<readonly DocumentCatalogEntry[]>;
  /** Stores an empty document and returns its id. */
  create(): Promise<DocumentId>;
  /** Stores a parsed document file as a new document; a broken file is an error with issues. */
  importFile(raw: unknown): Promise<Result<DocumentId, DocumentLoadError>>;
  /** Deletes the document; rejects when it is open in another tab. */
  remove(id: DocumentId): Promise<void>;
  /** Renames the document; rejects when it is open in another tab or the name is empty. */
  rename(id: DocumentId, name: string): Promise<void>;
}

/** Loading, the loaded list (maybe empty) or a failure with its technical text. */
export type DocumentListState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'loaded'; readonly documents: readonly DocumentCatalogEntry[] }
  /** error: the technical text, shown inside the translated sentence. */
  | { readonly kind: 'failed'; readonly error: string };

/** The error of an action: a translation key with its params, the detail for the tooltip. */
export interface DocumentListError {
  readonly key: string;
  readonly params: Readonly<Record<string, string>>;
  readonly detail: string | null;
}

export interface DocumentListModel {
  /** Starts 'loading'; load fills it. Frozen. */
  readonly list: Observable<DocumentListState>;
  /** An action (create, import, delete, rename) runs; every other action does nothing meanwhile. */
  readonly busy: Observable<boolean>;
  /** The error of the last action; a new action clears it. A failed load is a state of `list`. */
  readonly error: Observable<DocumentListError | null>;
  /** The card whose name is being edited. */
  readonly renaming: Observable<DocumentId | null>;
  /** Loads the list again; the cards stay until the new list is there. Never rejects. */
  load(): Promise<void>;
  /** Try again after a failed load: 'loading' until it settles. */
  retry(): Promise<void>;
  /** Stores an empty document → its id; null when busy or on a failure (documents.error.create). */
  create(): Promise<DocumentId | null>;
  /**
   * Reads the chosen file and stores it as a new document → its id; null when busy or on a
   * failure (documents.importError with the detail). `readText` is ui's, reading may reject.
   */
  importFile(readText: () => Promise<string>): Promise<DocumentId | null>;
  /**
   * Asks (documents.confirmDelete), then deletes and loads the list again. Busy or a refusal:
   * nothing. A failure: documents.error.delete.
   */
  remove(entry: DocumentCatalogEntry): Promise<void>;
  /** Starts editing the name of the card; false when busy. */
  beginRename(id: DocumentId): boolean;
  /**
   * Enter or leaving the field: ends the edit, then renames the card being edited and loads the
   * list again. No edit (a blur after Enter), the unchanged name of `entry` or busy: nothing. A
   * failure: documents.error.rename.
   */
  commitRename(entry: DocumentCatalogEntry, name: string): Promise<void>;
  /** Esc: ends the edit without a call. */
  cancelRename(): void;
}

export function createDocumentListModel(deps: {
  readonly catalog: DocumentCatalog;
  /** Asks the user a yes/no question; ui shows the dialog, maybe asynchronously. */
  readonly confirm: (request: ConfirmRequest) => boolean | Promise<boolean>;
}): DocumentListModel {
  const { catalog } = deps;
  const list = new ObservableValue<DocumentListState>(Object.freeze({ kind: 'loading' }));
  const busy = new ObservableValue(false);
  const error = new ObservableValue<DocumentListError | null>(null);
  const renaming = new ObservableValue<DocumentId | null>(null);

  async function load(): Promise<void> {
    list.set(await loadDocumentList(() => catalog.list()));
  }

  function fail(key: string, e: unknown): void {
    error.set(Object.freeze({ key, params: Object.freeze({ error: errorText(e) }), detail: null }));
  }

  /** Runs `action` as the one action of the list: busy meanwhile, the last error cleared. */
  async function exclusive<T>(action: () => Promise<T>): Promise<T> {
    busy.set(true);
    error.set(null);
    try {
      return await action();
    } finally {
      busy.set(false);
    }
  }

  async function create(): Promise<DocumentId | null> {
    if (busy.get()) return null;
    return exclusive(async () => {
      try {
        return await catalog.create();
      } catch (e) {
        fail('documents.error.create', e);
        return null;
      }
    });
  }

  async function importFile(readText: () => Promise<string>): Promise<DocumentId | null> {
    if (busy.get()) return null;
    // importDocumentText never rejects; only reading the file can.
    const outcome = await exclusive(() =>
      readText().then(
        (text) => importDocumentText(text, (raw) => catalog.importFile(raw)),
        (e: unknown): ImportOutcome => ({ ok: false, detail: errorText(e) }),
      ),
    );
    if (outcome.ok) return outcome.id;
    error.set(
      Object.freeze({
        key: 'documents.importError',
        params: Object.freeze({}),
        detail: outcome.detail,
      }),
    );
    return null;
  }

  async function remove(entry: DocumentCatalogEntry): Promise<void> {
    if (busy.get()) return;
    const yes = await deps.confirm({
      key: 'documents.confirmDelete',
      params: { name: entry.meta.name },
    });
    // An asynchronous dialog leaves room for another action.
    if (!yes || busy.get()) return;
    await exclusive(async () => {
      try {
        await catalog.remove(entry.meta.id);
        await load();
      } catch (e) {
        fail('documents.error.delete', e);
      }
    });
  }

  function beginRename(id: DocumentId): boolean {
    if (busy.get()) return false;
    renaming.set(id);
    return true;
  }

  async function commitRename(entry: DocumentCatalogEntry, name: string): Promise<void> {
    const id = renaming.get();
    renaming.set(null);
    if (id === null || name === entry.meta.name || busy.get()) return;
    await exclusive(async () => {
      try {
        await catalog.rename(id, name);
        await load();
      } catch (e) {
        fail('documents.error.rename', e);
      }
    });
  }

  return Object.freeze({
    list: list.asObservable(),
    busy: busy.asObservable(),
    error: error.asObservable(),
    renaming: renaming.asObservable(),
    load,
    retry: () => {
      list.set(Object.freeze({ kind: 'loading' }));
      return load();
    },
    create,
    importFile,
    remove,
    beginRename,
    commitRename,
    cancelRename: () => {
      renaming.set(null);
    },
  });
}

/** Loads the list; never rejects: a failure is the state 'failed'. Frozen. */
async function loadDocumentList(
  list: () => Promise<readonly DocumentCatalogEntry[]>,
): Promise<DocumentListState> {
  try {
    const documents = await list();
    return Object.freeze({ kind: 'loaded', documents });
  } catch (e) {
    return Object.freeze({ kind: 'failed', error: errorText(e) });
  }
}

/** ok: the new document; otherwise `detail` (the first issue, `path: message`) for the tooltip. */
type ImportOutcome =
  | { readonly ok: true; readonly id: DocumentId }
  | { readonly ok: false; readonly detail: string | null };

/**
 * Stores the document file `text` (M15, R126): JSON.parse → importFile. Never rejects: a text that
 * is not JSON, a refused file and a rejection of importFile (a storage error, its message as the
 * detail) all give `ok: false`.
 */
export async function importDocumentText(
  text: string,
  importFile: (raw: unknown) => Promise<Result<DocumentId, DocumentLoadError>>,
): Promise<ImportOutcome> {
  let result: Result<DocumentId, DocumentLoadError>;
  try {
    result = await importFile(JSON.parse(text));
  } catch (e) {
    return { ok: false, detail: errorText(e) };
  }
  if (result.ok) return { ok: true, id: result.value };
  const first = result.error.issues[0];
  return { ok: false, detail: first === undefined ? null : `${first.path}: ${first.message}` };
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
