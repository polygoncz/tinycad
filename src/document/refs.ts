import { assert, assertNever } from '@/core';
import type { Brand } from '@/core';
import type { BodyId, FeatureId } from './model';

export type { BodyId } from './model';

// References from feature params to results of other features. Always names,
// never indices or kernel handles, so they survive regeneration (ADR 0007).

/** Persistent topological name, see spec 08. */
export type TopoName = Brand<string, 'TopoName'>;

export interface BodyRef {
  readonly kind: 'body';
  readonly body: BodyId;
}

export interface TopoRef {
  readonly kind: 'topo';
  readonly body: BodyId;
  readonly name: TopoName;
}

/** A closed region of a sketch, see spec 12. */
export interface SketchRegionRef {
  readonly kind: 'region';
  readonly sketch: FeatureId;
  readonly region: string;
}

/** '<owner>/plane:<name>' with the name [a-z0-9]+ (M12); the origin planes are owned by ORIGIN. */
export type PlaneId = Brand<string, 'PlaneId'>;

/** A plane, see spec 12 (M12). */
export interface PlaneRef {
  readonly kind: 'plane';
  readonly plane: PlaneId;
}

/** '<owner>/axis:<name>' with the name [a-z0-9]+ (M13); the origin axes are owned by ORIGIN. */
export type AxisId = Brand<string, 'AxisId'>;

/** An axis, e.g. an origin axis for Revolve (M13). */
export interface AxisRef {
  readonly kind: 'axis';
  readonly axis: AxisId;
}

/**
 * An entity of a sketch, e.g. a line as the axis of Revolve (M13). Whether it really is a line
 * is only known when regenerating (BuildContext.resolveAxis, spec 07).
 */
export interface SketchEntityRef {
  readonly kind: 'sketchEntity';
  readonly sketch: FeatureId;
  readonly entity: string;
}

/** Any reference; `kind` tells which. */
export type EntityRef = BodyRef | TopoRef | SketchRegionRef | PlaneRef | AxisRef | SketchEntityRef;

/** '<featureId>/sketch', the sketch artifact of a sketch feature (M12). */
export type SketchId = Brand<string, 'SketchId'>;

// Artifact ids are '<owner>/<kind>[:<n>]' (ADR 0015): the owner can always be read back,
// so the dependency graph follows from the references alone.

/**
 * The id of a body whose origin is the feature: '<origin>/body', or '<origin>/body:<n>'
 * for n >= 1. The single place where a BodyId is minted; builders never cast.
 */
export function bodyId(origin: FeatureId, n?: number): BodyId {
  // The owner is read back up to the first '/', so it must not contain one (spec 03).
  assert(origin.length > 0 && !origin.includes('/'), `bodyId: invalid origin '${origin}'`);
  assert(
    n === undefined || (Number.isInteger(n) && n >= 1),
    `bodyId: n must be a whole number >= 1, got ${String(n)}`,
  );
  const suffix = n === undefined ? '' : `:${String(n)}`;
  // The trusted place where a BodyId is minted (ADR 0015).
  return `${origin}/body${suffix}` as BodyId;
}

/** The id of the sketch of a feature: '<owner>/sketch'. The single place where a SketchId is minted. */
export function sketchId(owner: FeatureId): SketchId {
  assert(owner.length > 0 && !owner.includes('/'), `sketchId: invalid owner '${owner}'`);
  // The trusted place where a SketchId is minted (ADR 0015).
  return `${owner}/sketch` as SketchId;
}

/** The feature that minted the body id: the text before the first '/'. */
export function originOfBody(body: BodyId): FeatureId {
  assert(body.includes('/'), `originOfBody: '${body}' is not a body id`);
  return ownerOfArtifact(body);
}

/**
 * The owner of an artifact id: the text before the first '/' (ADR 0015). An id without '/'
 * throws, a programmer error (M13).
 */
export function ownerOfArtifact(id: BodyId | SketchId | PlaneId | AxisId): FeatureId {
  const slash = id.indexOf('/');
  assert(slash !== -1, `ownerOfArtifact: '${id}' is not an artifact id`);
  // The text before '/' is the FeatureId the id was minted for.
  return id.slice(0, slash) as FeatureId;
}

/** The feature whose result the reference points to. */
export function ownerOf(ref: EntityRef): FeatureId {
  switch (ref.kind) {
    case 'body':
    case 'topo':
      return originOfBody(ref.body);
    case 'region':
      return ref.sketch;
    case 'plane':
      // parsePlaneId guarantees one '/'; for the origin planes the owner is ORIGIN.
      return ownerOfArtifact(ref.plane);
    case 'axis':
      // parseAxisId guarantees one '/'; for the origin axes the owner is ORIGIN.
      return ownerOfArtifact(ref.axis);
    case 'sketchEntity':
      return ref.sketch;
    default:
      return assertNever(ref);
  }
}

/**
 * Reads one reference of the given kind from unchecked data: a frozen copy with just the
 * fields of the type, or undefined when the shape is wrong. Internal to document; the one
 * shape check shared by validateAgainstSchema and referencesOf.
 */
