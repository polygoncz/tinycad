// The catalog of documents over DocumentService (spec 14 "Přehled", Q019, N37, N56): the list for
// the start screen, creating, renaming, deleting, importing and exporting .tinycad.json files.
// Failures reject with RemoteError. A catalog call is not repeated: the start screen shows the
// error and the user tries again (the session repeats its changes, spec 14 "Chyby").

import { createClient } from '@connectrpc/connect';
import type { Client, Transport } from '@connectrpc/connect';
import { timestampMs } from '@bufbuild/protobuf/wkt';
import type { DocumentId, DocumentMeta } from '@/document';
import { DocumentService } from '@/protocol';
import type { DocumentSummary } from '@/protocol';
import { decoding, toRemoteError } from './errors';

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
  return new RemoteDocumentsImpl(createClient(DocumentService, transport), newOperationId);
}

class RemoteDocumentsImpl implements RemoteDocuments {
  private readonly client: Client<typeof DocumentService>;
  private readonly newOperationId: () => string;

  constructor(client: Client<typeof DocumentService>, newOperationId: () => string) {
    this.client = client;
    this.newOperationId = newOperationId;
  }

  async list(): Promise<readonly RemoteDocumentSummary[]> {
    const res = await call(() => this.client.listDocuments({}));
    return decoding('document list', () => Object.freeze(res.documents.map(summaryOf)));
  }

  async create(name: string): Promise<RemoteDocumentSummary> {
    const res = await call(() =>
      this.client.createDocument({ operationId: this.newOperationId(), name }),
    );
    return decodeSummary(res.document);
  }

  async rename(id: DocumentId, name: string): Promise<RemoteDocumentSummary> {
    const res = await call(() =>
      this.client.renameDocument({ operationId: this.newOperationId(), documentId: id, name }),
    );
    return decodeSummary(res.document);
  }

  async remove(id: DocumentId): Promise<void> {
    await call(() => this.client.deleteDocument({ documentId: id }));
  }

  async importFile(bytes: Uint8Array, operationId?: string): Promise<RemoteDocumentSummary> {
    const res = await call(() =>
      this.client.importDocument({
        operationId: operationId ?? this.newOperationId(),
        content: bytes,
      }),
    );
    return decodeSummary(res.document);
  }

  async exportFile(
    id: DocumentId,
  ): Promise<{ readonly content: Uint8Array; readonly fileName: string }> {
    const res = await call(() => this.client.exportDocument({ documentId: id }));
    return Object.freeze({ content: res.content, fileName: res.fileName });
  }
}

/** Runs one RPC; a failure rejects as RemoteError. */
async function call<Res>(rpc: () => Promise<Res>): Promise<Res> {
  try {
    return await rpc();
  } catch (e) {
    throw toRemoteError(e);
  }
}

function decodeSummary(summary: DocumentSummary | undefined): RemoteDocumentSummary {
  return decoding('document summary', () => {
    if (summary === undefined) throw new Error('document is missing');
    return summaryOf(summary);
  });
}

/** DocumentSummary → RemoteDocumentSummary; a missing timestamp is a broken answer. */
function summaryOf(summary: DocumentSummary): RemoteDocumentSummary {
  if (summary.created === undefined || summary.updated === undefined) {
    throw new Error(`timestamps of ${summary.documentId} are missing`);
  }
  const meta: DocumentMeta = Object.freeze({
    id: summary.documentId as DocumentId, // the id of the catalog of the server (spec 14)
    name: summary.name,
    createdAt: timestampMs(summary.created),
  });
  return Object.freeze({ meta, updatedAt: timestampMs(summary.updated) });
}
