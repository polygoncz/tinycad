import { assertNever } from '@/core';
import type { ParamIssue, ParamSchema, ParamSpec } from './schema';

// Generic checks driven by ParamSpec. A FeatureSchema calls this from validate()
// and adds its own rules. Missing and unexpected params are both issues (Q028).

type Check = (value: unknown) => string | undefined;

export function validateAgainstSchema(schema: ParamSchema, params: unknown): readonly ParamIssue[] {
  if (!isRecord(params)) return [{ param: '', message: 'Params must be an object' }];
  const issues: ParamIssue[] = [];
  for (const [key, spec] of Object.entries(schema)) {
    if (!Object.hasOwn(params, key)) {
      issues.push({ param: key, message: 'Missing' });
      continue;
    }
    const message = checkParam(spec)(params[key]);
    if (message !== undefined) issues.push({ param: key, message });
  }
  for (const key of Object.keys(params)) {
    if (!Object.hasOwn(schema, key)) issues.push({ param: key, message: 'Unexpected param' });
  }
  return issues;
}

function checkParam(spec: ParamSpec): Check {
  switch (spec.kind) {
    case 'length':
    case 'angle':
      return (v) => checkNumber(v, spec.min, spec.max, false);
    case 'number':
      return (v) => checkNumber(v, spec.min, spec.max, spec.integer ?? false);
    case 'boolean':
      return (v) => (typeof v === 'boolean' ? undefined : 'Must be true or false');
    case 'enum':
      return (v) =>
        spec.options.some((o) => o.value === v)
          ? undefined
          : `Must be one of ${spec.options.map((o) => o.value).join(', ')}`;
    case 'point':
      return (v) =>
        Array.isArray(v) && v.length === 3 && v.every(isFiniteNumber)
          ? undefined
          : 'Must be a point [x, y, z]';
    case 'bodies':
      return checkRefs(spec.min, spec.max, 'body', (r) => typeof r.body === 'string');
    case 'topo':
      // Whether the name really is a face/edge/vertex is only known after regeneration.
      return checkRefs(
        spec.min,
        spec.max,
        'topo',
        (r) => typeof r.body === 'string' && typeof r.name === 'string',
      );
    case 'region':
      return checkRefs(
        spec.min,
        spec.max,
        'region',
        (r) => typeof r.sketch === 'string' && typeof r.region === 'string',
      );
    default:
      return assertNever(spec);
  }
}

function checkNumber(
  v: unknown,
  min: number | undefined,
  max: number | undefined,
  integer: boolean,
) {
  if (!isFiniteNumber(v)) return 'Must be a finite number';
  if (integer && !Number.isInteger(v)) return 'Must be a whole number';
  if (min !== undefined && v < min) return `Must be at least ${String(min)}`;
  if (max !== undefined && v > max) return `Must be at most ${String(max)}`;
  return undefined;
}

function checkRefs(
  min: number | undefined,
  max: number | undefined,
  kind: string,
  hasFields: (ref: Record<string, unknown>) => boolean,
): Check {
  return (v) => {
    if (!Array.isArray(v)) return 'Must be a list of references';
    const index = v.findIndex((r) => !isRecord(r) || r.kind !== kind || !hasFields(r));
    if (index !== -1) return `Reference ${String(index)} is not a valid '${kind}' reference`;
    if (min !== undefined && v.length < min) return `Select at least ${String(min)}`;
    if (max !== undefined && v.length > max) return `Select at most ${String(max)}`;
    return undefined;
  };
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
