// The runner of the shared cases schema.validate (spec 13, Druhy případů; spec 03, Validace):
// the issues of the params of a built-in feature by the validate of its schema. The cases pin
// the generic checks of validateAgainstSchema and the own rules of the features for the C++
// core.

import { builtInSchemas } from './support/plugins';
import { describeSharedCases } from './support/runner';
import { compareIssues } from './support/sort';

const schemas = builtInSchemas();

describeSharedCases('schema', {
  'schema.validate': {
    run(input) {
      if (typeof input !== 'object' || input === null || !('type' in input)) {
        throw new Error('input must be an object with type and params');
      }
      const { type } = input;
      if (typeof type !== 'string') throw new Error('input.type must be a string');
      const params = 'params' in input ? input.params : undefined;
      // The order of the issues is not part of the contract: sorted by param, code and params.
      const issues = [...schemas.get(type).validate(params)].sort(compareIssues);
      return { ok: { issues } };
    },
  },
});
