import { describe, expect, it } from 'vitest';
import { plane, vec3 } from '@/core';
import type { Vec2, Vec3 } from '@/core';
import { ORIGIN_AXES, ORIGIN_PLANES, ORIGIN_PLANE_IDS } from '@/document';
import type { PlaneId } from '@/document';
import { parseSketchData } from '@/sketch';
import type { SketchData, SketchItemId } from '@/sketch';
import { rectangleData } from '@/sketch/testing';
import {
  ORIGIN_POINT_ID,
  artifactDrawing,
  axisDrawing,
  planeDrawing,
  toSketchDrawing,
} from './sketch-drawing';

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

describe('artifactDrawing', () => {
  it('draws the curves without points: construction ones in the style construction (M13)', () => {
    const drawing = artifactDrawing(XY, ROUND.entities);

    expect(drawing.plane).toBe(XY);
    expect(drawing.curves.map((c) => [c.id, c.style])).toEqual([
      ['k', 'normal'],
      ['a', 'normal'],
      ['l', 'construction'],
    ]);
    expect(drawing.points).toEqual([]);
    expect(Object.isFrozen(drawing)).toBe(true);
  });

  it('adds the region of a rectangle, named like computeRegions, counter-clockwise', () => {
    const rect = rectangleData({ width: 10, height: 5 });

    const drawing = artifactDrawing(XY, rect.entities);

    expect(drawing.regions).toHaveLength(1);
    const [region] = drawing.regions ?? [];
    expect(region?.id).toBe('ab,bc,cd,da');
    expect(region?.holes).toEqual([]);
    expect(region?.outer).toHaveLength(4);
    expect(new Set(region?.outer.map(([x, y]) => `${String(x)},${String(y)}`))).toEqual(
      new Set(['0,0', '10,0', '10,5', '0,5']),
    );
    expect(polygonArea(region?.outer ?? [])).toBeCloseTo(50);
    expect(Object.isFrozen(drawing.regions)).toBe(true);
    expect(Object.isFrozen(region)).toBe(true);
  });

  it('a circle in a rectangle: the rectangle region has a hole, the circle is a region of its own', () => {
    const rect = rectangleData({ width: 10, height: 5 });
    const withCircle = data(
      [
        ...rect.entities,
        { kind: 'point', id: 'o', x: 5, y: 2.5 },
        { kind: 'circle', id: 'k', center: 'o', radius: 1 },
      ],
      rect.constraints,
    );

    const drawing = artifactDrawing(XY, withCircle.entities);

    expect(drawing.regions?.map((r) => r.id)).toEqual(['ab,bc,cd,da,k', 'k']);
    const [outer, circle] = drawing.regions ?? [];
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
    const halfDisc = data([
      { kind: 'point', id: 'c', x: 0, y: 0 },
      { kind: 'point', id: 's', x: 1, y: 0 },
      { kind: 'point', id: 'e', x: -1, y: 0 },
      { kind: 'arc', id: 'a', center: 'c', start: 's', end: 'e' },
      { kind: 'line', id: 'l', p1: 'e', p2: 's' },
    ]);

    const [region] = artifactDrawing(XY, halfDisc.entities).regions ?? [];

    // 36 arc segments (π / (π/36)) give 36 points from the start of the arc, plus the end of it.
    expect(region?.outer).toHaveLength(37);
    expect(polygonArea(region?.outer ?? [])).toBeGreaterThan(0);
  });

  it('crossing curves give no regions', () => {
    const crossing = data([
      { kind: 'point', id: 'a', x: 0, y: 0 },
      { kind: 'point', id: 'b', x: 2, y: 2 },
      { kind: 'point', id: 'c', x: 0, y: 2 },
      { kind: 'point', id: 'd', x: 2, y: 0 },
      { kind: 'line', id: 'ab', p1: 'a', p2: 'b' },
      { kind: 'line', id: 'cd', p1: 'c', p2: 'd' },
    ]);
    expect(artifactDrawing(XY, crossing.entities).regions).toEqual([]);
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
