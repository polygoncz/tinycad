import { beforeAll, describe, expect, it } from 'vitest';
import { bspline, type Vec2 } from '@/core';
import { kernelErrorCode, type OffsetCurve, type ProfileCurve } from '@/kernel';
import { createFakeKernel } from '@/kernel/testing';
import { splineCurve } from '@/kernel-occt/geom2d';
import { loadOcct, mapSubShapes, type Occt } from '@/kernel-occt/occt';
import { OcctKernelImpl } from '@/kernel-occt/occt-kernel-impl';

// What the OCCT offset (spec 06 "Stav po M35", M35 task 1) does beyond the contract suite: curves
// that vanish inwards, splines fitted as cubic B-splines, and the OCCT behaviour the adapter
// works around (the sign of a single arc, the overload of Geom2dAPI_PointsToBSpline, sharp
// corners next to a spline).

let oc: Occt;

beforeAll(async () => {
  oc = await loadOcct();
});

type OffsetParams = Parameters<OcctKernelImpl['offsetCurves']>[0];
type Spline = Extract<ProfileCurve, { kind: 'bspline' }>;

const seg = (id: string, from: Vec2, to: Vec2): ProfileCurve => ({ kind: 'line', from, to, id });

/** A cubic Bézier S-curve from (0, 0) to (10, 0). */
const WAVE: Spline = {
  kind: 'bspline',
  degree: 3,
  poles: [
    [0, 0],
    [3, 4],
    [7, -4],
    [10, 0],
  ],
  knots: [0, 0, 0, 0, 1, 1, 1, 1],
  id: 's',
};

/** A pentagon with the short side e1 (10, 0)–(10, 1), counter-clockwise. */
const PENTAGON: readonly Vec2[] = [
  [0, 0],
  [10, 0],
  [10, 1],
  [5, 1.5],
  [0, 6],
];
const PENTAGON_SIDES = PENTAGON.map((from, i) =>
  seg(`e${String(i)}`, from, PENTAGON[(i + 1) % PENTAGON.length] ?? from),
);

function offsetOf(p: OffsetParams): Promise<readonly OffsetCurve[]> {
  return new OcctKernelImpl(oc).offsetCurves(p);
}

async function rejection(p: Promise<unknown>): Promise<unknown> {
  return p.then(
    () => expect.fail('Expected the call to reject'),
    (e: unknown) => e,
  );
}

function startOf(c: OffsetCurve | undefined): Vec2 | undefined {
  if (c === undefined || c.kind === 'circle') return undefined;
  return c.kind === 'bspline' ? c.poles[0] : c.from;
}

function endOf(c: OffsetCurve | undefined): Vec2 | undefined {
  if (c === undefined || c.kind === 'circle') return undefined;
  return c.kind === 'bspline' ? c.poles[c.poles.length - 1] : c.to;
}

/** Each curve ends exactly where the next one starts (the last at the first when closed). */
function expectJoined(curves: readonly OffsetCurve[], closed: boolean): void {
  const joints = closed ? curves.length : curves.length - 1;
  for (let i = 0; i < joints; i++) {
    const end = endOf(curves[i]);
    const start = startOf(curves[(i + 1) % curves.length]);
    expect(end, `joint ${String(i)}`).toBeDefined();
    expect(end, `joint ${String(i)}`).toEqual(start);
  }
}

/** The distance of `q` from the input spline (Geom2dAPI_ProjectPointOnCurve and its ends). */
function distanceFrom(s: Spline, q: Vec2): number {
  using g = splineCurve(oc, s);
  using p = new oc.gp_Pnt2d(q[0], q[1]);
  using projection = new oc.Geom2dAPI_ProjectPointOnCurve(p, g);
  const ends = [s.poles[0], s.poles[s.poles.length - 1]].filter((e) => e !== undefined);
  let best = Math.min(...ends.map((e) => Math.hypot(q[0] - e[0], q[1] - e[1])));
  for (let i = 1; i <= projection.NbPoints(); i++) best = Math.min(best, projection.Distance(i));
  return best;
}

/** The distance of `q` from the carrier of the line from `a` to `b`. */
function distanceFromLine(a: Vec2, b: Vec2, q: Vec2): number {
  const d: Vec2 = [b[0] - a[0], b[1] - a[1]];
  return Math.abs(d[0] * (q[1] - a[1]) - d[1] * (q[0] - a[0])) / Math.hypot(d[0], d[1]);
}

