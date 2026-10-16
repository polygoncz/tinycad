import { beforeAll, describe, expect, it } from 'vitest';
import type { Vec2 } from '@/core';
import { kernelErrorCode, type FilletArc, type ProfileCurve } from '@/kernel';
import { createFakeKernel } from '@/kernel/testing';
import { loadOcct, type Occt } from '@/kernel-occt/occt';
import { OcctKernelImpl } from '@/kernel-occt/occt-kernel-impl';

// What the OCCT fillet center (spec 06 "Stav po M34", M34 task 1) relies on beyond the contract
// suite: InterCurveCurve throws on the offset of an unbounded Geom2d_Line, so the adapter trims
// the line; and cases outside the contract where both kernels agree.

let oc: Occt;

beforeAll(async () => {
  oc = await loadOcct();
});

type FilletParams = Parameters<OcctKernelImpl['filletArc']>[0];

const line = (from: Vec2, to: Vec2): ProfileCurve => ({ kind: 'line', from, to });
const ccwArc = (center: Vec2, from: Vec2, to: Vec2): ProfileCurve => ({
  kind: 'arc',
  center,
  from,
  to,
  ccw: true,
});

/** Rounded for comparing the two kernels. */
function rounded(f: FilletArc): unknown {
  // + 0 turns −0 into 0.
  const r = (x: number) => Math.round(x * 1e6) / 1e6 + 0;
  return {
    center: f.center.map(r),
    pointA: f.pointA.map(r),
    pointB: f.pointB.map(r),
    ta: r(f.ta),
    tb: r(f.tb),
  };
}

async function bothKernels(p: FilletParams): Promise<readonly [unknown, unknown]> {
  const occt = await new OcctKernelImpl(oc).filletArc(p);
  const fake = await createFakeKernel().filletArc(p);
  return [rounded(occt), rounded(fake)];
}

describe('OCCT building blocks (M34)', () => {
  it('InterCurveCurve throws on the offset of an unbounded line, not of a trimmed one', () => {
    using origin = new oc.gp_Pnt2d(0, 0);
    using x = new oc.gp_Dir2d(1, 0);
    using y = new oc.gp_Dir2d(0, 1);
    using first = new oc.Geom2d_Line(origin, x);
    using second = new oc.Geom2d_Line(origin, y);
    using unbounded1 = new oc.Geom2d_OffsetCurve(first, 2, true);
    using unbounded2 = new oc.Geom2d_OffsetCurve(second, 2, true);
    expect(() => new oc.Geom2dAPI_InterCurveCurve(unbounded1, unbounded2, 1e-7)).toThrow();
    using trimmed1 = new oc.Geom2d_TrimmedCurve(first, -1e6, 1e6, true, true);
    using trimmed2 = new oc.Geom2d_TrimmedCurve(second, -1e6, 1e6, true, true);
    using offset1 = new oc.Geom2d_OffsetCurve(trimmed1, 2, true);
    using offset2 = new oc.Geom2d_OffsetCurve(trimmed2, 2, true);
    using inter = new oc.Geom2dAPI_InterCurveCurve(offset1, offset2, 1e-7);
    expect(inter.NbPoints()).toBe(1);
    using p = inter.Point(1);
    // The offset is on the right of the direction: (2, −2) for +x and +y shifted by 2.
    expect([p.X(), p.Y()]).toEqual([expect.closeTo(2, 9), expect.closeTo(-2, 9)]);
  });
});

describe('OCCT filletArc agrees with the FakeKernel (M34)', () => {
  it.each([
    [
      'a radius larger than the arc: the center on the circle of radius r − ρ',
      { a: line([-10, -1], [10, -1]), b: ccwArc([0, 0], [1, 0], [0, 1]), radius: 3, near: [1, 1] },
    ],
    [
      'parallel lines exactly 2r apart: the center nearest near on the middle line',
      { a: line([0, 0], [10, 0]), b: line([0, 4], [10, 4]), radius: 2, near: [3, 1] },
    ],
    [
      'an offset touching the other: one center',
      { a: line([-10, 0], [10, 0]), b: ccwArc([0, 3], [1, 3], [-1, 3]), radius: 2, near: [1, 1] },
    ],
    [
      'concentric arcs whose gap is 2r: the center nearest near between them',
      {
        a: ccwArc([0, 0], [3, 0], [0, 3]),
        b: ccwArc([0, 0], [7, 0], [0, 7]),
        radius: 2,
        near: [3, 3],
      },
    ],
    [
      'far from the origin',
      {
        a: line([1000, 1000], [1010, 1000]),
        b: line([1010, 1000], [1010, 1010]),
        radius: 2,
        near: [1009, 1001],
      },
    ],
  ] satisfies [string, FilletParams][])('%s', async (_name, params) => {
    const [occt, fake] = await bothKernels(params);
    expect(occt).toEqual(fake);
  });

  it('nearly parallel lines whose center is beyond the trimmed carrier: operation-failed', async () => {
    // The offsets meet 10⁸ and more away; the carriers reach 10⁶ · the scale (10) only. The
    // FakeKernel finds them (outside the contract).
    const p: FilletParams = {
      a: line([0, 0], [10, 0]),
      b: line([0, 3], [10, 3 + 1e-7]),
      radius: 1,
      near: [-1e8, 0],
    };
    expect((await createFakeKernel().filletArc(p)).center[0]).toBeCloseTo(-1e8, 0);
    const e: unknown = await new OcctKernelImpl(oc).filletArc(p).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(kernelErrorCode(e)).toBe('operation-failed');
  });
});
