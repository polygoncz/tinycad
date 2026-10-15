// The table of reference kinds of interaction (M20, D5): how each reference kind of ParamSpec
// behaves in the dialog – what refPick can pick and what a hit writes into the value, which
// targets bindSelectionHighlight shows, which rows of the Browser go into the param, whether
// FeatureEditor focuses it and what its chips say. refPick, bindSelectionHighlight,
// FeatureEditor and BrowserModel only read it, so a new reference kind is one entry here (and one
// in the table of document), and a missing entry is a type error. Internal to interaction.
//
// Known gaps are written into the entries on purpose, each with a comment; whether to close them
// is a UX question outside M20: 'planes' is focusable, yet picks nothing in the view and the
// Browser does not take its rows ('topo' neither).

import type {
  BodyId,
  DocumentReader,
  ParamSpec,
  RefParamKind,
  RefParamSpec,
  SketchRegionRef,
} from '@/document';
import { ORIGIN_AXES, ownerOfArtifact, parseAxisId, parseSketchId, sketchId } from '@/document';
import type { AxisRef, SketchEntityRef, TopoRef } from '@/document';
import {
  axisRefOf,
  bodyOfRef,
  bodyRefLabel,
  isSketchLine,
  regionRefsOf,
  toggleAxisRef,
  toggleBodyRef,
  toggleRegionRef,
  toggleTopoRef,
  topoRefOf,
  topoRefsOf,
} from './ref-values';
import { nameOfHit } from '../regen-status-port';
import type { RegenSnapshot, TopoNames } from '../regen-status-port';
import type { HighlightTarget, PickFilter, PickResult } from '../viewport-port';

/** The text of a reference for the UI (M13): a translation key and its values. */
export interface RefText {
  readonly key: string;
  readonly params: Readonly<Record<string, string>>;
}

/**
 * One item of the value of a 'bodies' or a 'topo' param, as its chip shows it. Exactly one of
 * `label` (a name from the user) and `text` (a translation key) is not null, so the view only
 * draws the one it gets (ADR 0010).
 */
export interface FieldRef {
  /** Position of the item in the value. */
  readonly index: number;
  /** null for an item that is not a body (topo) reference of the right shape. */
  readonly body: BodyId | null;
  /** 'bodies': the name from the document only (bodyRefLabel), null = a missing body; 'topo': null. */
  readonly label: string | null;
  /**
   * 'topo' (D5 of M19.1): the ordinal text by the entity of the param, 'ref.edge' / 'ref.face' /
   * 'ref.vertex' with n = index + 1; the name itself is never taken apart (ADR 0018). An item
   * that is not a topo reference → field.missingRef. 'bodies': field.refs.missing for a missing
   * body ("Chybí těleso"), otherwise null.
   */
  readonly text: RefText | null;
  /**
   * The chip shows a missing reference in the error style (D5 of M19.1): 'bodies' label === null
   * (an invalid item or a missing origin feature), 'topo' body === null (an invalid item).
   */
  readonly missing: boolean;
}

/** The rows of the Browser a click can put into the active reference param. */
export type BrowserRefTarget = 'body' | 'plane' | 'axis' | 'region';

/** What turning a hit into a reference reads: the document and the last regeneration. */
export interface RefHitContext {
  readonly doc: DocumentReader;
  /** The last snapshot, undefined without a RegenStatusPort. */
  readonly snapshot: RegenSnapshot | undefined;
}

/**
 * A new value of the param; a wrapper because null is a value too (a cleared axis). null = the
 * value does not change.
 */
export type RefValueChange = { readonly value: unknown } | null;

/**
 * The behaviour of one reference kind; S is the spec of that kind. Methods, not function
 * properties: their parameters are bivariant, so the behaviour of one kind is a RefKindBehavior
 * (of any spec), which behaviorOf relies on.
 */
export interface RefKindBehavior<S extends RefParamSpec = RefParamSpec> {
  /** The dialog can focus the param (focusRefParam). */
  readonly focusable: boolean;
  /** create focuses the first visible such param (spec 10, R19). */
  readonly autoFocus: boolean;
  /** What a click into the view (and the hover) can pick for the param (spec 10). */
  pickFilter(spec: S): PickFilter;
  /** Whether refPick hovers the hit, which the filter already let through. */
  hovers(hit: PickResult, ctx: RefHitContext): boolean;
  /** The value after a click on the hit: the reference added or removed; null = not taken. */
  fromHit(hit: PickResult, value: unknown, ctx: RefHitContext): RefValueChange;
  /** The highlight of the references in the value (bindSelectionHighlight), in value order. */
  highlightTargets(
    value: unknown,
    spec: S,
    snapshot: RegenSnapshot | undefined,
  ): readonly HighlightTarget[];
  /** Whether a click on a Browser row of the target goes into the param. */
  browserAccepts(target: BrowserRefTarget): boolean;
  /** FieldState.refs: the chips of the value, null for a kind without chips. */
  chips(value: unknown, spec: S, doc: DocumentReader): readonly FieldRef[] | null;
  /** FieldState.refText: the text of the value, null for a kind without one or without a value. */
  refText(value: unknown, doc: DocumentReader): RefText | null;
  /** The value create puts into the param when it is auto-focused (D6 of M19.2); null = default. */
  preselect(snapshot: RegenSnapshot): RefValueChange;
}