describe('OCCT building blocks (M35)', () => {
  it('Geom2dAPI_PointsToBSpline: Init(points, 3, 3, C2, tol) gives a cubic curve', () => {
    const points = Array.from({ length: 21 }, (_, k): Vec2 => [k / 2, Math.sin(k / 4)]);
    using array = new oc.NCollection_Array1_gp_Pnt2d(points.length);
    points.forEach((q, k) => {
      using p = new oc.gp_Pnt2d(q[0], q[1]);
      array.SetValue(k, p);
    });
    using fit = new oc.Geom2dAPI_PointsToBSpline();
    fit.Init(array, 3, 3, oc.GeomAbs_Shape.GeomAbs_C2, 1e-4);
    using curve = fit.Curve();
    expect(curve.Degree()).toBe(3);
    // The constructor with the same five arguments binds another overload: not cubic.
    using other = new oc.Geom2dAPI_PointsToBSpline(array, 3, 3, oc.GeomAbs_Shape.GeomAbs_C2, 1e-4);
    using otherCurve = other.Curve();
    expect(otherCurve.Degree()).not.toBe(3);
  });

  it('GeomAbs_Intersection drops the curves around a sharp corner next to a spline', () => {
    // The open chain line → WAVE turns left at (0, 0): 1 to the right is the outer side.
    using maker = new oc.BRepBuilderAPI_MakeWire();
    using from = new oc.gp_Pnt(-5, 0, 0);
    using to = new oc.gp_Pnt(0, 0, 0);
    using lineMaker = new oc.BRepBuilderAPI_MakeEdge(from, to);
    using lineEdge = lineMaker.Edge();
    maker.Add(lineEdge);
    using poles = new oc.NCollection_Array1_gp_Pnt(4);
    WAVE.poles.forEach((q, i) => {
      using p = new oc.gp_Pnt(q[0], q[1], 0);
      poles.SetValue(i, p);
    });
    using knots = new oc.NCollection_Array1_double(2);
    using mults = new oc.NCollection_Array1_int(2);
    knots.SetValue(0, 0);
    knots.SetValue(1, 1);
    mults.SetValue(0, 4);
    mults.SetValue(1, 4);
    using curve = new oc.Geom_BSplineCurve(poles, knots, mults, 3, false);
    using splineMaker = new oc.BRepBuilderAPI_MakeEdge(curve);
    using splineEdge = splineMaker.Edge();
    maker.Add(splineEdge);
    using wire = maker.Wire();
    using origin = new oc.gp_Pnt(0, 0, 0);
    using normal = new oc.gp_Dir(0, 0, 1);
    using pln = new oc.gp_Pln(origin, normal);
    using faceMaker = new oc.BRepBuilderAPI_MakeFace(pln, wire, true);
    using face = faceMaker.Face();
    const edgeCount = (join: 'GeomAbs_Arc' | 'GeomAbs_Intersection'): number => {
      using offset = new oc.BRepOffsetAPI_MakeOffset(face, oc.GeomAbs_JoinType[join], true);
      offset.Perform(1, 0);
      expect(offset.IsDone()).toBe(true);
      using shape = offset.Shape();
      const edges = mapSubShapes(oc, shape, oc.TopAbs_ShapeEnum.TopAbs_EDGE);
      for (const e of edges) e.delete();
      return edges.length;
    };
    // Round corner: the line, the corner arc and the pieces of the spline.
    expect(edgeCount('GeomAbs_Arc')).toBeGreaterThan(2);
    // Sharp corner: the line is gone.
    expect(edgeCount('GeomAbs_Intersection')).toBeLessThan(edgeCount('GeomAbs_Arc') - 1);
  });
});

describe('OCCT offsetCurves: curves that vanish (M35)', () => {
  it('a short side survives a small offset inwards, as in the FakeKernel', async () => {
    const p = { curves: PENTAGON_SIDES, closed: true, distance: -0.2 };
    const occt = await offsetOf(p);
    const fake = await createFakeKernel().offsetCurves(p);
    expect(occt.map((c) => c.source)).toEqual(['e0', 'e1', 'e2', 'e3', 'e4']);
    occt.forEach((c, i) => {
      const f = fake[i];
      if (c.kind !== 'line' || f?.kind !== 'line') expect.fail('lines expected');
      expect([...c.from, ...c.to].map((x) => x.toFixed(9))).toEqual(
        [...f.from, ...f.to].map((x) => x.toFixed(9)),
      );
    });
  });

  it.each([
    [-0.6, ['e0', 'e2', 'e3', 'e4']],
    [-1.2, ['e0', 'e3', 'e4']],
  ])('%d inwards drops the short sides; the neighbours meet', async (distance, sources) => {
    const offset = await offsetOf({ curves: PENTAGON_SIDES, closed: true, distance });
    expect(offset.map((c) => c.source)).toEqual(sources);
    expectJoined(offset, true);
    for (const c of offset) {
      const side = PENTAGON_SIDES.find((s) => s.id === c.source);
      if (c.kind !== 'line' || side?.kind !== 'line') expect.fail('lines expected');
      for (const q of [c.from, c.to]) {
        expect(distanceFromLine(side.from, side.to, q)).toBeCloseTo(-distance, 9);
      }
    }
  });

  it('the FakeKernel rejects the same offset (it drops no curve)', async () => {
    const failed = await rejection(
      createFakeKernel().offsetCurves({ curves: PENTAGON_SIDES, closed: true, distance: -0.6 }),
    );
    expect(kernelErrorCode(failed)).toBe('operation-failed');
  });
});

