import { assertNever } from '@/core';
import { isRefParamSpec, rulesOf } from './ref-kinds';
import type { ParamProblem } from './ref-kinds';
import { isParamVisible } from './schema';
import type { ParamIssue, ParamSchema, ParamSpec } from './schema';

// Generic checks driven by ParamSpec. A FeatureSchema calls this from validate()
// and adds its own rules. Missing and unexpected params are both issues (Q028).
// Issues carry codes, not texts (ADR 0014); the list of codes is in spec 03.

type Check = (value: unknown) => ParamProblem | undefined;

/** The numeric bounds of a length/angle/number spec. */
interface NumberRules {
  readonly min?: number;
  readonly max?: number;
  readonly exclusiveMin?: boolean;
  readonly exclusiveMax?: boolean;
  readonly integer?: boolean;
}

const WRONG_TYPE: ParamProblem = { code: 'param.wrongType' };

export function validateAgainstSchema(schema: ParamSchema, params: unknown): readonly ParamIssue[] {
  if (!isRecord(params)) return [{ param: '', ...WRONG_TYPE }];
  const issues: ParamIssue[] = [];
  for (const [key, spec] of Object.entries(schema)) {
    // A hidden param is neither required nor checked; present, it is not unexpected (M13).
    if (!isParamVisible(spec, params)) continue;
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
  // References: the rules of the table of reference kinds (M20, D5).
  if (isRefParamSpec(spec)) return (v) => rulesOf(spec).check(v, spec);
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
    case 'data':
      // Only required (checked above); the content is up to the schema's own validate (M12).
      return () => undefined;
    default:
      return assertNever(spec);
  }
}

function checkNumber(v: unknown, rules: NumberRules): ParamProblem | undefined {
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

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
