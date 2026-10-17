// The catalog of documents over DocumentService (spec 14 "Přehled", Q019, N37, N56): the list for
// the start screen, creating, renaming, deleting, importing and exporting .tinycad.json files.
// Failures reject with RemoteError. M46 task 1 fixes the contract; task 2 implements it.

import type { Transport } from '@connectrpc/connect';
import type { DocumentId, DocumentMeta } from '@/document';

/** A document of the catalog (the shape of DocumentCatalogEntry of interaction). */
export interface RemoteDocumentSummary {
  readonly meta: DocumentMeta;
  /** ms since epoch, the last change. */
  readonly updatedAt: number;
}

export interface RemoteDocuments {
  /** Most recently updated first. */
  list(): Promise<readonly RemoteDocumentSummary[]>;
  create(name: string): Promise<RemoteDocumentSummary>;
  /** document.rename of the document, open or not (DOCUMENT_OPEN during an open transaction). */
  rename(id: DocumentId, name: string): Promise<RemoteDocumentSummary>;
  /** Idempotent; an open document → DOCUMENT_OPEN. */
  remove(id: DocumentId): Promise<void>;
  /**
   * A .tinycad.json file as a new document; INVALID_DOCUMENT with issues when it does not load.
   * `operationId` makes a repeat idempotent (default a new one).
   */
  importFile(bytes: Uint8Array, operationId?: string): Promise<RemoteDocumentSummary>;
  exportFile(id: DocumentId): Promise<{ readonly content: Uint8Array; readonly fileName: string }>;
}

/** The catalog over a DocumentService client on `transport`. */
export function createRemoteDocuments(
  transport: Transport,
  newOperationId: () => string,
): RemoteDocuments {
  throw new Error('createRemoteDocuments: not implemented (M46 task 2)', {
    cause: { transport, newOperationId },
  });
}
