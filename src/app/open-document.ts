// Opening and creating a document (spec 11, "Kompoziční kořen (app)", step 2; spec 05): the
// session loads its document from the store, and a missing one is created unless the tab is
// read-only (Q038). A new document is stored the same way from the document list
// (documents.createNewDocument), so the name and the base snapshot of a new document live here.

import { createDocument } from '@/document';
import type { DocumentId, DocumentMeta, DocumentWriter, FeatureSchemaRegistry } from '@/document';
import { createOperationLog } from '@/ops';
import type { OperationLog, OpHandlerRegistry } from '@/ops';
import { createSnapshot, loadDocument } from '@/persistence';
import type { DocumentStore } from '@/persistence';
import { describeLoadError } from './load-error';

/** The key of the name of a new document (spec 11, "Nový dokument"; ADR 0014). */
const NAME_OF_NEW_DOCUMENT = 'document.untitled';

export interface OpenDocumentDeps {
  readonly store: DocumentStore;
  readonly docId: DocumentId;
  readonly schemas: FeatureSchemaRegistry;
  readonly handlers: OpHandlerRegistry;
  /** Without the document lock (Q038): a missing document is an error, not created. */
  readonly readOnly: boolean;
  /** Replay the whole log from the base and compare (spec 05). */
  readonly verify: boolean;
  /** The name of a new document (ADR 0014). */
  readonly translate: (key: string) => string;
  /** createdAt of a new document. */
  readonly now: () => number;
}

/**
 * Loads the document `docId`; a missing one is created and stored, unless read-only. Rejects
 * when the stored data cannot be loaded, a read-only document is missing or the store fails.
 */
export async function openDocument(
  deps: OpenDocumentDeps,
): Promise<{ readonly doc: DocumentWriter; readonly log: OperationLog }> {
  const { store, docId } = deps;
  const loaded = await loadDocument(store, docId, {
    schemas: deps.schemas,
    handlers: deps.handlers,
    verify: deps.verify,
  });
  if (loaded.ok) return loaded.value;
  if (loaded.error.kind !== 'not-found' || deps.readOnly) {
    throw new Error(`Cannot open document '${docId}': ${describeLoadError(loaded.error)}`);
  }
  const doc = await storeNewDocument(store, docId, deps);
  return { doc, log: createOperationLog() };
}

/**
 * Stores an empty document `id` named `translate('document.untitled')` with its base snapshot
 * and returns it. A store failure (I/O, a colliding id) rejects.
 */
export async function storeNewDocument(
  store: DocumentStore,
  id: DocumentId,
  deps: { readonly translate: (key: string) => string; readonly now: () => number },
): Promise<DocumentWriter> {
  const meta: DocumentMeta = {
    id,
    name: deps.translate(NAME_OF_NEW_DOCUMENT),
    createdAt: deps.now(),
  };
  const doc = createDocument({ meta });
  // The persistence service saves only entries; the store needs the base snapshot first.
  await store.createDocument(meta, createSnapshot(doc, 0));
  return doc;
}
