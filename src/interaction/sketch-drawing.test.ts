import { describe, expect, it } from 'vitest';
import { ORIGIN_PLANES, ORIGIN_PLANE_IDS } from '@/document';
import type { PlaneId } from '@/document';
import { parseSketchData } from '@/sketch';
import type { SketchData, SketchItemId } from '@/sketch';
import { rectangleData } from '@/sketch/testing';
import { ORIGIN_POINT_ID, artifactDrawing, planeDrawing, toSketchDrawing } from './sketch-drawing';

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

describe('artifactDrawing', () => {
  it('draws the non-construction curves in the style normal, without points', () => {
    const drawing = artifactDrawing(XY, ROUND.entities);

    expect(drawing.plane).toBe(XY);
    expect(drawing.curves.map((c) => [c.id, c.style])).toEqual([
      ['k', 'normal'],
      ['a', 'normal'],
    ]);
    expect(drawing.points).toEqual([]);
    expect(Object.isFrozen(drawing)).toBe(true);
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