export function readRef(kind: EntityRef['kind'], r: unknown): EntityRef | undefined {
  if (!isRecord(r) || r.kind !== kind) return undefined;
  // The id casts below follow the shape check, as in fromData (spec 03).
  switch (kind) {
    case 'body': {
      const body = parseBodyId(r.body);
      return body === undefined ? undefined : Object.freeze({ kind, body });
    }
    case 'topo': {
      const body = parseBodyId(r.body);
      // An empty name names nothing (M14); the name itself is minted by regen only.
      return body !== undefined && isNonEmptyString(r.name)
        ? Object.freeze({ kind, body, name: r.name as TopoName })
        : undefined;
    }
    case 'region':
      return typeof r.sketch === 'string' && typeof r.region === 'string'
        ? Object.freeze({ kind, sketch: r.sketch as FeatureId, region: r.region })
        : undefined;
    case 'plane': {
      const plane = parsePlaneId(r.plane);
      return plane === undefined ? undefined : Object.freeze({ kind, plane });
    }
    case 'axis': {
      const axis = parseAxisId(r.axis);
      return axis === undefined ? undefined : Object.freeze({ kind, axis });
    }
    case 'sketchEntity':
      return isNonEmptyString(r.sketch) && isNonEmptyString(r.entity)
        ? Object.freeze({ kind, sketch: r.sketch as FeatureId, entity: r.entity })
        : undefined;
    default:
      return assertNever(kind);
  }
}

/**
 * The first of the kinds whose shape the data has, as readRef reads it; undefined when none.
 * For params that hold more than one kind of reference, the axis (M13). Public since M14: the
 * one reading of references from unchecked values outside document too (interaction), so a
 * TopoName is taken from data in one place (spec 03).
 */
export function readRefOf<K extends EntityRef['kind']>(
  kinds: readonly K[],
  r: unknown,
): Extract<EntityRef, { readonly kind: K }> | undefined {
  for (const kind of kinds) {
    const ref = readRef(kind, r);
    if (ref !== undefined && isOfKind(ref, kind)) return ref;
  }
  return undefined;
}

/**
 * The plane of a 'planes' param value (M21): its first item as a PlaneRef or a TopoRef (a planar
 * face, M14), undefined when it is neither or the value is not an array. The one reading of the
 * plane of a sketch outside document (sketcher, interaction).
 */
export function readPlaneRef(value: unknown): PlaneRef | TopoRef | undefined {
  if (!Array.isArray(value)) return undefined;
  const items: readonly unknown[] = value;
  return readRefOf(['plane', 'topo'], items[0]);
}

/**
 * Two plane references name the same plane (M21): the same origin plane, or the same face of the
 * same body. By value, never by identity. The one comparison of plane references outside
 * document (sketcher, interaction).
 */
export function samePlaneRef(a: PlaneRef | TopoRef, b: PlaneRef | TopoRef): boolean {
  if (a.kind === 'plane') return b.kind === 'plane' && a.plane === b.plane;
  return b.kind === 'topo' && a.body === b.body && a.name === b.name;
}

/** readRef(kind, …) gives a reference of that kind; the guard tells it the type system. */
function isOfKind<K extends EntityRef['kind']>(
  ref: EntityRef,
  kind: K,
): ref is Extract<EntityRef, { readonly kind: K }> {
  return ref.kind === kind;
}

function isRecord(v: unknown): v is Readonly<Record<string, unknown>> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

/** '<owner>/body' or '<owner>/body:<n>' with n >= 1, as bodyId mints it; data from outside is checked here. */
const BODY_ID = /^[^/]+\/body(?::[1-9][0-9]*)?$/;

/**
 * Text in the shape of a body id '<owner>/body[:<n>]' -> BodyId, otherwise undefined. The trusted
 * place where a body id from outside becomes branded: references (readRef), keys of body
 * metadata in fromData, validate of the body.* operations (spec 03).
 */
export function parseBodyId(v: unknown): BodyId | undefined {
  // The cast follows the shape check, as in fromData.
  return typeof v === 'string' && BODY_ID.test(v) ? (v as BodyId) : undefined;
}

/** '<owner>/plane:<name>': the owner non-empty without '/', the name [a-z0-9]+ (M12). */
const PLANE_ID = /^[^/]+\/plane:[a-z0-9]+$/;

/**
 * Text in the shape of a plane id '<owner>/plane:<name>' -> PlaneId, otherwise undefined. The
 * trusted place where a plane id from outside becomes branded (references, spec 03).
 */
export function parsePlaneId(v: unknown): PlaneId | undefined {
  // The cast follows the shape check, as in fromData.
  return typeof v === 'string' && PLANE_ID.test(v) ? (v as PlaneId) : undefined;
}

/** '<owner>/axis:<name>': the owner non-empty without '/', the name [a-z0-9]+ (M13). */
const AXIS_ID = /^[^/]+\/axis:[a-z0-9]+$/;

/**
 * Text in the shape of an axis id '<owner>/axis:<name>' -> AxisId, otherwise undefined. The
 * trusted place where an axis id from outside becomes branded (references, spec 03).
 */
export function parseAxisId(v: unknown): AxisId | undefined {
  // The cast follows the shape check, as in fromData.
  return typeof v === 'string' && AXIS_ID.test(v) ? (v as AxisId) : undefined;
}

/** '<owner>/sketch' with the owner non-empty without '/', as sketchId mints it (M13). */
const SKETCH_ID = /^[^/]+\/sketch$/;

/**
 * Text in the shape of a sketch id '<owner>/sketch' -> SketchId, otherwise undefined (M13).
 * interaction reads the feature of a drawing id with it.
 */
export function parseSketchId(v: unknown): SketchId | undefined {
  // The cast follows the shape check, as in fromData.
  return typeof v === 'string' && SKETCH_ID.test(v) ? (v as SketchId) : undefined;
}
