import { describe, expect, it } from 'vitest';
import type { Plane, Vec2 } from '@/core';
import type { SketchDrawing, SketchDrawingRegion } from '@/interaction';
import {
  betterSketchHit,
  pickSketch,
  pickSketchRegion,
  pointInRegion,
  sketchHits,
  type SketchHit,
} from '@/render/sketch-pick';
import { tessellateSketch } from '@/render/sketch-drawing';

const f = (...values: number[]): Float32Array => new Float32Array(values);

describe('pickSketch', () => {
  it('prefers a point within the tolerance over a nearer curve', () => {
    // The segment passes right under the cursor, the point is 4 px away.
    const hit = pickSketch(f(0, 10, 100, 10), f(54, 10), 50, 10);
    expect(hit).toEqual({ kind: 'point', index: 0, distancePx: 4 });
  });

  it('gives the nearest of two points', () => {
    const hit = pickSketch(f(), f(10, 10, 52, 50, 49, 50), 50, 50);
    expect(hit).toMatchObject({ kind: 'point', index: 2 });
  });

  it('gives the nearest of two curves with the parameter on it', () => {
    const hit = pickSketch(f(0, 0, 100, 0, 0, 3, 100, 3), f(), 25, 4);
    expect(hit).toMatchObject({ kind: 'segment', index: 1, t: 0.25 });
    expect(hit?.distancePx).toBeCloseTo(1, 6);
  });

  it('gives null outside the tolerance', () => {
    expect(pickSketch(f(0, 0, 100, 0), f(50, 20), 50, 7)).toBeNull();
    expect(pickSketch(f(), f(), 0, 0)).toBeNull();
  });

  it('honours a custom tolerance and skips points off the view (NaN)', () => {
    expect(pickSketch(f(), f(60, 0), 50, 0, 12)).toMatchObject({ kind: 'point', index: 0 });
    expect(pickSketch(f(), f(NaN, NaN, 51, 0), 50, 0)).toMatchObject({ kind: 'point', index: 1 });
  });

  it('rejects screen points with an odd length', () => {
    expect(() => pickSketch(f(), f(1, 2, 3), 0, 0)).toThrow();
  });
});

describe('sketchHits', () => {
  it('gives every hit within the tolerance, points first, then by distance', () => {
    // Two segments 1 and 3 px away, two points 5 and 2 px away, one point out of reach.
    const hits = sketchHits(f(0, 11, 100, 11, 0, 7, 100, 7), f(55, 10, 52, 10, 90, 40), 50, 10);
    expect(hits.map((h) => [h.kind, h.index])).toEqual([
      ['point', 1],
      ['point', 0],
      ['segment', 0],
      ['segment', 1],
    ]);
  });

  it('starts with what pickSketch gives', () => {
    const segments = f(0, 0, 100, 0, 0, 3, 100, 3);
    const points = f(54, 10, 49, 1);
    expect(sketchHits(segments, points, 50, 2)[0]).toEqual(pickSketch(segments, points, 50, 2));
    expect(sketchHits(f(), f(), 0, 0)).toEqual([]);
  });

  it('honours a custom tolerance and skips points off the view (NaN)', () => {
    expect(sketchHits(f(), f(NaN, NaN, 60, 0), 50, 0, 12)).toEqual([
      { kind: 'point', index: 1, distancePx: 10 },
    ]);
  });
});

describe('betterSketchHit', () => {
  const point = (distancePx: number): SketchHit => ({ kind: 'point', index: 0, distancePx });
  const segment = (distancePx: number): SketchHit => ({
    kind: 'segment',
    index: 0,
    t: 0,
    distancePx,
  });

  it('prefers a point of another drawing over a nearer curve', () => {
    expect(betterSketchHit(point(5), segment(1))).toBe(true);
    expect(betterSketchHit(segment(1), point(5))).toBe(false);
  });

  it('prefers the nearer hit of the same kind and keeps the first on a tie', () => {
    expect(betterSketchHit(segment(1), segment(2))).toBe(true);
    expect(betterSketchHit(point(3), point(2))).toBe(false);
    expect(betterSketchHit(point(2), point(2))).toBe(false);
  });
});

const square = (x0: number, y0: number, size: number): Vec2[] => [
  [x0, y0],
  [x0 + size, y0],
  [x0 + size, y0 + size],
  [x0, y0 + size],
];

/** 10 × 10 square with a 4 × 4 hole in the middle. */
const framed: SketchDrawingRegion = {
  id: 'r1',
  outer: square(0, 0, 10),
  holes: [square(3, 3, 4)],
};

describe('pointInRegion', () => {
  it('is true inside the outer polygon and outside the holes', () => {
    expect(pointInRegion([1, 1], framed)).toBe(true);
    expect(pointInRegion([9, 5], framed)).toBe(true);
  });

  it('is false in a hole', () => {
    expect(pointInRegion([5, 5], framed)).toBe(false);
  });

  it('is false outside', () => {
    expect(pointInRegion([11, 5], framed)).toBe(false);
    expect(pointInRegion([-1, -1], framed)).toBe(false);
  });

  it('follows a concave polygon (an L shape)', () => {
    const l: SketchDrawingRegion = {
      id: 'l',
      outer: [
        [0, 0],
        [10, 0],
        [10, 4],
        [4, 4],
        [4, 10],
        [0, 10],
      ],
      holes: [],
    };
    expect(pointInRegion([2, 8], l)).toBe(true);
    expect(pointInRegion([8, 2], l)).toBe(true);
    // The notch of the L.
    expect(pointInRegion([8, 8], l)).toBe(false);
  });
});

const XY: Plane = { origin: [0, 0, 0], xDir: [1, 0, 0], normal: [0, 0, 1] };

