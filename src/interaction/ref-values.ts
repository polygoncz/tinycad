// Values of reference params (spec 10, "Referenční parametr dialogu"): shared by the click in
// the view (refPick) and the click in the browser (BrowserModel.select). Internal to interaction.

import type { BodyId, BodyRef } from '@/document';

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

function isBodyRef(value: unknown): value is BodyRef {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    value.kind === 'body' &&
    'body' in value
  );
}
