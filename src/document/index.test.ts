import { describe, expect, expectTypeOf, it } from 'vitest';
import * as document from '.';
import type { BodyMeta } from '.';

// Guards the public API: a value export removed or added by accident shows up here.
describe('document public API', () => {
  it('exports exactly the runtime values of spec 03', () => {
    expect(Object.keys(document).sort()).toEqual(
      [
        'bodyId',
        'createDocument',
        'createFeatureSchemaRegistry',
        'dependenciesOf',
        'dependentsOf',
        'fromData',
        'migrateFeatureData',
        'orderViolations',
        'originOfBody',
        'ownerOf',
        'parseBodyId',
        'referencesOf',
        'toData',
        'validateAgainstSchema',
      ].sort(),
    );
  });

  it('exports the type BodyMeta of spec 03', () => {
    expectTypeOf<BodyMeta>().toEqualTypeOf<{ readonly name?: string; readonly hidden?: true }>();
  });
});
