import { describe, expect, it } from 'vitest';
import { bspline, plane, vec3 } from '@/core';
import type { Vec2, Vec3 } from '@/core';
import { ORIGIN_AXES, ORIGIN_PLANES, ORIGIN_PLANE_IDS } from '@/document';
import type { PlaneId } from '@/document';
import type { SketchDrawingCurve } from '@/interaction';
import { parseSketchData } from '@/sketch';
import type { Curve2, SketchData, SketchItemId, SketchRegion } from '@/sketch';
import { rectangleData } from '@/sketch/testing';
import {
  ORIGIN_POINT_ID,
  artifactDrawing,
  controlPolygonId,
  axisDrawing,
  planeDrawing,
  splineOfControlPolygon,
  toSketchDrawing,
} from '@/sketcher/sketch-drawing';

/** The frame of an origin plane. */
function originPlane(id: PlaneId) {
  const found = ORIGIN_PLANES.find((p) => p.id === id);
  if (found === undefined) throw new Error(`no origin plane ${id}`);
  return found.plane;
}

const XY = originPlane(ORIGIN_PLANE_IDS.xy);

/** Valid sketch data from plain values (parse brands the ids). */
function data(entities: readonly unknown[], constraints: readonly unknown[] = []): SketchData {
  const parsed = parseSketchData(entities, constraints);
  if (!parsed.ok) throw new Error(`invalid test data ${JSON.stringify(parsed.error)}`);
  return parsed.value;
}

/** A circle around c (radius 2), an arc around c from s ([1, 0]) to e ([0, 1]), construction line c–s. */
const ROUND = data([
  { kind: 'point', id: 'c', x: 0, y: 0 },
  { kind: 'point', id: 's', x: 1, y: 0 },
  { kind: 'point', id: 'e', x: 0, y: 1 },
  { kind: 'circle', id: 'k', center: 'c', radius: 2 },
  { kind: 'arc', id: 'a', center: 'c', start: 's', end: 'e' },
  { kind: 'line', id: 'l', p1: 'c', p2: 's', construction: true },
]);

const normal = (): 'normal' => 'normal';

describe('toSketchDrawing', () => {
  it('draws every curve and point with its style', () => {
    const rect = rectangleData({ width: 10, height: 5 });
    const styleOf = (id: SketchItemId) => (id === 'ab' || id === 'a' ? 'selected' : 'normal');

    const drawing = toSketchDrawing(XY, rect, styleOf);

    expect(drawing.plane).toBe(XY);
    expect(drawing.curves).toEqual([
      { kind: 'line', id: 'ab', from: [0, 0], to: [10, 0], style: 'selected' },
      { kind: 'line', id: 'bc', from: [10, 0], to: [10, 5], style: 'normal' },
      { kind: 'line', id: 'cd', from: [10, 5], to: [0, 5], style: 'normal' },
      { kind: 'line', id: 'da', from: [0, 5], to: [0, 0], style: 'normal' },
    ]);
    expect(drawing.points).toEqual([
      { id: 'a', at: [0, 0], style: 'selected' },
      { id: 'b', at: [10, 0], style: 'normal' },
      { id: 'c', at: [10, 5], style: 'normal' },
      { id: 'd', at: [0, 5], style: 'normal' },
    ]);
  });

  it('draws a circle as a full arc and an arc counter-clockwise', () => {
    const drawing = toSketchDrawing(XY, ROUND, normal);

    expect(drawing.curves[0]).toEqual({
      kind: 'arc',
      id: 'k',
      center: [0, 0],
      radius: 2,
      startAngle: 0,
      endAngle: 2 * Math.PI,
      style: 'normal',
    });
    expect(drawing.curves[1]).toMatchObject({ kind: 'arc', id: 'a', center: [0, 0], radius: 1 });
    expect(drawing.curves[1]).toMatchObject({ startAngle: 0 });
    expect((drawing.curves[1] as { endAngle: number }).endAngle).toBeCloseTo(Math.PI / 2); // an arc
  });

  it('keeps endAngle above startAngle across the ±π seam', () => {
    const seam = data([
      { kind: 'point', id: 'c', x: 0, y: 0 },
      { kind: 'point', id: 's', x: -1, y: 1 },
      { kind: 'point', id: 'e', x: -1, y: -1 },
      { kind: 'arc', id: 'a', center: 'c', start: 's', end: 'e' },
    ]);

    const [arc] = toSketchDrawing(XY, seam, normal).curves;

    expect(arc).toMatchObject({ kind: 'arc', radius: Math.SQRT2 });
    const { startAngle, endAngle } = arc as { startAngle: number; endAngle: number }; // an arc
    expect(startAngle).toBeCloseTo((3 * Math.PI) / 4);
    expect(endAngle).toBeCloseTo((5 * Math.PI) / 4);
  });

  it('adds the origin point with the style normal on request', () => {
    const selected = () => 'selected' as const;

    const without = toSketchDrawing(XY, rectangleData(), selected);
    const withOrigin = toSketchDrawing(XY, rectangleData(), selected, { origin: true });

    expect(without.points.map((p) => p.id)).not.toContain(ORIGIN_POINT_ID);
    expect(withOrigin.points.at(-1)).toEqual({ id: ORIGIN_POINT_ID, at: [0, 0], style: 'normal' });
  });

  it('marks the drawing of the edited sketch on request and only then', () => {
    const editing = toSketchDrawing(XY, rectangleData(), normal, { origin: true, editing: true });
    const plain = toSketchDrawing(XY, rectangleData(), normal, { origin: true });

    expect(editing.editing).toBe(true);
    expect(Object.isFrozen(editing)).toBe(true);
    expect('editing' in plain).toBe(false);
  });

  it('is frozen', () => {
    const drawing = toSketchDrawing(XY, ROUND, normal, { origin: true });

    expect(Object.isFrozen(drawing)).toBe(true);
    expect(Object.isFrozen(drawing.curves)).toBe(true);
    expect(Object.isFrozen(drawing.points)).toBe(true);
    expect(drawing.curves.every(Object.isFrozen)).toBe(true);
    expect(drawing.points.every(Object.isFrozen)).toBe(true);
  });

  it('draws empty data as an empty drawing', () => {
    const drawing = toSketchDrawing(XY, { entities: [], constraints: [] }, normal);

    expect(drawing.curves).toEqual([]);
    expect(drawing.points).toEqual([]);
  });
});

