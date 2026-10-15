import { describe, expect, expectTypeOf, it } from 'vitest';
import * as kernel from '@/kernel';

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

  it('ProfileCurve carries the optional entity id and matches Curve2 of sketch (M14)', () => {
    expectTypeOf<kernel.ProfileCurve['id']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<Extract<kernel.ProfileCurve, { kind: 'circle' }>>().toEqualTypeOf<{
      readonly kind: 'circle';
      readonly center: readonly [number, number];
      readonly radius: number;
      readonly id?: string;
    }>();
  });

  it('exports the topology types; the port includes DressupOps and topology (M14)', () => {
    expectTypeOf<kernel.FaceInfo['surface']>().toEqualTypeOf<kernel.SurfaceType>();
    expectTypeOf<kernel.FaceInfo['plane']>().toEqualTypeOf<kernel.FacePlane | undefined>();
    expectTypeOf<kernel.TopologySummary['faces']>().toEqualTypeOf<readonly kernel.FaceInfo[]>();
    expectTypeOf<kernel.TopologySummary['edges']>().toEqualTypeOf<readonly kernel.EdgeInfo[]>();
    expectTypeOf<kernel.TopologySummary['vertexCount']>().toEqualTypeOf<number>();
    expectTypeOf<kernel.EdgeInfo['faces']>().toEqualTypeOf<readonly number[]>();
    expectTypeOf<kernel.EdgeInfo['vertices']>().toEqualTypeOf<readonly number[]>();
    expectTypeOf<Parameters<kernel.DressupOps['fillet']>>().toEqualTypeOf<
      [kernel.ShapeHandle, readonly number[], number]
    >();
    expectTypeOf<Parameters<kernel.DressupOps['chamfer']>>().toEqualTypeOf<
      [kernel.ShapeHandle, readonly number[], number]
    >();
    expectTypeOf<kernel.GeometryKernel>().toExtend<kernel.DressupOps>();
    expectTypeOf<ReturnType<kernel.QueryOps['topology']>>().toEqualTypeOf<
      Promise<kernel.TopologySummary>
    >();
  });

  it('the port includes ExchangeOps with exportStep (M15)', () => {
    expectTypeOf<kernel.GeometryKernel>().toExtend<kernel.ExchangeOps>();
    expectTypeOf<Parameters<kernel.ExchangeOps['exportStep']>>().toEqualTypeOf<
      [readonly kernel.ShapeHandle[]]
    >();
    expectTypeOf<ReturnType<kernel.ExchangeOps['exportStep']>>().toEqualTypeOf<
      Promise<Uint8Array<ArrayBuffer>>
    >();
  });
});
