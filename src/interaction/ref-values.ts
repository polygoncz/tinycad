// Values of reference params (spec 10, "Referenční parametr dialogu"): shared by the click in
// the view (refPick), the click in the browser (BrowserModel.select) and the chips of the dialog
// (FieldState.refs). Internal to interaction.

import type {
  AxisRef,
  BodyId,
  BodyRef,
  DocumentReader,
  FeatureId,
  SketchEntityRef,
  SketchRegionRef,
} from '@/document';
import { originOfBody, parseBodyId } from '@/document';
import { parseSketchData } from '@/sketch';

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
 * Adds the region of the sketch at the end, or removes it when it is there already (M13). Keeps
 * the order and any other items; a value that is not an array counts as empty.
 */
export function toggleRegionRef(
  value: unknown,
  sketch: FeatureId,
  region: string,
): readonly unknown[] {
  const items: readonly unknown[] = Array.isArray(value) ? value : [];
  const isTheRegion = (item: unknown): boolean =>
    isRegionRef(item) && item.sketch === sketch && item.region === region;
  if (items.some(isTheRegion)) return Object.freeze(items.filter((item) => !isTheRegion(item)));
  const ref: SketchRegionRef = Object.freeze({ kind: 'region', sketch, region });
  return Object.freeze([...items, ref]);
}

/** The reference, or null when the value already is the same reference (M13, a single 'axis'). */
export function toggleAxisRef(
  value: unknown,
  ref: AxisRef | SketchEntityRef,
): AxisRef | SketchEntityRef | null {
  return sameAxisRef(value, ref) ? null : ref;
}

/**
 * Whether the entity is a line in the data of the sketch feature (M13): the axis of Revolve may be
 * a line of a sketch. A missing feature or invalid sketch data → false.
 */
export function isSketchLine(doc: DocumentReader, sketch: FeatureId, entity: string): boolean {
  const params: unknown = doc.feature(sketch)?.params;
  if (!isRecord(params)) return false;
  const parsed = parseSketchData(params['entities'], params['constraints']);
  return parsed.ok && parsed.value.entities.some((e) => e.id === entity && e.kind === 'line');
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

function isRegionRef(
  value: unknown,
): value is { readonly kind: 'region'; readonly sketch: unknown; readonly region: unknown } {
  return isRecord(value) && value['kind'] === 'region';
}

function sameAxisRef(value: unknown, ref: AxisRef | SketchEntityRef): boolean {
  if (!isRecord(value) || value['kind'] !== ref.kind) return false;
  return ref.kind === 'axis'
    ? value['axis'] === ref.axis
    : value['sketch'] === ref.sketch && value['entity'] === ref.entity;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