function drawingOn(plane: Plane, regions?: readonly SketchDrawingRegion[]): SketchDrawing {
  return regions === undefined
    ? { plane, curves: [], points: [] }
    : { plane, curves: [], points: [], regions };
}

/** Looking down -Z from above. */
const downAt = (x: number, y: number) => ({
  origin: [x, y, 100] as const,
  direction: [0, 0, -1] as const,
});

describe('pickSketchRegion', () => {
  it('hits a region under the ray with the point on the plane', () => {
    const drawings = new Map([['f1/sketch', drawingOn(XY, [framed])]]);
    const hit = pickSketchRegion(drawings, downAt(1, 2));
    expect(hit).toEqual({ sketch: 'f1/sketch', region: 'r1', point: [1, 2, 0] });
  });

  it('gives null in a hole and outside the regions', () => {
    const drawings = new Map([['f1/sketch', drawingOn(XY, [framed])]]);
    expect(pickSketchRegion(drawings, downAt(5, 5))).toBeNull();
    expect(pickSketchRegion(drawings, downAt(20, 5))).toBeNull();
  });

  it('gives null for a ray parallel to the plane', () => {
    const drawings = new Map([['f1/sketch', drawingOn(XY, [framed])]]);
    expect(pickSketchRegion(drawings, { origin: [1, 1, 0], direction: [1, 0, 0] })).toBeNull();
  });

  it('gives the nearest of two drawings along the ray', () => {
    const lifted: Plane = { ...XY, origin: [0, 0, 20] };
    const drawings = new Map([
      ['low', drawingOn(XY, [framed])],
      ['high', drawingOn(lifted, [{ ...framed, id: 'r2' }])],
    ]);
    expect(pickSketchRegion(drawings, downAt(1, 1))).toEqual({
      sketch: 'high',
      region: 'r2',
      point: [1, 1, 20],
    });
    // From below the lower one is nearer.
    expect(
      pickSketchRegion(drawings, { origin: [1, 1, -100], direction: [0, 0, 1] }),
    ).toMatchObject({ sketch: 'low', region: 'r1' });
  });

  it('maps a drawing on the XZ plane through its frame', () => {
    // XZ: x axis +X, normal -Y, so the local y axis is normal × xDir = +Z.
    const xz: Plane = { origin: [0, 0, 0], xDir: [1, 0, 0], normal: [0, -1, 0] };
    const drawings = new Map([['xz', drawingOn(xz, [framed])]]);
    const ray = { origin: [1, -50, 2] as const, direction: [0, 1, 0] as const };
    expect(pickSketchRegion(drawings, ray)).toEqual({
      sketch: 'xz',
      region: 'r1',
      point: [1, 0, 2],
    });
    // Local (1, -2) is outside the square.
    expect(pickSketchRegion(drawings, { ...ray, origin: [1, -50, -2] })).toBeNull();
  });

  it('skips a region refused by accept and goes on to a farther one', () => {
    const lifted: Plane = { ...XY, origin: [0, 0, 20] };
    const drawings = new Map([
      ['low', drawingOn(XY, [framed])],
      ['high', drawingOn(lifted, [{ ...framed, id: 'r2' }])],
    ]);
    const asked: string[] = [];
    const hit = pickSketchRegion(drawings, downAt(1, 1), (sketch, point) => {
      asked.push(sketch);
      return point[2] < 10;
    });
    expect(hit).toEqual({ sketch: 'low', region: 'r1', point: [1, 1, 0] });
    expect(asked.sort()).toEqual(['high', 'low']);
  });

  it('skips drawings without regions', () => {
    const drawings = new Map([
      ['plain', drawingOn(XY)],
      ['empty', drawingOn(XY, [])],
    ]);
    expect(pickSketchRegion(drawings, downAt(1, 1))).toBeNull();
  });
});

describe('picking a polyline (M29)', () => {
  const XY: Plane = { origin: [0, 0, 0], xDir: [1, 0, 0], normal: [0, 0, 1] };
  // A zigzag of a spline next to a line; on XY the world x, y serve as px.
  const zigzag: SketchDrawing = {
    plane: XY,
    curves: [
      { kind: 'line', id: 'l1', from: [0, 50], to: [100, 50], style: 'normal' },
      {
        kind: 'polyline',
        id: 's1',
        points: [
          [0, 0],
          [20, 20],
          [40, 0],
          [60, 20],
        ],
        style: 'normal',
      },
    ],
    points: [],
  };

  /** The id of the curve picked at (x, y), via the tessellation like the sketch layer. */
  function pickedId(x: number, y: number): string | null {
    const t = tessellateSketch(zigzag);
    const screen = new Float32Array((t.segments.length / 6) * 4);
    for (let s = 0; s < t.segments.length / 6; s++) {
      screen[4 * s] = t.segments[6 * s] ?? NaN;
      screen[4 * s + 1] = t.segments[6 * s + 1] ?? NaN;
      screen[4 * s + 2] = t.segments[6 * s + 3] ?? NaN;
      screen[4 * s + 3] = t.segments[6 * s + 4] ?? NaN;
    }
    const hit = pickSketch(screen, f(), x, y);
    return hit?.kind === 'segment' ? (t.segmentCurves[hit.index] ?? null) : null;
  }

  it('gives the id of the spline on a segment', () => {
    expect(pickedId(30, 11)).toBe('s1');
  });

  it('gives the id of the spline at a point between two segments', () => {
    expect(pickedId(20, 22)).toBe('s1');
    expect(pickedId(40, -2)).toBe('s1');
  });

  it('gives nothing away from the polyline', () => {
    expect(pickedId(20, 35)).toBeNull();
  });
});
