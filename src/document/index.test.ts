import { describe, expect, expectTypeOf, it } from 'vitest';
import * as document from '.';
import type { Plane } from '@/core';
import type { BodyMeta, EntityRef, OriginPlane, PlaneId, PlaneRef, SketchId } from '.';

// Guards the public API: a value export removed or added by accident shows up here.
describe('document public API', () => {
  it('exports exactly the runtime values of spec 03', () => {
    expect(Object.keys(document).sort()).toEqual(
      [
        'ORIGIN',
        'ORIGIN_PLANES',
        'ORIGIN_PLANE_IDS',
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
        'parsePlaneId',
        'referencesOf',
        'sketchId',
        'toData',
        'validateAgainstSchema',
      ].sort(),
    );
  });

  it('exports the type BodyMeta of spec 03', () => {
    expectTypeOf<BodyMeta>().toEqualTypeOf<{ readonly name?: string; readonly hidden?: true }>();
  });

  it('exports the plane and sketch types of spec 03 (M12)', () => {
    expectTypeOf<PlaneRef>().toEqualTypeOf<{ readonly kind: 'plane'; readonly plane: PlaneId }>();
    expectTypeOf<PlaneRef>().toExtend<EntityRef>();
    expectTypeOf<OriginPlane>().toEqualTypeOf<{
      readonly id: PlaneId;
      readonly label: string;
      readonly plane: Plane;
    }>();
    expectTypeOf<SketchId>().toExtend<string>();
  });
});
