import { describe, expect, it } from 'vitest';
import type { Plane, Vec3 } from '@/core';
import type { SketchDrawing } from '@/interaction';
import { tessellateSketch } from '@/render/sketch-drawing';

const XY: Plane = { origin: [0, 0, 0], xDir: [1, 0, 0], normal: [0, 0, 1] };
/** Plane XZ like the origin plane Front: x → +X, y = normal × xDir → +Z. */
const XZ: Plane = { origin: [0, 0, 0], xDir: [1, 0, 0], normal: [0, -1, 0] };

function drawing(partial: Partial<SketchDrawing>): SketchDrawing {
  return { plane: XY, curves: [], points: [], ...partial };
}

function segmentEnds(segments: Float32Array, segment: number): [Vec3, Vec3] {
  const at = (i: number): number => segments[6 * segment + i] ?? NaN;
  return [
    [at(0), at(1), at(2)],
    [at(3), at(4), at(5)],
  ];
}

function expectClose(actual: Vec3, expected: Vec3): void {
  actual.forEach((value, i) => {
    expect(value).toBeCloseTo(expected[i] ?? NaN, 5);
  });
}

describe('tessellateSketch', () => {
  it('gives an empty result for an empty drawing', () => {
    const t = tessellateSketch(drawing({}));
    expect(t.segments).toHaveLength(0);
    expect(t.segmentCurves).toEqual([]);
    expect(t.segmentStyles).toEqual([]);
    expect(t.points).toHaveLength(0);
    expect(t.pointIds).toEqual([]);
    expect(t.pointStyles).toEqual([]);
  });

  it('turns a line into one segment', () => {
    const t = tessellateSketch(
      drawing({
        curves: [{ kind: 'line', id: 'l1', from: [1, 2], to: [4, 6], style: 'normal' }],
      }),
    );
    expect(t.segments).toHaveLength(6);
    const [a, b] = segmentEnds(t.segments, 0);
    expectClose(a, [1, 2, 0]);
    expectClose(b, [4, 6, 0]);
    expect(t.segmentCurves).toEqual(['l1']);
    expect(t.segmentStyles).toEqual(['normal']);
  });

  it('splits a half circle by π/36 into 36 segments on the arc', () => {
    const t = tessellateSketch(
      drawing({
        curves: [
          {
            kind: 'arc',
            id: 'a1',
            center: [10, 0],
            radius: 5,
            startAngle: 0,
            endAngle: Math.PI,
            style: 'defined',
          },
        ],
      }),
    );
    expect(t.segments).toHaveLength(36 * 6);
    expect(t.segmentCurves).toEqual(Array<string>(36).fill('a1'));
    expect(t.segmentStyles).toEqual(Array<string>(36).fill('defined'));
    expectClose(segmentEnds(t.segments, 0)[0], [15, 0, 0]);
    expectClose(segmentEnds(t.segments, 35)[1], [5, 0, 0]);
    for (let s = 0; s < 36; s++) {
      const [a, b] = segmentEnds(t.segments, s);
      for (const p of [a, b]) expect(Math.hypot(p[0] - 10, p[1])).toBeCloseTo(5, 5);
      // Consecutive segments share their ends: a polyline.
      if (s > 0) expectClose(segmentEnds(t.segments, s - 1)[1], a);
    }
  });

  it('closes a full circle and takes at least two segments for a tiny arc', () => {
    const t = tessellateSketch(
      drawing({
        curves: [
          {
            kind: 'arc',
            id: 'c',
            center: [0, 0],
            radius: 1,
            startAngle: 0,
            endAngle: 2 * Math.PI,
            style: 'normal',
          },
          {
            kind: 'arc',
            id: 'tiny',
            center: [0, 0],
            radius: 1,
            startAngle: 0,
            endAngle: 0.01,
            style: 'normal',
          },
        ],
      }),
    );
    expect(t.segmentCurves.filter((id) => id === 'c')).toHaveLength(72);
    expect(t.segmentCurves.filter((id) => id === 'tiny')).toHaveLength(2);
    expectClose(segmentEnds(t.segments, 71)[1], segmentEnds(t.segments, 0)[0]);
  });

  it('honours a custom maximum step', () => {
    const t = tessellateSketch(
      drawing({
        curves: [
          {
            kind: 'arc',
            id: 'q',
            center: [0, 0],
            radius: 1,
            startAngle: 0,
            endAngle: Math.PI / 2,
            style: 'normal',
          },
        ],
      }),
      Math.PI / 8,
    );
    expect(t.segmentCurves).toHaveLength(4);
  });

  it('maps points through plane.toWorld on the plane XZ', () => {
    const t = tessellateSketch(
      drawing({
        plane: { ...XZ, origin: [0, 5, 0] },
        curves: [{ kind: 'line', id: 'l', from: [0, 0], to: [2, 3], style: 'construction' }],
        points: [
          { id: 'p1', at: [2, 3], style: 'selected' },
          { id: '__origin', at: [0, 0], style: 'plane' },
        ],
      }),
    );
    expectClose(segmentEnds(t.segments, 0)[1], [2, 5, 3]);
    expect(Array.from(t.points)).toEqual([2, 5, 3, 0, 5, 0]);
    expect(t.pointIds).toEqual(['p1', '__origin']);
    expect(t.pointStyles).toEqual(['selected', 'plane']);
  });

  it('keeps the curve id and style of every segment across curves', () => {
    const t = tessellateSketch(
      drawing({
        curves: [
          { kind: 'line', id: 'l1', from: [0, 0], to: [1, 0], style: 'hover' },
          {
            kind: 'arc',
            id: 'a',
            center: [0, 0],
            radius: 1,
            startAngle: 0,
            endAngle: Math.PI / 18,
            style: 'selected',
          },
          { kind: 'line', id: 'l2', from: [0, 0], to: [0, 1], style: 'normal' },
        ],
      }),
    );
    expect(t.segmentCurves).toEqual(['l1', 'a', 'a', 'l2']);
    expect(t.segmentStyles).toEqual(['hover', 'selected', 'selected', 'normal']);
  });

  it('turns a polyline (M29) into its segments with one id and style', () => {
    const t = tessellateSketch(
      drawing({
        plane: XZ,
        curves: [
          {
            kind: 'polyline',
            id: 's1',
            points: [
              [0, 0],
              [1, 1],
              [3, 1],
              [4, 0],
            ],
            style: 'construction',
          },
        ],
      }),
    );
    expect(t.segments).toHaveLength(3 * 6);
    expect(t.segmentCurves).toEqual(['s1', 's1', 's1']);
    expect(t.segmentStyles).toEqual(['construction', 'construction', 'construction']);
    expectClose(segmentEnds(t.segments, 0)[0], [0, 0, 0]);
    expectClose(segmentEnds(t.segments, 0)[1], [1, 0, 1]);
    expectClose(segmentEnds(t.segments, 1)[1], [3, 0, 1]);
    expectClose(segmentEnds(t.segments, 2)[1], [4, 0, 0]);
  });

  it('gives no segment for a polyline of fewer than two points', () => {
    const t = tessellateSketch(
      drawing({ curves: [{ kind: 'polyline', id: 's1', points: [[1, 1]], style: 'normal' }] }),
    );
    expect(t.segments).toHaveLength(0);
    expect(t.segmentCurves).toEqual([]);
  });

  it('rejects a non-positive step', () => {
    expect(() => tessellateSketch(drawing({}), 0)).toThrow();
  });
});
