// Values of reference params (spec 10, "Referenční parametr dialogu"): shared by the click in
// the view (refPick), the click in the browser (BrowserModel.select) and the chips of the dialog
// (FieldState.refs). Internal to interaction.

import type { BodyId, BodyRef, DocumentReader } from '@/document';
import { originOfBody, parseBodyId } from '@/document';

/**
 * Adds the body at the end, or removes it when it is there already. Keeps the order and
 * any other items; a value that is not an array counts as empty.
 */
export function toggleBodyRef(value: unknown, body: BodyId): readonly unknown[] {
  const items: readonly unknown[] = Array.isArray(value) ? value : [];
  const isTheBody = (item: unknown): boolean => isBodyRef(item) && item.body === body;
  if (items.some(isTheBody)) return Object.freeze(items.filter((item) => !isTheBody(item)));
  const ref: BodyRef = Object.freeze({ kind: 'body', body });
  return Object.freeze([...items, ref]);
}

/**
 * The body of one item of a 'bodies' param value, or null when the item is not a body
 * reference with a body id of the right shape (invalid params are legitimate state, spec 03).
 */
export function bodyOfRef(item: unknown): BodyId | null {
  return isBodyRef(item) ? (parseBodyId(item.body) ?? null) : null;
}

/**
 * Name of the body for a chip in a reference field, from the document only (not from the last
 * regeneration: a preview may drop a tool body that the chip still has to name): the name from
 * the metadata, otherwise the name of the origin feature with ' (n)' for an id with number n;
 * null when the origin feature is not in the document, whatever the metadata still say (R25).
 */
export function bodyRefLabel(doc: DocumentReader, body: BodyId): string | null {
  const origin = doc.feature(originOfBody(body));
  if (origin === undefined) return null;
  const userName = doc.bodyMeta(body).name;
  if (userName !== undefined) return userName;
  const n = bodyNumber(body);
  return n === null ? origin.name : `${origin.name} (${n})`;
}

/** The n of '<origin>/body:<n>' as text, null for '<origin>/body'. */
function bodyNumber(body: BodyId): string | null {
  const colon = body.lastIndexOf(':');
  return colon > body.indexOf('/') ? body.slice(colon + 1) : null;
}

function isBodyRef(value: unknown): value is { readonly kind: 'body'; readonly body: unknown } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    value.kind === 'body' &&
    'body' in value
  );
}
