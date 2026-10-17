// The port DocumentCatalog of interaction's DocumentListModel (Q019, M20 A3.5) over DocumentService
// of the core (M46, N68): the list, a new document, the import of a .tinycad.json file, deleting
// and renaming. The server keeps the rules (the name is trimmed there, an open document refuses
// to be deleted); this adapter only translates the shapes and the errors the list shows today.

import { err, ok } from '@/core';
import type { Result } from '@/core';
import type { DocumentId, DocumentLoadError, DocumentLoadIssue } from '@/document';
import type { DocumentCatalog } from '@/interaction';
import { RemoteError } from '@/remote';
import type { RemoteDocuments } from '@/remote';

export interface RemoteDocumentsCatalogDeps {
  readonly documents: RemoteDocuments;
  /** The name of a new document: translate('document.untitled') (ADR 0014). */
  readonly translate: (key: string) => string;
}

export function createRemoteDocumentsCatalog(deps: RemoteDocumentsCatalogDeps): DocumentCatalog {
  const { documents, translate } = deps;
  return Object.freeze({
    list: () => documents.list(),
    async create(): Promise<DocumentId> {
      const created = await documents.create(translate('document.untitled'));
      return created.meta.id;
    },
    async importFile(raw: unknown): Promise<Result<DocumentId, DocumentLoadError>> {
      const bytes = new TextEncoder().encode(JSON.stringify(raw));
      try {
        const imported = await documents.importFile(bytes);
        return ok(imported.meta.id);
      } catch (e) {
        if (e instanceof RemoteError && e.reason === 'INVALID_DOCUMENT') {
          return err(Object.freeze({ issues: Object.freeze(loadIssuesOf(e)) }));
        }
        throw e;
      }
    },
    async remove(id: DocumentId): Promise<void> {
      await refusingOpen(id, () => documents.remove(id));
    },
    async rename(id: DocumentId, name: string): Promise<void> {
      await refusingOpen(id, () => documents.rename(id, name));
    },
  });
}

/**
 * Runs a call of a document; DOCUMENT_OPEN rejects with the text of today's lock refusal ("open
 * in another tab"), which the list shows inside its error sentence.
 */
async function refusingOpen<T>(id: DocumentId, call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (e) {
    if (e instanceof RemoteError && e.reason === 'DOCUMENT_OPEN') {
      throw new Error(`Document '${id}' is open in another tab`, { cause: e });
    }
    throw e;
  }
}

/**
 * The issues of INVALID_DOCUMENT → DocumentLoadIssue: the server sends every load issue as
 * { param: <path>, code: 'document.loadIssue', params: { message } } (spec 14 "Chyby").
 */
function loadIssuesOf(error: RemoteError): DocumentLoadIssue[] {
  return error.issues.map((issue) => {
    const message = issue.params?.['message'];
    return Object.freeze({
      path: issue.param,
      message: typeof message === 'string' ? message : issue.code,
    });
  });
}
