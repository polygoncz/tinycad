import { describe, expect, expectTypeOf, it } from 'vitest';
import * as kernel from '@/kernel';

// Guards the public API: a value export removed or added by accident shows up here.
describe('kernel public API', () => {
  it('exports exactly the runtime values of spec 06 (N122; kernelErrorCode only in testing.ts)', () => {
    expect(Object.keys(kernel).sort()).toEqual(['createKernelError', 'validateMeshData']);
  });

  it('ProfileCurve carries the optional entity id and matches Curve2 of sketch (M14)', () => {
    expectTypeOf<kernel.ProfileCurve['id']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<Extract<kernel.ProfileCurve, { kind: 'circle' }>>().toEqualTypeOf<{
      readonly kind: 'circle';
      readonly center: readonly [number, number];
      readonly radius: number;
      readonly id?: string;
    }>();
  });
});
