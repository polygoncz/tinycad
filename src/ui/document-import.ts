import type { Result } from '@/core';
import type { DocumentId, DocumentLoadError } from '@/document';

// Import of a document file in the DocumentList (spec 11, "Komponenty", M15, R126): the text of
// the chosen file → JSON.parse → app's importDocumentFile. A pure function of the text, so the
// component only reads the file and shows the outcome (rule 4).

/** ok: the new document; otherwise `detail` (the first issue, `path: message`) for the tooltip. */
export type ImportOutcome =
  | { readonly ok: true; readonly id: DocumentId }
  | { readonly ok: false; readonly detail: string | null };

/**
 * Stores the document file `text`. Never rejects: a text that is not JSON, a refused file and a
 * rejection of importFile (a storage error, its message as the detail) all give `ok: false`.
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
