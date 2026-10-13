// The document list (Q019) over a DocumentStore: listing, creating and deleting documents.
// The store comes in as a parameter, so this runs in Node with MemoryDocumentStore; browser.ts
// hands it the IndexedDB store.

import type { IdGenerator } from '@/core';
import { createDocument } from '@/document';
import type { DocumentId, DocumentMeta } from '@/document';
import { createSnapshot } from '@/persistence';
import type { DocumentInfo, DocumentStore } from '@/persistence';

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

/** Deletes the document with its log and snapshots; a missing id does nothing. */
export function deleteDocument(store: DocumentStore, id: DocumentId): Promise<void> {
  return store.deleteDocument(id);
}