/** Signed area of a closed polygon (shoelace): > 0 counter-clockwise. */
function polygonArea(points: readonly Vec2[]): number {
  return (
    points.reduce((sum, [x, y], i) => {
      const [nx, ny] = points[(i + 1) % points.length] ?? [x, y];
      return sum + x * ny - nx * y;
    }, 0) / 2
  );
}

/** Pole points p0 … p3 of the cubic bspline 'b' and fit points f0 … f2 of the fitSpline 'f'. */
const POLES: readonly Vec2[] = [
  [0, 0],
  [10, 20],
  [20, -20],
  [30, 0],
];
const FIT: readonly Vec2[] = [
  [0, 40],
  [15, 50],
  [30, 40],
];
const FITTED = bspline.interpolate(FIT);
const SPLINES = data([
  ...POLES.map(([x, y], i) => ({ kind: 'point', id: `p${String(i)}`, x, y })),
  ...FIT.map(([x, y], i) => ({ kind: 'point', id: `f${String(i)}`, x, y })),
  {
    kind: 'bspline',
    id: 'b',
    degree: 3,
    poles: ['p0', 'p1', 'p2', 'p3'],
    knots: [0, 0, 0, 0, 1, 1, 1, 1],
  },
  {
    kind: 'fitSpline',
    id: 'f',
    degree: FITTED.degree,
    fit: ['f0', 'f1', 'f2'],
    params: FITTED.params,
    poles: FITTED.poles,
    knots: FITTED.knots,
  },
]);

/** The polyline of the drawing under the id. */
function polylineOf(curves: readonly SketchDrawingCurve[], id: string): readonly Vec2[] {
  for (const c of curves) if (c.kind === 'polyline' && c.id === id) return c.points;
  throw new Error(`no polyline ${id}`);
}

