import { describe, expectTypeOf, it } from 'vitest';
import type { Brand } from '@/core/brand';

type FeatureId = Brand<string, 'FeatureId'>;
type SketchId = Brand<string, 'SketchId'>;

describe('Brand', () => {
  it('keeps the underlying type usable', () => {
    expectTypeOf<FeatureId>().toExtend<string>();
  });

  it('does not accept a plain string or a different brand', () => {
    expectTypeOf<string>().not.toExtend<FeatureId>();
    expectTypeOf<SketchId>().not.toExtend<FeatureId>();
  });

  it('is created by an explicit cast at a single trusted place', () => {
    const id = 'f1' as FeatureId;
    expectTypeOf(id).toEqualTypeOf<FeatureId>();
  });
});
