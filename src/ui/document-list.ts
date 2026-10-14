import type { DocumentInfo } from '@/app';

// The states of the document list (spec 11, "Komponenty"; M19.1 Ú13, revize U11): loading, the
// loaded list (maybe empty) or a failure with its error and a way to try again – never an endless
// "Loading…". The time of the last change has one formatter for the whole list.

export type DocumentListState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'loaded'; readonly documents: readonly DocumentInfo[] }
  /** error: the technical text, shown inside the translated sentence. */
  | { readonly kind: 'failed'; readonly error: string };

/** Loads the list; never rejects: a failure is the state 'failed'. Frozen. */
export async function loadDocumentList(
  list: () => Promise<readonly DocumentInfo[]>,
): Promise<DocumentListState> {
  try {
    const documents = await list();
    return Object.freeze({ kind: 'loaded', documents });
  } catch (e) {
    return Object.freeze({ kind: 'failed', error: e instanceof Error ? e.message : String(e) });
  }
}

/**
 * Formats the time of the last change (ms since epoch) by the locale. Creating an
 * Intl.DateTimeFormat is costly, so the list makes one per locale, not one per card.
 */
export function updatedFormatter(locale: string): (updatedAt: number) => string {
  const format = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });
  return (updatedAt) => format.format(updatedAt);
}
