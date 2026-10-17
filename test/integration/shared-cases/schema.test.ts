// The runner of the shared cases schema.visibleWhen (spec 13, Druhy případů; spec 14, Schéma
// featur › VisibleWhen): whether a param of a built-in feature applies to unchecked params, by
// isParamVisible over the schema of the plugin. The cases pin the seven predicates of today for
// the declarative VisibleWhen of the C++ core.

import { isParamVisible } from '@/document';
import { builtInSchemas } from './support/plugins';
import { describeSharedCases } from './support/runner';

const schemas = builtInSchemas();

describeSharedCases('schema', {
  'schema.visibleWhen': {
    run(input) {
      const { type, param, params } = visibleWhenInput(input);
      const spec = schemas.get(type).params[param];
      if (spec === undefined) throw new Error(`Feature '${type}' has no param '${param}'`);
      return { ok: { visible: isParamVisible(spec, params) } };
    },
  },
});

interface VisibleWhenInput {
  readonly type: string;
  readonly param: string;
  readonly params: Readonly<Record<string, unknown>>;
}

/** The input { type, param, params } of schema.visibleWhen; a malformed one is a broken case. */
function visibleWhenInput(input: unknown): VisibleWhenInput {
  if (typeof input !== 'object' || input === null) throw new Error('input must be an object');
  const { type, param, params } = input as Partial<Record<string, unknown>>; // fields checked below
  if (typeof type !== 'string' || typeof param !== 'string') {
    throw new Error('input.type and input.param must be strings');
  }
  if (typeof params !== 'object' || params === null || Array.isArray(params)) {
    throw new Error('input.params must be an object');
  }
  // A non-null, non-array object: a record of unchecked params, as isParamVisible takes it.
  return { type, param, params: params as Readonly<Record<string, unknown>> };
}