type RefParamSpecOf<K extends RefParamKind> = Extract<RefParamSpec, { readonly kind: K }>;
type TopoSpec = RefParamSpecOf<'topo'>;

const NOTHING: PickFilter = Object.freeze([]);
/** A hit on a face or an edge of a body is the body. */
const FACES_AND_EDGES: PickFilter = Object.freeze(['face', 'edge']);
const FACES: PickFilter = Object.freeze(['face']);
const EDGES: PickFilter = Object.freeze(['edge']);
const SKETCH_REGIONS: PickFilter = Object.freeze(['sketchRegion']);
/** An axis drawing or a line of a sketch drawing (M13). */
const SKETCH_ENTITIES: PickFilter = Object.freeze(['sketchEntity']);
const TOPO_FILTERS: Readonly<Record<TopoSpec['entity'], PickFilter>> = Object.freeze({
  face: FACES,
  edge: EDGES,
  // pick returns no vertices (postponed, R101).
  vertex: NOTHING,
});
/** The translation key of the ordinal chip text of a 'topo' param by its entity (D5). */
const TOPO_TEXT_KEYS: Readonly<Record<TopoSpec['entity'], string>> = Object.freeze({
  edge: 'ref.edge',
  face: 'ref.face',
  vertex: 'ref.vertex',
});

const NO_TARGETS: readonly HighlightTarget[] = Object.freeze([]);
const NO_TEXT_PARAMS: Readonly<Record<string, string>> = Object.freeze({});
const MISSING_REF: RefText = Object.freeze({ key: 'field.missingRef', params: NO_TEXT_PARAMS });
/** The text of the chip of a body that is missing or not a body reference ("Chybí těleso"). */
const MISSING_BODY: RefText = Object.freeze({
  key: 'field.refs.missing',
  params: NO_TEXT_PARAMS,
});

const always = (): boolean => true;
const noChips = (): null => null;
const noText = (): null => null;
const noPreselect = (): RefValueChange => null;
const accepts =
  (accepted: BrowserRefTarget) =>
  (target: BrowserRefTarget): boolean =>
    target === accepted;

const BODIES = Object.freeze<RefKindBehavior<RefParamSpecOf<'bodies'>>>({
  focusable: true,
  autoFocus: true,
  pickFilter: () => FACES_AND_EDGES,
  // The filter lets through faces and edges only, and each of them is a body.
  hovers: always,
  fromHit: (hit, value) =>
    hit.kind === 'face' || hit.kind === 'edge' ? { value: toggleBodyRef(value, hit.body) } : null,
  // Without a snapshot the dialog highlights no bodies (M14).
  highlightTargets: (value, _spec, snapshot) =>
    snapshot === undefined ? NO_TARGETS : bodyTargets(value),
  browserAccepts: accepts('body'),
  chips: (value, _spec, doc) => bodyChips(value, doc),
  refText: noText,
  preselect: noPreselect,
});

const TOPO = Object.freeze<RefKindBehavior<RefParamSpecOf<'topo'>>>({
  focusable: true,
  autoFocus: true,
  pickFilter: (spec) => TOPO_FILTERS[spec.entity],
  // Only hits with a name in the last snapshot (M14, R103).
  hovers: (hit, ctx) => topoRefOfHit(hit, ctx) !== null,
  fromHit: (hit, value, ctx) => {
    // The filter already allows only the entity of the spec.
    const ref = topoRefOfHit(hit, ctx);
    return ref === null ? null : { value: toggleTopoRef(value, ref) };
  },
  highlightTargets: (value, spec, snapshot) =>
    snapshot === undefined ? NO_TARGETS : topoTargets(value, spec.entity, snapshot),
  // Known gap: the Browser lists bodies, not faces or edges, so it takes nothing (M20).
  browserAccepts: () => false,
  chips: (value, spec) => topoChips(value, spec.entity),
  refText: noText,
  preselect: noPreselect,
});

