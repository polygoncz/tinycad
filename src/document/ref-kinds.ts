import { assertNever } from '@/core';
import { readRefOf } from './refs';
import type { EntityRef } from './refs';
import type { ParamIssue, ParamSpec, RefParamKind, RefParamSpec } from './schema';

// The table of reference kinds of document (M20, D5): what each reference kind of ParamSpec
// holds, how its value is checked and what makes two references the same. Pure data and
// functions; referencesOf, validateAgainstSchema and checkParamRules only read it, so a new
// reference kind is one entry here (and one in the table of interaction), and a missing entry is
// a type error. Internal to document.

/** An issue without the param key; the caller adds it. */
export type ParamProblem = Omit<ParamIssue, 'param'>;

/** The spec of one reference kind. */
export type RefParamSpecOf<K extends RefParamKind> = Extract<RefParamSpec, { readonly kind: K }>;

/** A reference param that holds an array; min/max count the references (spec 03). */
type ListSpec = Extract<RefParamSpec, { readonly min?: number }>;

/**
 * The rules of one reference kind; S is the spec of that kind. Methods, not function properties:
 * their parameters are bivariant, so the rules of one kind are RefParamKindRules (of any spec),
 * which rulesOf relies on.
 */
export interface RefParamKindRules<S extends RefParamSpec = RefParamSpec> {
  /** The kinds of EntityRef the param holds, in the order readRefOf tries them. */
  readonly refKinds: readonly EntityRef['kind'][];
  /** The candidate reference items of an unchecked value: the array, or the single value. */
  items(value: unknown): readonly unknown[];
  /** The problem of a present, visible value, or undefined when it is valid (codes: spec 03). */
  check(value: unknown, spec: S): ParamProblem | undefined;
}

const WRONG_TYPE: ParamProblem = { code: 'param.wrongType' };
const NO_ITEMS: readonly unknown[] = Object.freeze([]);

const BODY: readonly EntityRef['kind'][] = Object.freeze(['body']);
const TOPO: readonly EntityRef['kind'][] = Object.freeze(['topo']);
const REGION: readonly EntityRef['kind'][] = Object.freeze(['region']);
// A plane of the history, or a planar face of a body to sketch on (M14); whether the face
// really is planar is only known when regenerating.
const PLANE: readonly EntityRef['kind'][] = Object.freeze(['plane', 'topo']);
// An origin axis or a line of a sketch (M13).
const AXIS: readonly EntityRef['kind'][] = Object.freeze(['axis', 'sketchEntity']);

/** The rules of a param that holds an array of references of the kinds. */
function listOf(refKinds: readonly EntityRef['kind'][]): RefParamKindRules<ListSpec> {
  return Object.freeze({
    refKinds,
    // Array.isArray narrows to any[]; the items are unchecked data.
    items: (value: unknown) => (Array.isArray(value) ? (value as readonly unknown[]) : NO_ITEMS),
    check: (value: unknown, spec: ListSpec) => checkRefs(value, spec, refKinds),
  });
}

/** The rules of a param that holds a single reference of the kinds, empty as null (M13). */
function singleOf(
  refKinds: readonly EntityRef['kind'][],
): RefParamKindRules<RefParamSpecOf<'axis'>> {
  return Object.freeze({
    refKinds,
    items: (value: unknown) =>
      value === null || value === undefined ? NO_ITEMS : Object.freeze([value]),
    check: (value: unknown) => checkSingle(value, refKinds),
  });
}

/** One entry per reference kind of ParamSpec; a missing kind is a type error (D5). */
export const REF_PARAM_KINDS = Object.freeze({
  bodies: listOf(BODY),
  // Whether a topo name really is a face/edge/vertex is only known after regeneration.
  topo: listOf(TOPO),
  region: listOf(REGION),
  planes: listOf(PLANE),
  axis: singleOf(AXIS),
} satisfies { readonly [K in RefParamKind]: RefParamKindRules<RefParamSpecOf<K>> });

