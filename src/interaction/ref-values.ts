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
  TopoRef,
} from '@/document';
import {
  originOfBody,
  ownerOfArtifact,
  parseAxisId,
  parseBodyId,
  parseSketchId,
  readRefOf,
} from '@/document';
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
  const isTheRegion = (item: unknown): boolean => {
    const ref = regionRefOf(item);
    return ref !== null && ref.sketch === sketch && ref.region === region;
  };
  if (items.some(isTheRegion)) return Object.freeze(items.filter((item) => !isTheRegion(item)));
  const ref: SketchRegionRef = Object.freeze({ kind: 'region', sketch, region });
  return Object.freeze([...items, ref]);
}

/**
 * Adds the reference at the end, or removes it when the same body and name are there already
 * (M14). Keeps the order of the other topo references; a value that is not an array counts as
 * empty, items of another shape are dropped (the result holds only topo references).
 */
export function toggleTopoRef(value: unknown, ref: TopoRef): readonly TopoRef[] {
  const items = topoRefsOf(value);
  const isTheRef = (item: TopoRef): boolean => item.body === ref.body && item.name === ref.name;
  if (items.some(isTheRef)) return Object.freeze(items.filter((item) => !isTheRef(item)));
  return Object.freeze([...items, Object.freeze({ kind: 'topo', body: ref.body, name: ref.name })]);
}

/**
 * The topo references of a 'topo' param value (M14): frozen copies of the items with a valid
 * body id and a non-empty name, in order; other items are skipped, a value that is not an array
 * has none. The one reading of topo values in interaction (highlight, toggling).
 */
export function topoRefsOf(value: unknown): readonly TopoRef[] {
  const items: readonly unknown[] = Array.isArray(value) ? value : [];
  return Object.freeze(
    items.flatMap((item) => {
      const ref = topoRefOf(item);
      return ref === null ? [] : [ref];
    }),
  );
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
 * The region references of a 'region' param value (M13): frozen copies of the items of the right
 * shape, in order; other items are skipped, a value that is not an array has none. The one
 * reading of region values in interaction (highlight, Browser, toggling).
 */
export function regionRefsOf(value: unknown): readonly SketchRegionRef[] {
  const items: readonly unknown[] = Array.isArray(value) ? value : [];
  return Object.freeze(
    items.flatMap((item) => {
      const ref = regionRefOf(item);
      return ref === null ? [] : [ref];
    }),
  );
}

/**
 * The reference of an 'axis' param value (M13): a frozen copy of an origin/feature axis or of a
 * sketch entity, or null when the value has neither shape. The one reading of axis values in
 * interaction (refText, Browser, toggling).
 */
export function axisRefOf(value: unknown): AxisRef | SketchEntityRef | null {
  if (!isRecord(value)) return null;
  if (value['kind'] === 'axis') {
    const axis = parseAxisId(value['axis']);
    return axis === undefined ? null : Object.freeze({ kind: 'axis', axis });
  }
  if (value['kind'] === 'sketchEntity') {
    const sketch = featureIdOf(value['sketch']);
    const entity = value['entity'];
    return sketch === null || typeof entity !== 'string' || entity.length === 0
      ? null
      : Object.freeze({ kind: 'sketchEntity', sketch, entity });
  }
  return null;
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

/** One region reference of the right shape as a frozen copy, otherwise null. */
function regionRefOf(item: unknown): SketchRegionRef | null {
  if (!isRecord(item) || item['kind'] !== 'region') return null;
  const sketch = featureIdOf(item['sketch']);
  const region = item['region'];
  return sketch === null || typeof region !== 'string'
    ? null
    : Object.freeze({ kind: 'region', sketch, region });
}

/**
 * One topo reference of the right shape as a frozen copy, otherwise null: the reading of document
 * (readRefOf), so a stored name becomes a TopoName in one place (spec 03).
 */
function topoRefOf(item: unknown): TopoRef | null {
  return readRefOf(['topo'], item) ?? null;
}

/**
 * The text as the id of a feature that can own artifacts: non-empty without '/', checked by the
 * parser of sketch ids of document (ADR 0015), so sketchId(owner) never throws for it.
 */
function featureIdOf(value: unknown): FeatureId | null {
  if (typeof value !== 'string') return null;
  const sketch = parseSketchId(`${value}/sketch`);
  return sketch === undefined ? null : ownerOfArtifact(sketch);
}

function sameAxisRef(value: unknown, ref: AxisRef | SketchEntityRef): boolean {
  const other = axisRefOf(value);
  if (other === null) return false;
  if (other.kind === 'axis') return ref.kind === 'axis' && other.axis === ref.axis;
  return ref.kind === 'sketchEntity' && other.sketch === ref.sketch && other.entity === ref.entity;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
