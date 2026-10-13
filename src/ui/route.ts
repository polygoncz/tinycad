import type { DocumentId } from '@/document';

// The "router" of the app (spec 11, "Dokumenty", Q019): the id of the open document lives in
// location.hash as #/d/<id>; anything else is the document list. Pure functions, so the
// format is tested in Node; the components read and set location.hash themselves.

const PREFIX = '#/d/';

/** The document of a location.hash; null = the document list (empty or unknown hash). */
export function parseDocHash(hash: string): DocumentId | null {
  if (!hash.startsWith(PREFIX)) return null;
  const encoded = hash.slice(PREFIX.length);
  if (encoded === '' || encoded.includes('/')) return null;
  try {
    // Brand: the hash is the only carrier of a document id in the URL; whether such a document
    // exists is decided by opening it.
    return decodeURIComponent(encoded) as DocumentId;
  } catch {
    // Malformed escape (URIError): not a document address.
    return null;
  }
}

/** The location.hash of a document. */
export function docHash(id: DocumentId): string {
  return PREFIX + encodeURIComponent(id);
}
