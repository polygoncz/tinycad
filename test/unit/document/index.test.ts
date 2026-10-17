import { describe, expect, expectTypeOf, it } from 'vitest';
import * as document from '@/document';
import type { Plane, Vec3 } from '@/core';
import type {
  AxisId,
  AxisRef,
  BodyMaterial,
  BodyMeta,
  FeatureId,
  PlaneId,
  PlaneRef,
  SketchEntityRef,
  SketchId,
} from '@/document';

// Guards the public API: a value export removed or added by accident shows up here.
describe('document public API', () => {
  it('exports exactly the runtime values of spec 03', () => {
    expect(Object.keys(document).sort()).toEqual(
      [
        'BODY_MATERIALS',
        'DEFAULT_BODY_MATERIAL',
        'NO_VARIABLES',
        'ORIGIN',
        'ORIGIN_AXES',
        'ORIGIN_PLANES',
        'ORIGIN_PLANE_IDS',
        'checkParamRules',
        'createDocument',
        'createFeatureSchemaRegistry',
        'createSnapshotDocument',
        'dependenciesOf',
        'evaluateParams',
        'isBodyColor',
        'isBodyMaterial',
        'isJsonObject',
        'isParamVisible',
        'migrateFeatureData',
        'orderViolations',
        'originOfBody',
        'ownerOfArtifact',
        'parseAxisId',
        'parseBodyId',
        'parsePlaneId',
        'parseSketchId',
        'readPlaneRef',
        'readRefOf',
        'samePlaneRef',
        'sketchId',
        'validateAgainstSchema',
      ].sort(),
    );
  });

  it('exports the type BodyMeta of spec 03', () => {
    expectTypeOf<BodyMeta>().toEqualTypeOf<{
      readonly name?: string;
      readonly hidden?: true;
      readonly color?: string;
      readonly material?: BodyMaterial;
    }>();
    expectTypeOf<BodyMaterial>().toEqualTypeOf<
      'plastic' | 'aluminium' | 'steel' | 'brass' | 'glass' | 'rubber'
    >();
  });

  it('exports the plane and sketch types of spec 03 (M12)', () => {
    expectTypeOf<PlaneRef>().toEqualTypeOf<{ readonly kind: 'plane'; readonly plane: PlaneId }>();
    expectTypeOf<(typeof document.ORIGIN_PLANES)[number]>().toEqualTypeOf<{
      readonly id: PlaneId;
      readonly label: string;
      readonly plane: Plane;
    }>();
    expectTypeOf<SketchId>().toExtend<string>();
  });

  it('exports the axis types of spec 03 (M13)', () => {
    expectTypeOf<AxisId>().toExtend<string>();
    expectTypeOf<AxisRef>().toEqualTypeOf<{ readonly kind: 'axis'; readonly axis: AxisId }>();
    expectTypeOf<SketchEntityRef>().toEqualTypeOf<{
      readonly kind: 'sketchEntity';
      readonly sketch: FeatureId;
      readonly entity: string;
    }>();
    expectTypeOf<(typeof document.ORIGIN_AXES)[number]>().toEqualTypeOf<{
      readonly id: AxisId;
      readonly label: string;
      readonly origin: Vec3;
      readonly direction: Vec3;
    }>();
  });
});