/** Whether the spec is of a reference kind, by the table. */
export function isRefParamSpec(spec: ParamSpec): spec is RefParamSpec {
  return Object.hasOwn(REF_PARAM_KINDS, spec.kind);
}

/**
 * The rules of the kind of the spec. The entry of kind K takes the spec of kind K, and spec.kind
 * picks exactly that entry; TypeScript cannot correlate the two, so the entry is widened to the
 * rules of any spec (bivariant methods, see RefParamKindRules).
 */
export function rulesOf(spec: RefParamSpec): RefParamKindRules {
  const rules: RefParamKindRules = REF_PARAM_KINDS[spec.kind];
  return rules;
}

/**
 * A single reference, always required (M13): null is too few, a valid reference of the kinds
 * passes, anything else (an array too) is an invalid reference without an index.
 */
function checkSingle(
  value: unknown,
  kinds: readonly EntityRef['kind'][],
): ParamProblem | undefined {
  if (value === null) return { code: 'param.tooFewRefs', params: { min: 1 } };
  // Same shape check as referencesOf, so both agree on what a reference is.
  return readRefOf(kinds, value) === undefined ? { code: 'param.invalidRef' } : undefined;
}

function checkRefs(
  value: unknown,
  { min, max }: ListSpec,
  kinds: readonly EntityRef['kind'][],
): ParamProblem | undefined {
  if (!Array.isArray(value)) return WRONG_TYPE;
  // Same shape check as referencesOf, so both agree on what a reference is.
  const keys: string[] = [];
  // Array.isArray narrows to any[]; the items are unchecked data.
  for (const [index, r] of (value as readonly unknown[]).entries()) {
    const ref = readRefOf(kinds, r);
    if (ref === undefined) return { code: 'param.invalidRef', params: { index } };
    keys.push(refKey(ref));
  }
  const duplicate = firstDuplicate(keys);
  if (duplicate !== -1) return { code: 'param.duplicateRef', params: { index: duplicate } };
  if (min !== undefined && value.length < min) return { code: 'param.tooFewRefs', params: { min } };
  if (max !== undefined && value.length > max) {
    return { code: 'param.tooManyRefs', params: { max } };
  }
  return undefined;
}

/**
 * The key (refKey) of one item of a reference param, read by the kinds of the param; undefined
 * when the item is not a valid reference of those kinds. checkParamRules (rules.ts) compares two
 * lists by it.
 */
export function refKeyOf(spec: RefParamSpec, item: unknown): string | undefined {
  const ref = readRefOf(rulesOf(spec).refKinds, item);
  return ref === undefined ? undefined : refKey(ref);
}

/**
 * What makes two references the same (spec 03): body for body, body + name for topo, sketch +
 * region for region, plane for plane, axis for axis, sketch + entity for a sketch entity (M13;
 * an axis param holds one reference, so it never has duplicates, but the switch stays exhaustive).
 * Extra fields of the raw data are ignored, readRef keeps only these. The kind is part of the key
 * (as in C++ ref_kinds.cpp), so references of two kinds never collide when a rule compares lists.
 * JSON of a tuple, so no separator character inside a name can make two keys collide.
 */
function refKey(ref: EntityRef): string {
  switch (ref.kind) {
    case 'body':
      return JSON.stringify(['body', ref.body]);
    case 'topo':
      return JSON.stringify(['topo', ref.body, ref.name]);
    case 'region':
      return JSON.stringify(['region', ref.sketch, ref.region]);
    case 'plane':
      return JSON.stringify(['plane', ref.plane]);
    case 'axis':
      return JSON.stringify(['axis', ref.axis]);
    case 'sketchEntity':
      return JSON.stringify(['sketchEntity', ref.sketch, ref.entity]);
    default:
      return assertNever(ref);
  }
}

/** Index of the first key equal to an earlier one, -1 when all differ. */
function firstDuplicate(keys: readonly string[]): number {
  const seen = new Set<string>();
  return keys.findIndex((key) => {
    if (seen.has(key)) return true;
    seen.add(key);
    return false;
  });
}