const REGION = Object.freeze<RefKindBehavior<RefParamSpecOf<'region'>>>({
  focusable: true,
  autoFocus: true,
  pickFilter: () => SKETCH_REGIONS,
  // Every region is hovered, also one of the edited sketch that a click does not take.
  hovers: always,
  fromHit: (hit, value) => {
    if (hit.kind !== 'sketchRegion') return null;
    // Only a regenerated sketch has regions to reference; the edited one does not.
    const sketch = parseSketchId(hit.sketch);
    return sketch === undefined
      ? null
      : { value: toggleRegionRef(value, ownerOfArtifact(sketch), hit.region) };
  },
  highlightTargets: (value) => regionTargets(value),
  browserAccepts: accepts('region'),
  chips: noChips,
  refText: noText,
  preselect: (snapshot) => {
    // The only region of the last sketch, like in Fusion (D6 of M19.2).
    const sketch = snapshot.sketches.at(-1);
    const region = sketch?.regions.length === 1 ? sketch.regions[0] : undefined;
    if (sketch === undefined || region === undefined) return null;
    const ref: SketchRegionRef = { kind: 'region', sketch: sketch.feature, region };
    return { value: [ref] };
  },
});

const PLANES = Object.freeze<RefKindBehavior<RefParamSpecOf<'planes'>>>({
  // Known gap (M20): focusable, yet it picks nothing in the view and the Browser does not take
  // its rows; a plane comes from the selection when the sketch is created (M12).
  focusable: true,
  // Not focused on create, otherwise the sketcher would start with refPick instead of its own
  // tools (M12).
  autoFocus: false,
  pickFilter: () => NOTHING,
  hovers: always,
  fromHit: () => null,
  highlightTargets: () => NO_TARGETS,
  browserAccepts: () => false,
  chips: noChips,
  refText: noText,
  preselect: noPreselect,
});

const AXIS = Object.freeze<RefKindBehavior<RefParamSpecOf<'axis'>>>({
  focusable: true,
  autoFocus: true,
  pickFilter: () => SKETCH_ENTITIES,
  // Only hits that can be an axis (M13).
  hovers: (hit, ctx) => axisRefOfHit(hit, ctx.doc) !== null,
  fromHit: (hit, value, ctx) => {
    const ref = axisRefOfHit(hit, ctx.doc);
    return ref === null ? null : { value: toggleAxisRef(value, ref) };
  },
  highlightTargets: () => NO_TARGETS,
  browserAccepts: accepts('axis'),
  chips: noChips,
  refText: (value, doc) => axisText(value, doc),
  preselect: noPreselect,
});

/** One entry per reference kind of ParamSpec; a missing kind is a type error (D5). */
export const REF_KIND_BEHAVIOR = Object.freeze({
  bodies: BODIES,
  topo: TOPO,
  region: REGION,
  planes: PLANES,
  axis: AXIS,
} satisfies { readonly [K in RefParamKind]: RefKindBehavior<RefParamSpecOf<K>> });

/** Whether the spec is of a reference kind, by the table. */
export function isRefParamSpec(spec: ParamSpec): spec is RefParamSpec {
  return Object.hasOwn(REF_KIND_BEHAVIOR, spec.kind);
}

/**
 * The behaviour of the kind of the spec. The entry of kind K takes the spec of kind K, and
 * spec.kind picks exactly that entry; TypeScript cannot correlate the two, so the entry is
 * widened to the behaviour of any spec (bivariant methods, see RefKindBehavior).
 */
export function behaviorOf(spec: RefParamSpec): RefKindBehavior {
  const behavior: RefKindBehavior = REF_KIND_BEHAVIOR[spec.kind];
  return behavior;
}

/** The behaviour of the spec when it is of a reference kind, otherwise null. */
export function refBehaviorOf(spec: ParamSpec): RefKindBehavior | null {
  return isRefParamSpec(spec) ? behaviorOf(spec) : null;
}

/** The hit as the axis of an 'axis' param, or null when it cannot be one (M13). */
function axisRefOfHit(hit: PickResult, doc: DocumentReader): AxisRef | SketchEntityRef | null {
  if (hit.kind !== 'sketchEntity') return null;
  const axis = parseAxisId(hit.sketch);
  if (axis !== undefined) return Object.freeze({ kind: 'axis', axis });
  // The drawing of a regenerated sketch has the id of its artifact; the edited one does not.
  const sketch = parseSketchId(hit.sketch);
  if (sketch === undefined) return null;
  const owner = ownerOfArtifact(sketch);
  return isSketchLine(doc, owner, hit.entity)
    ? Object.freeze({ kind: 'sketchEntity', sketch: owner, entity: hit.entity })
    : null;
}

