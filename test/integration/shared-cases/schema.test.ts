// The runner of the shared cases schema.validate and schema.visibleWhen (spec 13, Druhy případů;
// N150): the schemas of the client from the golden file of the descriptors of the core
// (featureSchemaOf: the generic checks, the declarative rules and VisibleWhen as data), so the
// validation of the feature dialog stays equal to the C++ core
// (server/test/shared-cases/schema_cases_test.cpp). The C++ core is the reference: the TS output
// is never recorded, and the issues of the rules only the server checks (SERVER_ONLY_CODES, spec
// 03) are dropped from expected before the comparison.

import { isParamVisible } from '@/document';
import type { CaseOutcome } from './support/case';
import { compareIssues, firstDifference } from './support/compare';
import { describeSharedCases } from './support/runner';
import { builtInSchemas, SERVER_ONLY_CODES } from './support/schemas';

const schemas = builtInSchemas();

describeSharedCases(
  'schema',
  {
    'schema.validate': {
      run(input) {
        const { type, params } = validateInput(input);
        // The order of the issues is not part of the contract: sorted like the C++ runner.
        const issues = [...schemas.get(type).validate(params)].sort(compareIssues);
        return { ok: { issues } };
      },
      verify(expected, actual, context) {
        return firstDifference(withoutServerOnlyIssues(expected), actual, context.tolerance);
      },
    },
    'schema.visibleWhen': {
      run(input) {
        const { type, param, params } = visibleWhenInput(input);
        const spec = schemas.get(type).params[param];
        if (spec === undefined) throw new Error(`Feature '${type}' has no param '${param}'`);
        return { ok: { visible: isParamVisible(spec, params) } };
      },
    },
  },
  { recorded: false },
);

/** expected of schema.validate without the issues the client does not check (SERVER_ONLY_CODES). */
function withoutServerOnlyIssues(expected: CaseOutcome): CaseOutcome {
  if (!('ok' in expected)) return expected;
  const { ok } = expected;
  if (!isRecord(ok) || !Array.isArray(ok['issues'])) return expected;
  // Array.isArray narrows to any[]; the issues are read as unknown.
  const issues = (ok['issues'] as readonly unknown[]).filter(
    (issue) => !(isRecord(issue) && SERVER_ONLY_CODES.includes(String(issue['code']))),
  );
  return { ok: { ...ok, issues } };
}

/** The input { type, params? } of schema.validate; a malformed one is a broken case. */
function validateInput(input: unknown): { readonly type: string; readonly params: unknown } {
  if (!isRecord(input)) throw new Error('input must be an object with type and params');
  const { type } = input;
  if (typeof type !== 'string') throw new Error('input.type must be a string');
  return { type, params: input['params'] };
}

interface VisibleWhenInput {
  readonly type: string;
  readonly param: string;
  readonly params: Readonly<Record<string, unknown>>;
}

/** The input { type, param, params } of schema.visibleWhen; a malformed one is a broken case. */
function visibleWhenInput(input: unknown): VisibleWhenInput {
  if (!isRecord(input)) throw new Error('input must be an object');
  const { type, param, params } = input;
  if (typeof type !== 'string' || typeof param !== 'string') {
    throw new Error('input.type and input.param must be strings');
  }
  if (!isRecord(params)) throw new Error('input.params must be an object');
  return { type, param, params };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
