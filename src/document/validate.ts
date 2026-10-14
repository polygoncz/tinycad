import { assertNever } from '@/core';
import { readRef } from './refs';
import type { EntityRef } from './refs';
import type { ParamIssue, ParamSchema, ParamSpec } from './schema';

// Generic checks driven by ParamSpec. A FeatureSchema calls this from validate()
// and adds its own rules. Missing and unexpected params are both issues (Q028).
// Issues carry codes, not texts (ADR 0014); the list of codes is in spec 03.

/** An issue without the param key; the caller adds it. */
type Problem = Omit<ParamIssue, 'param'>;
type Check = (value: unknown) => Problem | undefined;

/** The numeric bounds of a length/angle/number spec. */
interface NumberRules {
  readonly min?: number;
  readonly max?: number;
  readonly exclusiveMin?: boolean;
  readonly exclusiveMax?: boolean;
  readonly integer?: boolean;
}

const WRONG_TYPE: Problem = { code: 'param.wrongType' };

export function validateAgainstSchema(schema: ParamSchema, params: unknown): readonly ParamIssue[] {
  if (!isRecord(params)) return [{ param: '', ...WRONG_TYPE }];
  const issues: ParamIssue[] = [];
  for (const [key, spec] of Object.entries(schema)) {
    if (!Object.hasOwn(params, key)) {
      issues.push({ param: key, code: 'param.missing' });
      continue;
    }
    const problem = checkParam(spec)(params[key]);
    if (problem !== undefined) issues.push({ param: key, ...problem });
  }
  for (const key of Object.keys(params)) {
    if (!Object.hasOwn(schema, key)) issues.push({ param: key, code: 'param.unexpected' });
  }
  return issues;
}

function checkParam(spec: ParamSpec): Check {
  switch (spec.kind) {
    case 'length':
    case 'angle':
    case 'number':
      return (v) => checkNumber(v, spec);
    case 'boolean':
      return (v) => (typeof v === 'boolean' ? undefined : WRONG_TYPE);
    case 'enum':
      return (v) =>
        spec.options.some((o) => o.value === v) ? undefined : { code: 'param.unknownOption' };
    case 'point':
      return (v) =>
        Array.isArray(v) && v.length === 3 && v.every(isFiniteNumber) ? undefined : WRONG_TYPE;
    case 'bodies':
      return checkRefs(spec.min, spec.max, 'body');
    case 'topo':
      // Whether the name really is a face/edge/vertex is only known after regeneration.
      return checkRefs(spec.min, spec.max, 'topo');
    case 'region':
      return checkRefs(spec.min, spec.max, 'region');
    case 'planes':
      return checkRefs(spec.min, spec.max, 'plane');
    case 'data':
      // Only required (checked above); the content is up to the schema's own validate (M12).
      return () => undefined;
    default:
      return assertNever(spec);
  }
}

function checkNumber(v: unknown, rules: NumberRules): Problem | undefined {
  if (!isFiniteNumber(v)) return WRONG_TYPE;
  if (rules.integer === true && !Number.isInteger(v)) return { code: 'param.notInteger' };
  const { min, max } = rules;
  if (min !== undefined) {
    if (rules.exclusiveMin === true) {
      if (v <= min) return { code: 'param.atOrBelowMin', params: { min } };
    } else if (v < min) return { code: 'param.belowMin', params: { min } };
  }
  if (max !== undefined) {
    if (rules.exclusiveMax === true) {
      if (v >= max) return { code: 'param.atOrAboveMax', params: { max } };
    } else if (v > max) return { code: 'param.aboveMax', params: { max } };
  }
  return undefined;
}

function checkRefs(
  min: number | undefined,
  max: number | undefined,
  kind: EntityRef['kind'],
): Check {
  return (v) => {
    if (!Array.isArray(v)) return WRONG_TYPE;
    // Same shape check as referencesOf, so both agree on what a reference is.
    const keys: string[] = [];
    // Array.isArray narrows to any[]; the items are unchecked data.
    for (const [index, r] of (v as readonly unknown[]).entries()) {
      const ref = readRef(kind, r);
      if (ref === undefined) return { code: 'param.invalidRef', params: { index } };
      keys.push(refKey(ref));
    }
    const duplicate = firstDuplicate(keys);
    if (duplicate !== -1) return { code: 'param.duplicateRef', params: { index: duplicate } };
    if (min !== undefined && v.length < min) return { code: 'param.tooFewRefs', params: { min } };
    if (max !== undefined && v.length > max) return { code: 'param.tooManyRefs', params: { max } };
    return undefined;
  };
}

/**
 * What makes two references the same (spec 03): body for body, body + name for topo, sketch +
 * region for region, plane for plane. Extra fields of the raw data are ignored, readRef keeps only these.
 * JSON of a tuple, so no separator character inside a name can make two keys collide.
 */
function refKey(ref: EntityRef): string {
  switch (ref.kind) {
    case 'body':
      return JSON.stringify([ref.body]);
    case 'topo':
      return JSON.stringify([ref.body, ref.name]);
    case 'region':
      return JSON.stringify([ref.sketch, ref.region]);
    case 'plane':
      return JSON.stringify([ref.plane]);
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

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
