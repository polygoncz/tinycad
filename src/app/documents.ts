// The document list (Q019) over a DocumentStore: listing, creating, importing (M15), deleting
// and renaming (M19.2) documents.
// The store and the lock manager come in as parameters, so this runs in Node with
// MemoryDocumentStore and a fake; browser.ts hands it the IndexedDB store and navigator.locks.

import { ObservableValue, ok } from '@/core';
import type { IdGenerator, Result } from '@/core';
import { createDocument } from '@/document';
import type { DocumentId, DocumentLoadError, DocumentMeta } from '@/document';
import { createDocumentNameModel } from '@/interaction';
import { createOperationDispatcher } from '@/ops';
import { createSnapshot, importDocument, loadDocument } from '@/persistence';
import type { DocumentInfo, DocumentStore } from '@/persistence';
import type { FeaturePlugin } from '@/plugin-api';
import { acquireDocumentLock } from './doc-lock';
import type { DocumentLocks } from './doc-lock';
import { describeLoadError } from './load-error';
import { createPluginRegistries } from './registries';

/** The key of the name of a new document (spec 11, "Nový dokument"; ADR 0014). */
const NAME_OF_NEW_DOCUMENT = 'document.untitled';

/** The lock of renameDocument: no feature dialog and no read-only session over a closed document. */
const NOT_LOCKED = new ObservableValue(false).asObservable();

/** Newest first (the order of DocumentStore.listDocuments). */
export function listDocuments(store: DocumentStore): Promise<readonly DocumentInfo[]> {
  return store.listDocuments();
}

/**
 * Stores an empty document named `translate('document.untitled')` with its base snapshot and
 * returns its id. A store failure (I/O, a colliding id) rejects.
 */
export async function createNewDocument(
  store: DocumentStore,
  deps: {
    readonly ids: IdGenerator;
    readonly now: () => number;
    readonly translate: (key: string) => string;
  },
): Promise<DocumentId> {
  const meta: DocumentMeta = {
    // Brand: a fresh id from the generator is a document id by construction.
    id: deps.ids.next() as DocumentId,
    name: deps.translate(NAME_OF_NEW_DOCUMENT),
    createdAt: deps.now(),
  };
  await store.createDocument(meta, createSnapshot(createDocument({ meta }), 0));
  return meta.id;
}

/**
 * Stores a document file (M15, spec 05 "Export a import souboru") as a new document and returns
 * its id. `raw` is the parsed JSON (ui parses the text). The file is checked against the
 * registries of `plugins`, the same a session builds; a broken file is an error with issues and
 * stores nothing. A store failure rejects.
 */
export async function importDocumentFile(
  store: DocumentStore,
  raw: unknown,
  deps: {
    readonly plugins: readonly FeaturePlugin[];
    readonly ids: IdGenerator;
    readonly now: () => number;
  },
): Promise<Result<DocumentId, DocumentLoadError>> {
  const { schemas, handlers } = createPluginRegistries(deps.plugins);
  const imported = await importDocument(store, raw, {
    schemas,
    handlers,
    // Brand: a fresh id from the generator is a document id by construction.
    newId: deps.ids.next() as DocumentId,
    now: deps.now(),
  });
  return imported.ok ? ok(imported.value.id) : imported;
}

/**
 * Deletes the document with its log and snapshots; a missing id does nothing. Takes the lock of
 * the document first (spec 11, "Smazání dokumentu"): a document open in another tab is refused.
 */
export async function deleteDocument(
  deps: { readonly store: DocumentStore; readonly locks: DocumentLocks },
  id: DocumentId,
): Promise<void> {
  const lock = await acquireDocumentLock(deps.locks, id);
  try {
    if (!lock.held) throw new Error(`Document '${id}' is open in another tab`);
    await deps.store.deleteDocument(id);
  } finally {
    lock.dispose();
  }
}

/**
 * Renames a document of the list (M19.2, D5) the way an open session does: through
 * DocumentNameModel.rename, so the rule of the name (trimmed, not empty, the same name = no
 * operation) lives in one place, and a document.rename entry appended to its log, so a reload,
 * the list (appendEntries sets the listed name) and an exported file all carry the new name.
 * Takes the lock of the document first, like deleteDocument: a document open in another tab is
 * refused. The same name writes nothing; an empty name, a document that cannot be loaded and a
 * store failure reject.
 */
export async function renameDocument(
  deps: {
    readonly store: DocumentStore;
    readonly locks: DocumentLocks;
    /** For the registries loadDocument replays the log with, as importDocumentFile. */
    readonly plugins: readonly FeaturePlugin[];
    /** LogEntry.time of the new entry. */
    readonly now: () => number;
  },
  id: DocumentId,
  name: string,
): Promise<void> {
  const lock = await acquireDocumentLock(deps.locks, id);
  try {
    if (!lock.held) throw new Error(`Document '${id}' is open in another tab`);
    const { schemas, handlers } = createPluginRegistries(deps.plugins);
    const loaded = await loadDocument(deps.store, id, { schemas, handlers });
    if (!loaded.ok) {
      throw new Error(`Cannot rename document '${id}': ${describeLoadError(loaded.error)}`);
    }
    const { doc, log } = loaded.value;
    const before = log.lastSeq;
    const ops = createOperationDispatcher({ doc, handlers, log, now: deps.now });
    // No session and no dialog here: nothing locks the name.
    const model = createDocumentNameModel({ doc, ops, locked: NOT_LOCKED });
    const renamed = model.rename(name);
    model.dispose();
    if (!renamed) throw new Error('The name of a document must not be empty');
    const appended = log.entries(before + 1);
    if (appended.length > 0) await deps.store.appendEntries(id, appended);
  } finally {
    lock.dispose();
  }
}