describe('splines (M29)', () => {
  it('draws a bspline as a polyline on the curve, then its control polygon as construction', () => {
    const drawing = toSketchDrawing(XY, SPLINES, normal);

    expect(drawing.curves.map((c) => [c.kind, c.id, c.style])).toEqual([
      ['polyline', 'b', 'normal'],
      ['polyline', controlPolygonId('b'), 'construction'],
      ['polyline', 'f', 'normal'],
    ]);
    const curve = polylineOf(drawing.curves, 'b');
    expect(curve.length).toBeGreaterThan(4);
    expect(curve[0]).toEqual([0, 0]);
    expect(curve[curve.length - 1]).toEqual([30, 0]);
    // The middle of the cubic Bézier with these poles: (0 + 3·10 + 3·20 + 30) / 8, (3·20 − 3·20) / 8.
    const shape = { degree: 3, poles: POLES, knots: [0, 0, 0, 0, 1, 1, 1, 1] };
    expect(bspline.evaluate(shape, 0.5)).toEqual([15, 0]);
    expect(curve).toContainEqual([15, 0]);
    expect(polylineOf(drawing.curves, controlPolygonId('b'))).toEqual(POLES);
  });

  it('draws the pole points of a bspline and the fit points of a fitSpline as points', () => {
    const drawing = toSketchDrawing(XY, SPLINES, normal);

    expect(drawing.points.map((p) => p.id)).toEqual(['p0', 'p1', 'p2', 'p3', 'f0', 'f1', 'f2']);
  });

  it('draws a fitSpline through its fit points, without its poles', () => {
    const drawing = toSketchDrawing(XY, SPLINES, normal);

    const curve = polylineOf(drawing.curves, 'f');
    expect(curve[0]).toEqual([0, 40]);
    expect(curve[curve.length - 1]).toEqual([30, 40]);
    const middle = curve.reduce((best, p) =>
      Math.abs(p[0] - 15) < Math.abs(best[0] - 15) ? p : best,
    );
    expect(middle[1]).toBeCloseTo(50, 0);
    expect(drawing.curves.some((c) => c.id === controlPolygonId('f'))).toBe(false);
  });

  it('keeps the tessellation within 1e-4 · max(1, largest |pole coordinate|) of the curve', () => {
    const drawing = toSketchDrawing(XY, SPLINES, normal);
    const curve = polylineOf(drawing.curves, 'b');
    const shape = { degree: 3, poles: POLES, knots: [0, 0, 0, 0, 1, 1, 1, 1] };
    const tolerance = 1e-4 * 30;
    // Densely sampled curve points lie near the polyline.
    for (let i = 0; i <= 200; i++) {
      const p = bspline.evaluate(shape, i / 200);
      expect(distanceToPolyline(p, curve)).toBeLessThanOrEqual(tolerance * 1.5);
    }
  });

  it('gives a spline the style of styleOf, its control polygon always construction', () => {
    const styleOf = (id: SketchItemId) => (id === 'b' ? 'selected' : 'construction');
    const drawing = toSketchDrawing(XY, SPLINES, styleOf);

    expect(drawing.curves.map((c) => [c.id, c.style])).toEqual([
      ['b', 'selected'],
      [controlPolygonId('b'), 'construction'],
      ['f', 'construction'],
    ]);
  });

  it('gives a control polygon id that is no entity id', () => {
    expect(SPLINES.entities.some((e) => e.id === controlPolygonId('b'))).toBe(false);
    expect(controlPolygonId('b')).not.toBe(controlPolygonId('f'));
    expect(controlPolygonId('b').startsWith('__')).toBe(true);
  });

  it('translates a control polygon id back to its spline, any other id to null (M29)', () => {
    expect(splineOfControlPolygon(controlPolygonId('b'))).toBe('b');
    expect(splineOfControlPolygon('b')).toBeNull();
    expect(splineOfControlPolygon(ORIGIN_POINT_ID)).toBeNull();
  });

  it('is frozen down to the points of a polyline', () => {
    const drawing = toSketchDrawing(XY, SPLINES, normal);

    expect(drawing.curves.every(Object.isFrozen)).toBe(true);
    for (const id of ['b', controlPolygonId('b'), 'f']) {
      const points = polylineOf(drawing.curves, id);
      expect(Object.isFrozen(points)).toBe(true);
      expect(points.every(Object.isFrozen)).toBe(true);
    }
  });

  it('a regenerated sketch: splines without control polygons, construction ones in the style construction', () => {
    const construction = data([
      ...SPLINES.entities.filter((e) => e.kind === 'point'),
      ...SPLINES.entities
        .filter((e) => e.kind !== 'point')
        .map((e) => (e.id === 'b' ? { ...e, construction: true } : e)),
    ]);

    const drawing = artifactDrawing(XY, construction.entities, []);

    expect(drawing.curves.map((c) => [c.kind, c.id, c.style])).toEqual([
      ['polyline', 'b', 'construction'],
      ['polyline', 'f', 'normal'],
    ]);
    expect(drawing.points).toEqual([]);
  });
});

function distanceToPolyline(p: Vec2, polyline: readonly Vec2[]): number {
  let best = Infinity;
  for (let i = 1; i < polyline.length; i++) {
    const a = polyline[i - 1] ?? p;
    const b = polyline[i] ?? p;
    const len2 = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2;
    const t =
      len2 === 0
        ? 0
        : Math.max(
            0,
            Math.min(1, ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / len2),
          );
    best = Math.min(
      best,
      Math.hypot(p[0] - a[0] - t * (b[0] - a[0]), p[1] - a[1] - t * (b[1] - a[1])),
    );
  }
  return best;
}

