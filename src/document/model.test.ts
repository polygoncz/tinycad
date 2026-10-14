import { describe, expect, expectTypeOf, it } from 'vitest';
import type { FeatureId, FeatureInstance, PartStudioData } from './model';
import type {
  AxisId,
  AxisRef,
  BodyId,
  BodyRef,
  EntityRef,
  PlaneId,
  PlaneRef,
  SketchEntityRef,
  SketchId,
  SketchRegionRef,
  TopoName,
  TopoRef,
} from './refs';

describe('document model types', () => {
  it('keeps ids of different kinds apart', () => {
    expectTypeOf<BodyId>().not.toExtend<FeatureId>();
    expectTypeOf<FeatureId>().not.toExtend<BodyId>();
    expectTypeOf<TopoName>().not.toExtend<BodyId>();
    expectTypeOf<PlaneId>().not.toExtend<BodyId>();
    expectTypeOf<SketchId>().not.toExtend<FeatureId>();
    expectTypeOf<AxisId>().not.toExtend<PlaneId>();
    expectTypeOf<PlaneId>().not.toExtend<AxisId>();
  });

  it('is readonly all the way to the feature params', () => {
    type Box = FeatureInstance<{ width: number }>;
    expectTypeOf<Box['params']>().toEqualTypeOf<Readonly<{ width: number }>>();
    expectTypeOf<PartStudioData['features']>().toEqualTypeOf<readonly FeatureInstance[]>();
  });

  it('narrows an EntityRef by its kind', () => {
    const label = (ref: EntityRef): string => {
      switch (ref.kind) {
        case 'body':
          expectTypeOf(ref).toEqualTypeOf<BodyRef>();
          return ref.body;
        case 'topo':
          expectTypeOf(ref).toEqualTypeOf<TopoRef>();
          return `${ref.body}#${ref.name}`;
        case 'region':
          expectTypeOf(ref).toEqualTypeOf<SketchRegionRef>();
          return `${ref.sketch}:${ref.region}`;
        case 'plane':
          expectTypeOf(ref).toEqualTypeOf<PlaneRef>();
          return ref.plane;
        case 'axis':
          expectTypeOf(ref).toEqualTypeOf<AxisRef>();
          return ref.axis;
        case 'sketchEntity':
          expectTypeOf(ref).toEqualTypeOf<SketchEntityRef>();
          return `${ref.sketch}:${ref.entity}`;
      }
    };
    const ref: EntityRef = { kind: 'topo', body: 'f1/body' as BodyId, name: 'face1' as TopoName };
    expect(label(ref)).toBe('f1/body#face1');
  });

  it('is plain JSON', () => {
    const feature: FeatureInstance<{ width: number }> = {
      id: 'f1' as FeatureId,
      type: 'box',
      typeVersion: 1,
      name: 'Box 1',
      params: { width: 10 },
      suppressed: false,
    };
    const studio: PartStudioData = { features: [feature], rollbackIndex: 1 };
    expect(JSON.parse(JSON.stringify(studio))).toEqual(studio);
  });
});
