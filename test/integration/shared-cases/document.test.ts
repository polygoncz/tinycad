// The runner of the shared cases document.load (spec 13, Druhy případů; spec 03): loading
// DocumentData from outside with fromData, which checks the shape and the invariants and
// migrates the features to the current version of their schema. The cases pin the load rules
// and the feature migrations for the C++ core.

import { fromData, toData } from '@/document';
import { builtInSchemas } from './support/plugins';
import { describeSharedCases } from './support/runner';
import { compareStrings } from './support/sort';

const schemas = builtInSchemas();

describeSharedCases('document', {
  'document.load': {
    run(input) {
      if (typeof input !== 'object' || input === null || !('data' in input)) {
        throw new Error('input must be an object with data');
      }
      const loaded = fromData(input.data, schemas);
      if (loaded.ok) return { ok: { data: toData(loaded.value) } };
      // The paths of the issues only: the messages differ in C++ (spec 13, Obálka). Sorted by
      // path, the order of the checks is not part of the contract.
      const issues = loaded.error.issues
        .map(({ path }) => ({ path }))
        .sort((a, b) => compareStrings(a.path, b.path));
      return { error: { issues } };
    },
  },
});