/** A region as the kernel gives it (SketchArtifact.outlines); the area does not matter to the drawing. */
function region(
  name: string,
  outer: readonly Curve2[],
  holes: readonly (readonly Curve2[])[] = [],
): SketchRegion {
  return { name, outer, holes, area: 1 };
}

const line = (id: string, from: Vec2, to: Vec2): Curve2 => ({ kind: 'line', id, from, to });

/** The counter-clockwise loop of the rectangle 10 × 5 of rectangleData. */
const RECT_LOOP: readonly Curve2[] = [
  line('ab', [0, 0], [10, 0]),
  line('bc', [10, 0], [10, 5]),
  line('cd', [10, 5], [0, 5]),
  line('da', [0, 5], [0, 0]),
];

const CIRCLE: Curve2 = { kind: 'circle', id: 'k', center: [5, 2.5], radius: 1 };

describe('artifactDrawing', () => {
  it('draws the curves without points: construction ones in the style construction (M13)', () => {
    const drawing = artifactDrawing(XY, ROUND.entities, []);

    expect(drawing.plane).toBe(XY);
    expect(drawing.curves.map((c) => [c.id, c.style])).toEqual([
      ['k', 'normal'],
      ['a', 'normal'],
      ['l', 'construction'],
    ]);
    expect(drawing.points).toEqual([]);
    expect(Object.isFrozen(drawing)).toBe(true);
  });

  it('takes the regions from the argument, not from the entities (M30)', () => {
    const rect = rectangleData({ width: 10, height: 5 });

    expect(artifactDrawing(XY, rect.entities, []).regions).toEqual([]);
  });

  it('draws a rectangle region from its outline, named like the region, counter-clockwise', () => {
    const rect = rectangleData({ width: 10, height: 5 });

    const drawing = artifactDrawing(XY, rect.entities, [region('ab,bc,cd,da', RECT_LOOP)]);

    expect(drawing.regions).toHaveLength(1);
    const [drawn] = drawing.regions ?? [];
    expect(drawn?.id).toBe('ab,bc,cd,da');
    expect(drawn?.holes).toEqual([]);
    expect(drawn?.outer).toEqual([
      [0, 0],
      [10, 0],
      [10, 5],
      [0, 5],
    ]);
    expect(polygonArea(drawn?.outer ?? [])).toBeCloseTo(50);
    expect(Object.isFrozen(drawing.regions)).toBe(true);
    expect(Object.isFrozen(drawn)).toBe(true);
  });

  it('keeps the order of the regions; a hole and a circle become polygons', () => {
    const disc = region('k', [CIRCLE]);
    const holed = region('ab,bc,cd,da,k', RECT_LOOP, [[CIRCLE]]);

    const drawing = artifactDrawing(XY, [], [disc, holed]);

    expect(drawing.regions?.map((r) => r.id)).toEqual(['k', 'ab,bc,cd,da,k']);
    const [circle, outer] = drawing.regions ?? [];
    expect(outer?.outer).toHaveLength(4);
    expect(outer?.holes).toHaveLength(1);
    // A full circle in steps of π/36.
    expect(outer?.holes[0]).toHaveLength(72);
    expect(circle?.outer).toHaveLength(72);
    expect(circle?.holes).toEqual([]);
    expect(polygonArea(circle?.outer ?? [])).toBeGreaterThan(0);
    for (const [x, y] of circle?.outer ?? []) expect(Math.hypot(x - 5, y - 2.5)).toBeCloseTo(1);
  });

  it('an arc becomes a polyline with steps of at most π/36', () => {
    // A half disc: the arc from [1, 0] to [-1, 0] around [0, 0] and the line back.
    const halfDisc = region('a,l', [
      { kind: 'arc', id: 'a', center: [0, 0], from: [1, 0], to: [-1, 0], ccw: true },
      line('l', [-1, 0], [1, 0]),
    ]);

    const [drawn] = artifactDrawing(XY, [], [halfDisc]).regions ?? [];

    // 36 arc segments (π / (π/36)) give 36 points from the start of the arc, plus the end of it.
    expect(drawn?.outer).toHaveLength(37);
    expect(polygonArea(drawn?.outer ?? [])).toBeGreaterThan(0);
  });

  it('a spline of an outline becomes the points of its tessellation (M29)', () => {
    const spline: Curve2 = {
      kind: 'bspline',
      id: 'b',
      degree: 3,
      poles: POLES,
      knots: [0, 0, 0, 0, 1, 1, 1, 1],
    };
    // The spline from [0, 0] to [30, 0], closed by a line back.
    const closed = region('b,l', [spline, line('l', [30, 0], [0, 0])]);

    const [drawn] = artifactDrawing(XY, [], [closed]).regions ?? [];

    const outer = drawn?.outer ?? [];
    // The tessellation without its end (the start of the line), then the start of the line.
    expect(outer.length).toBeGreaterThan(4);
    expect(outer[0]).toEqual([0, 0]);
    expect(outer.at(-1)).toEqual([30, 0]);
    for (const t of [0.25, 0.5, 0.75]) {
      expect(distanceToPolyline(bspline.evaluate(spline, t), outer)).toBeLessThan(1e-2);
    }
  });
});