describe('OCCT offsetCurves: splines (M35)', () => {
  /** Spec 06: a fitted spline keeps within 1e-4 · the scale (here 10) of the offset. */
  const TOLERANCE = 1e-4 * 10;

  it.each([1, -1, 0.5])(
    'a spline offset by %d is one cubic B-spline at that distance, its ends exact',
    async (distance) => {
      const [curve, ...rest] = await offsetOf({ curves: [WAVE], closed: false, distance });
      expect(rest).toEqual([]);
      if (curve?.kind !== 'bspline') expect.fail('a spline expected');
      expect(curve.source).toBe('s');
      expect(curve.degree).toBe(3);
      expect(curve.knots[0]).toBe(0);
      expect(curve.knots[curve.knots.length - 1]).toBe(1);
      // The right normals at the ends: the start runs along (3, 4), the end along (3, 4) too.
      const n: Vec2 = [0.8 * distance, -0.6 * distance];
      expect(curve.poles[0]?.[0]).toBeCloseTo(n[0], 9);
      expect(curve.poles[0]?.[1]).toBeCloseTo(n[1], 9);
      expect(curve.poles[curve.poles.length - 1]?.[0]).toBeCloseTo(10 + n[0], 9);
      expect(curve.poles[curve.poles.length - 1]?.[1]).toBeCloseTo(n[1], 9);
      for (let k = 0; k <= 200; k++) {
        const q = bspline.evaluate(curve, k / 200);
        expect(Math.abs(distanceFrom(WAVE, q) - Math.abs(distance))).toBeLessThan(TOLERANCE);
      }
    },
  );

  it('a spline and a line: the spline fitted, the line exact, joined in the order of the chain', async () => {
    const curves = [WAVE, seg('l', [10, 0], [15, 0])];
    const offset = await offsetOf({ curves, closed: false, distance: 1 });
    expect(offset.map((c) => `${c.kind}:${c.source ?? '-'}`)).toEqual(['bspline:s', 'line:l']);
    expectJoined(offset, false);
    const line = offset[1];
    if (line?.kind !== 'line') expect.fail('a line expected');
    expect(line.to).toEqual([15, -1]);
    expect(line.from[1]).toBeCloseTo(-1, 9);
  });

  /** Rectangle 10 × 5 whose right side bc is a spline bulging to x = 13. */
  const SPLINE_RECT: readonly ProfileCurve[] = [
    seg('ab', [0, 0], [10, 0]),
    {
      ...WAVE,
      poles: [
        [10, 0],
        [13, 1],
        [13, 4],
        [10, 5],
      ],
      id: 'bc',
    },
    seg('cd', [10, 5], [0, 5]),
    seg('da', [0, 5], [0, 0]),
  ];

  it('a rectangle with a spline side inwards: the spline between its lines', async () => {
    const offset = await offsetOf({ curves: SPLINE_RECT, closed: true, distance: -1 });
    expect(offset.map((c) => `${c.kind}:${c.source ?? '-'}`)).toEqual([
      'line:ab',
      'bspline:bc',
      'line:cd',
      'line:da',
    ]);
    expectJoined(offset, true);
  });

  it('a rectangle with a spline side outwards: round corners where sharp ones fail', async () => {
    // GeomAbs_Intersection drops curves next to the spline; GeomAbs_Arc takes over (M35).
    const offset = await offsetOf({ curves: SPLINE_RECT, closed: true, distance: 1 });
    expect(offset.map((c) => `${c.kind}:${c.source ?? '-'}`)).toEqual([
      'line:ab',
      'arc:-',
      'bspline:bc',
      'arc:-',
      'line:cd',
      'arc:-',
      'line:da',
      'arc:-',
    ]);
    expectJoined(offset, true);
    // The corner (0, 0) is a quarter circle of radius 1 around it.
    const corner = offset[7];
    if (corner?.kind !== 'arc') expect.fail('an arc expected');
    expect(corner.center.map((x) => x.toFixed(9))).toEqual(['0.000000000', '0.000000000']);
    expect(Math.hypot(...corner.from)).toBeCloseTo(1, 9);
  });

  it('an open chain with a sharp corner next to a spline gets a round one there', async () => {
    const curves = [seg('l', [-5, 0], [0, 0]), WAVE];
    const outer = await offsetOf({ curves, closed: false, distance: 1 });
    expect(outer.map((c) => `${c.kind}:${c.source ?? '-'}`)).toEqual([
      'line:l',
      'arc:-',
      'bspline:s',
    ]);
    expectJoined(outer, false);
    // The inner side of the same corner is cut sharp.
    expect((await offsetOf({ curves, closed: false, distance: -1 })).map((c) => c.source)).toEqual([
      'l',
      's',
    ]);
  });
});
