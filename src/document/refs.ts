import { assert, assertNever } from '@/core';
import type { Brand } from '@/core';
import type { FeatureId } from './model';

// References from feature params to results of other features. Always names,
// never indices or kernel handles, so they survive regeneration (ADR 0007).

/** '<featureId>/body' or '<featureId>/body:<n>'; minted only by bodyId() (ADR 0015). */
export type BodyId = Brand<string, 'BodyId'>;
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

/** Any reference; `kind` tells which. */
export type EntityRef = BodyRef | TopoRef | SketchRegionRef;

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

/** The feature that minted the body id: the text before the first '/'. */
export function originOfBody(body: BodyId): FeatureId {
  const slash = body.indexOf('/');
  assert(slash !== -1, `originOfBody: '${body}' is not a body id`);
  // The text before '/' is the FeatureId that bodyId() was given.
  return body.slice(0, slash) as FeatureId;
}

/** The feature whose result the reference points to. */
export function ownerOf(ref: EntityRef): FeatureId {
  switch (ref.kind) {
    case 'body':
    case 'topo':
      return originOfBody(ref.body);
    case 'region':
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
    case 'body':
      return isBodyIdText(r.body) ? Object.freeze({ kind, body: r.body as BodyId }) : undefined;
    case 'topo':
      return isBodyIdText(r.body) && typeof r.name === 'string'
        ? Object.freeze({ kind, body: r.body as BodyId, name: r.name as TopoName })
        : undefined;
    case 'region':
      return typeof r.sketch === 'string' && typeof r.region === 'string'
        ? Object.freeze({ kind, sketch: r.sketch as FeatureId, region: r.region })
        : undefined;
    default:
      return assertNever(kind);
  }
}

function isRecord(v: unknown): v is Readonly<Record<string, unknown>> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** '<owner>/body' or '<owner>/body:<n>' with n >= 1, as bodyId mints it; data from outside is checked here. */
const BODY_ID = /^[^/]+\/body(?::[1-9][0-9]*)?$/;

function isBodyIdText(v: unknown): v is string {
  return typeof v === 'string' && BODY_ID.test(v);
}