describe('axisDrawing (M13)', () => {
  /** World points of the ends of the 'axis' line of the drawing. */
  function ends(axis: { readonly origin: Vec3; readonly direction: Vec3 }, size?: number) {
    const drawing = axisDrawing(axis, size);
    expect(drawing.curves).toHaveLength(1);
    const [line] = drawing.curves;
    if (line?.kind !== 'line') throw new Error('expected one line');
    expect(line.id).toBe('axis');
    expect(line.style).toBe('plane');
    expect(drawing.points).toEqual([]);
    expect(drawing.regions).toBeUndefined();
    expect(plane.isOrthonormal(drawing.plane)).toBe(true);
    return [plane.toWorld(drawing.plane, line.from), plane.toWorld(drawing.plane, line.to)];
  }

  it.each(ORIGIN_AXES.map((a) => [a.label, a] as const))(
    '%s: a line of 100 mm centred in the origin, along the axis',
    (_, axis) => {
      const [from, to] = ends(axis);
      expect(vec3.equals(from ?? [0, 0, 0], vec3.scale(axis.direction, -50))).toBe(true);
      expect(vec3.equals(to ?? [0, 0, 0], vec3.scale(axis.direction, 50))).toBe(true);
    },
  );

  it('a slanted axis off the origin, with a size', () => {
    const direction: Vec3 = [1, 1, 1];
    const origin: Vec3 = [1, 2, 3];
    const [from, to] = ends({ origin, direction }, 20);
    const unit = vec3.normalize(direction);
    expect(vec3.equals(from ?? [0, 0, 0], vec3.add(origin, vec3.scale(unit, -10)))).toBe(true);
    expect(vec3.equals(to ?? [0, 0, 0], vec3.add(origin, vec3.scale(unit, 10)))).toBe(true);
  });

  it('the plane: origin of the axis, xDir along it, normal by the rule of spec 10', () => {
    const z = axisDrawing({ origin: [0, 0, 0], direction: [0, 0, 1] });
    expect(z.plane.xDir).toEqual([0, 0, 1]);
    // |d_z| >= 0.9: d × +X.
    expect(vec3.equals(z.plane.normal, [0, 1, 0])).toBe(true);
    const x = axisDrawing({ origin: [1, 2, 3], direction: [2, 0, 0] });
    expect(x.plane.origin).toEqual([1, 2, 3]);
    expect(x.plane.xDir).toEqual([1, 0, 0]);
    // |d_z| < 0.9: d × +Z.
    expect(vec3.equals(x.plane.normal, [0, -1, 0])).toBe(true);
    expect(Object.isFrozen(x)).toBe(true);
  });
});

describe('planeDrawing', () => {
  it('draws a 100 × 100 square centred in the origin by default', () => {
    const drawing = planeDrawing(XY);

    expect(drawing.plane).toBe(XY);
    expect(drawing.points).toEqual([]);
    expect(drawing.curves).toEqual([
      { kind: 'line', id: 'edge0', from: [-50, -50], to: [50, -50], style: 'plane' },
      { kind: 'line', id: 'edge1', from: [50, -50], to: [50, 50], style: 'plane' },
      { kind: 'line', id: 'edge2', from: [50, 50], to: [-50, 50], style: 'plane' },
      { kind: 'line', id: 'edge3', from: [-50, 50], to: [-50, -50], style: 'plane' },
    ]);
    expect(Object.isFrozen(drawing.curves)).toBe(true);
  });

  it('takes the size', () => {
    const drawing = planeDrawing(originPlane(ORIGIN_PLANE_IDS.xz), 20);

    expect(drawing.curves[0]).toMatchObject({ from: [-10, -10], to: [10, -10] });
  });
});
