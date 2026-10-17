// The shared-case runners register the built-in feature plugins on their own (app's
// BUILT_IN_PLUGINS needs the DOM types, test/integration/shared-cases/support/plugins.ts), so
// this test keeps the two lists equal: a new feature in app without shared cases fails here.

import { describe, expect, it } from 'vitest';
import { BUILT_IN_PLUGINS } from '@/app/index';
import { BUILT_IN_FEATURE_PLUGINS } from '../../integration/shared-cases/support/plugins';

describe('BUILT_IN_FEATURE_PLUGINS of the shared cases', () => {
  it('has the feature types of BUILT_IN_PLUGINS', () => {
    const types = (plugins: typeof BUILT_IN_PLUGINS) => plugins.map((p) => p.schema.type).sort();
    expect(types(BUILT_IN_FEATURE_PLUGINS)).toEqual(types(BUILT_IN_PLUGINS));
  });
});
