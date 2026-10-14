import { describe, expect, expectTypeOf, it } from 'vitest';
import * as kernel from '.';

// Guards the public API: a value export removed or added by accident shows up here.
describe('kernel public API', () => {
  it('exports exactly the runtime values of spec 06', () => {
    expect(Object.keys(kernel).sort()).toEqual([
      'createKernelError',
      'isRigidMotion',
      'kernelErrorCode',
      'validateFaceInput',
      'validateMeshData',
    ]);
  });

  it('the port includes SweepOps with the Axis type (M13, checked by the type checker)', () => {
    expectTypeOf<kernel.GeometryKernel>().toExtend<kernel.SweepOps>();
    expectTypeOf<Parameters<kernel.SweepOps['revolve']>[1]>().toEqualTypeOf<kernel.Axis>();
  });
});
