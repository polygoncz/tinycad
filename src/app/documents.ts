// The document list (Q019) over a DocumentStore: listing, creating, importing (M15) and deleting
// documents.
// The store and the lock manager come in as parameters, so this runs in Node with
// MemoryDocumentStore and a fake; browser.ts hands it the IndexedDB store and navigator.locks.

import { ok } from '@/core';
import type { IdGenerator, Result } from '@/core';
import { createDocument } from '@/document';
import type { DocumentId, DocumentLoadError, DocumentMeta } from '@/document';
import { createSnapshot, importDocument } from '@/persistence';
import type { DocumentInfo, DocumentStore } from '@/persistence';
import type { FeaturePlugin } from '@/plugin-api';
import { acquireDocumentLock } from './doc-lock';
import type { DocumentLocks } from './doc-lock';
import { createPluginRegistries } from './registries';

/** The key of the name of a new document (spec 11, "Nový dokument"; ADR 0014). */
const NAME_OF_NEW_DOCUMENT = 'document.untitled';

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