/**
 * The hit as a reference of a 'topo' param: the name of the face or edge in the last snapshot
 * (M14); null without a snapshot, without the body in it or without a name.
 */
function topoRefOfHit(hit: PickResult, ctx: RefHitContext): TopoRef | null {
  if (hit.kind !== 'face' && hit.kind !== 'edge') return null;
  if (ctx.snapshot === undefined) return null;
  const index = hit.kind === 'face' ? hit.faceIndex : hit.edgeIndex;
  const name = nameOfHit(ctx.snapshot, hit.body, hit.kind, index);
  return name === undefined ? null : Object.freeze({ kind: 'topo', body: hit.body, name });
}

function namesOf(snapshot: RegenSnapshot, body: BodyId): TopoNames | undefined {
  return snapshot.bodies.find((b) => b.body === body)?.names;
}

/**
 * Topo references of an unchecked value as the faces or edges of their name in the body of the
 * last snapshot, ascending; an unresolved reference and vertices (R101) give nothing.
 */
function topoTargets(
  value: unknown,
  entity: TopoSpec['entity'],
  snapshot: RegenSnapshot,
): HighlightTarget[] {
  return topoRefsOf(value).flatMap(({ body, name }): HighlightTarget[] => {
    const names = namesOf(snapshot, body);
    if (names === undefined) return [];
    if (entity === 'face') {
      return names.faces(name).map((faceIndex) => ({ kind: 'face', body, faceIndex }));
    }
    if (entity === 'edge') {
      return names.edges(name).map((edgeIndex) => ({ kind: 'edge', body, edgeIndex }));
    }
    return [];
  });
}

/** Body references of an unchecked value as body targets; render drops bodies it does not show. */
function bodyTargets(value: unknown): HighlightTarget[] {
  const items: readonly unknown[] = Array.isArray(value) ? value : [];
  return items.flatMap((item): HighlightTarget[] => {
    const body = bodyOfRef(item);
    return body === null ? [] : [{ kind: 'body', body }];
  });
}

/** Region references of an unchecked value; items of another shape are skipped. */
function regionTargets(value: unknown): HighlightTarget[] {
  // regionRefsOf only lets through owners that sketchId accepts.
  return regionRefsOf(value).map(({ sketch, region }) => ({
    kind: 'sketchRegion',
    sketch: sketchId(sketch),
    region,
  }));
}

/** The chips of a 'bodies' value (M11): the name of each body from the document. */
function bodyChips(value: unknown, doc: DocumentReader): readonly FieldRef[] {
  const items: readonly unknown[] = Array.isArray(value) ? value : [];
  return Object.freeze(
    items.map((item, index): FieldRef => {
      const body = bodyOfRef(item);
      const label = body === null ? null : bodyRefLabel(doc, body);
      const missing = label === null;
      return Object.freeze({ index, body, label, text: missing ? MISSING_BODY : null, missing });
    }),
  );
}

/**
 * The chips of a 'topo' value (D5 of M19.1): the body of each topo reference with an ordinal text
 * by the entity; an item of another shape is a missing chip.
 */
function topoChips(value: unknown, entity: TopoSpec['entity']): readonly FieldRef[] {
  const items: readonly unknown[] = Array.isArray(value) ? value : [];
  return Object.freeze(
    items.map((item, index): FieldRef => {
      const ref = topoRefOf(item);
      return Object.freeze({
        index,
        body: ref === null ? null : ref.body,
        label: null,
        text:
          ref === null
            ? MISSING_REF
            : Object.freeze({
                key: TOPO_TEXT_KEYS[entity],
                params: Object.freeze({ n: String(index + 1) }),
              }),
        missing: ref === null,
      });
    }),
  );
}

/**
 * The text of an 'axis' value (M13): the label of an origin axis, the name of the sketch of an
 * entity; missing sketch, unknown axis or an invalid value → field.missingRef; null or no value
 * → null.
 */
function axisText(value: unknown, doc: DocumentReader): RefText | null {
  if (value === null || value === undefined) return null;
  // A value of any other shape can still be cleared, so it shows as a missing reference.
  const ref = axisRefOf(value);
  if (ref === null) return MISSING_REF;
  if (ref.kind === 'axis') {
    const origin = ORIGIN_AXES.find((a) => a.id === ref.axis);
    return origin === undefined
      ? MISSING_REF
      : Object.freeze({ key: origin.label, params: NO_TEXT_PARAMS });
  }
  const feature = doc.feature(ref.sketch);
  return feature === undefined
    ? MISSING_REF
    : Object.freeze({ key: 'field.sketchLine', params: Object.freeze({ sketch: feature.name }) });
}
