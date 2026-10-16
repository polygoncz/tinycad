import { beforeAll, describe, expect, it } from 'vitest';
import type { Vec2 } from '@/core';
import type { CurveIntersection, ProfileCurve } from '@/kernel';
import { createFakeKernel } from '@/kernel/testing';
import { loadOcct, type Occt } from '@/kernel-occt/occt';
import { OcctKernelImpl } from '@/kernel-occt/occt-kernel-impl';

// What the OCCT curve intersections and pieces (spec 06 "Stav po M33", M33 task 1) rely on
// beyond the contract suite: Geom2dAPI_ProjectPointOnCurve gives the parameter of an
// intersection point (InterCurveCurve gives none), Geom2d_BSplineCurve.Segment cuts a copy and
// leaves the original whole; and cases outside the contract where both kernels agree.

let oc: Occt;

beforeAll(async () => {
  oc = await loadOcct();
});

const line = (id: string, from: Vec2, to: Vec2): ProfileCurve => ({ kind: 'line', id, from, to });

/** A closed cubic spline around the square [0, 10]², from (0, 0) back to (0, 0). */
const CLOSED: ProfileCurve = {
  kind: 'bspline',
  id: 'sp',
  degree: 3,
  poles: [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
    [0, 0],
  ],
  knots: [0, 0, 0, 0, 0.5, 1, 1, 1, 1],
};

function occtHits(curves: readonly ProfileCurve[]): Promise<readonly CurveIntersection[]> {
  return new OcctKernelImpl(oc).curveIntersections({ curves });
}

function fakeHits(curves: readonly ProfileCurve[]): Promise<readonly CurveIntersection[]> {
  return createFakeKernel().curveIntersections({ curves });
}

/** Rounded for comparing the two kernels. */
function rounded(hits: readonly CurveIntersection[]): unknown[] {
  // + 0 turns −0 into 0.
  const r = (x: number) => Math.round(x * 1e6) / 1e6 + 0;
  return hits.map((h) => ({ ...h, point: h.point.map(r), ta: r(h.ta), tb: r(h.tb) }));
}

describe('OCCT building blocks (M33)', () => {
  it('Geom2dAPI_ProjectPointOnCurve gives the parameter of an intersection point', () => {
    using a = new oc.gp_Pnt2d(0, 0);
    using b = new oc.gp_Pnt2d(10, 0);
    using c = new oc.gp_Pnt2d(4, -2);
    using d = new oc.gp_Pnt2d(4, 8);
    using first = new oc.GC_MakeSegment2d(a, b);
    using second = new oc.GC_MakeSegment2d(c, d);
    const g1 = first.Value();
    const g2 = second.Value();
    try {
      using inter = new oc.Geom2dAPI_InterCurveCurve(g1, g2, 1e-7);
      expect(inter.NbPoints()).toBe(1);
      using point = inter.Point(1);
      using projection = new oc.Geom2dAPI_ProjectPointOnCurve(point, g1);
      expect(projection.NbPoints()).toBeGreaterThan(0);
      // GC_MakeSegment2d runs from 0 to the length of the segment.
      expect(projection.LowerDistanceParameter()).toBeCloseTo(4, 9);
    } finally {
      g1.delete();
      g2.delete();
    }
  });

  it('Geom2d_BSplineCurve.Segment cuts a copy, the original stays whole', () => {
    using poles = new oc.NCollection_Array1_gp_Pnt2d(4);
    [
      [0, 0],
      [3, 4],
      [6, -4],
      [9, 0],
    ].forEach(([x, y], i) => {
      using pole = new oc.gp_Pnt2d(x ?? 0, y ?? 0);
      poles.SetValue(i, pole);
    });
    using knots = new oc.NCollection_Array1_double(2);
    knots.SetValue(0, 0);
    knots.SetValue(1, 1);
    using mults = new oc.NCollection_Array1_int(2);
    mults.SetValue(0, 4);
    mults.SetValue(1, 4);
    const original = new oc.Geom2d_BSplineCurve(poles, knots, mults, 3, false);
    const copy = original.Copy();
    try {
      // Copy() is typed Geom2d_Geometry; embind returns the most derived class.
      expect(copy).toBeInstanceOf(oc.Geom2d_BSplineCurve);
      if (!(copy instanceof oc.Geom2d_BSplineCurve)) return;
      copy.Segment(0.2, 0.7);
      expect([copy.FirstParameter(), copy.LastParameter()]).toEqual([0.2, 0.7]);
      expect([original.FirstParameter(), original.LastParameter()]).toEqual([0, 1]);
      using start = copy.StartPoint();
      // The Bézier at t = 0.2: 0.384 · (3, 4) + 0.096 · (6, −4) + 0.008 · (9, 0).
      expect(start.X()).toBeCloseTo(1.8, 12);
      expect(start.Y()).toBeCloseTo(1.152, 12);
    } finally {
      copy.delete();
      original.delete();
    }
  });
});

describe('OCCT curveIntersections beyond the contract (M33)', () => {
  it('a closed spline meets itself in its node, at its first and last parameter', async () => {
    const hits = await occtHits([CLOSED]);
    expect(rounded(hits)).toEqual([{ a: 'sp', b: 'sp', point: [0, 0], ta: 0, tb: 1 }]);
    expect(rounded(await fakeHits([CLOSED]))).toEqual(rounded(hits));
  });

  it.each([
    ['a circle touching another from inside', [ring('c1', [0, 0], 5), ring('c2', [0, 3], 2)]],
    [
      'arcs of one circle sharing a piece',
      [arc('k1', [0, 0], [5, 0], [-5, 0], true), arc('k2', [0, 0], [0, 5], [0, -5], true)],
    ],
    ['a circle and an arc on it', [ring('c', [0, 0], 5), arc('k', [0, 0], [5, 0], [0, 5], true)]],
    ['a rectangle', rectangle()],
  ])('%s: the same as the FakeKernel', async (_name, curves) => {
    expect(rounded(await occtHits(curves))).toEqual(rounded(await fakeHits(curves)));
  });

  it('300 lines on a grid: only the 150 × 150 crossings, quickly', async () => {
    const curves = Array.from({ length: 150 }, (_, i) => [
      line(`h${String(i)}`, [-1, i], [150, i]),
      line(`v${String(i)}`, [i + 0.5, -1], [i + 0.5, 150]),
    ]).flat();
    const started = performance.now();
    const hits = await occtHits(curves);
    expect(hits).toHaveLength(150 * 150);
    expect(performance.now() - started).toBeLessThan(5000);
  });
});

function ring(id: string, center: Vec2, radius: number): ProfileCurve {
  return { kind: 'circle', id, center, radius };
}

function arc(id: string, center: Vec2, from: Vec2, to: Vec2, ccw: boolean): ProfileCurve {
  return { kind: 'arc', id, center, from, to, ccw };
}

function rectangle(): ProfileCurve[] {
  return [
    line('ab', [0, 0], [10, 0]),
    line('bc', [10, 0], [10, 5]),
    line('cd', [10, 5], [0, 5]),
    line('da', [0, 5], [0, 0]),
  ];
}
