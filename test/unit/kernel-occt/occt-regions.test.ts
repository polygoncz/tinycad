import { beforeAll, describe, expect, it } from 'vitest';
import { bspline, type Vec2 } from '@/core';
import type { ProfileCurve, ProfileLoop, ProfileRegions } from '@/kernel';
import { loadOcct, type Occt } from '@/kernel-occt/occt';
import { OcctKernelImpl } from '@/kernel-occt/occt-kernel-impl';

// What the OCCT regions (spec 06 "Stav po M30", M30 task 2) do beyond the contract suite: exact
// areas (Green's theorem over the OCCT curves, not a tessellation), the cases where a planar
// splitter would differ from the contract (a pinched loop, a dangling line inside), a spline
// crossing itself, and the speed of the pairwise intersections with the bounding box filter.

let oc: Occt;

beforeAll(async () => {
  oc = await loadOcct();
});

type Spline = Extract<ProfileCurve, { kind: 'bspline' }>;

const line = (id: string, from: Vec2, to: Vec2): ProfileCurve => ({ kind: 'line', id, from, to });

function rect(prefix: string, x0: number, y0: number, x1: number, y1: number): ProfileCurve[] {
  return [
    line(`${prefix}1`, [x0, y0], [x1, y0]),
    line(`${prefix}2`, [x1, y0], [x1, y1]),
    line(`${prefix}3`, [x1, y1], [x0, y1]),
    line(`${prefix}4`, [x0, y1], [x0, y0]),
  ];
}

/** A cubic spline from (4, 3) to (0, 3) waving above and below y = 3 (the top of a 4 × 3 box). */
const WAVE: Spline = {
  kind: 'bspline',
  id: 'w',
  degree: 3,
  poles: [
    [4, 3],
    [3, 5],
    [2, 1.5],
    [1, 4.5],
    [0, 3],
  ],
  knots: [0, 0, 0, 0, 0.4, 1, 1, 1, 1],
};

function regionsOf(curves: readonly ProfileCurve[]): Promise<ProfileRegions> {
  return new OcctKernelImpl(oc).profileRegions({ curves });
}

function holeNames(loops: readonly ProfileLoop[]): string[] {
  return loops.map((l) => [...new Set(l.map((c) => c.id ?? ''))].sort().join(','));
}

/** Area of a polygon of points and splines, the splines tessellated very finely. */
function areaWith(...parts: readonly (Vec2 | Spline)[]): number {
  const points = parts.flatMap((p) =>
    'kind' in p ? bspline.tessellate(p, 1e-9).slice(0, -1) : [p],
  );
  let sum = 0;
  points.forEach((p, i) => {
    const q = points[(i + 1) % points.length] ?? p;
    sum += p[0] * q[1] - q[0] * p[1];
  });
  return sum / 2;
}

function expectArea(actual: number | undefined, expected: number, relative = 1e-9): void {
  expect(Math.abs((actual ?? Number.NaN) - expected)).toBeLessThanOrEqual(
    relative * Math.abs(expected),
  );
}

describe('OCCT profileRegions', () => {
  it('a rectangle with a circular hole: the disc and the ring with exact areas', async () => {
    const result = await regionsOf([
      ...rect('r', 0, 0, 10, 6),
      { kind: 'circle', id: 'c', center: [5, 3], radius: 1.5 },
    ]);
    expect(result.crossing).toBe(false);
    expect(result.regions.map((r) => r.name)).toEqual(['c', 'c,r1,r2,r3,r4']);
    const [disc, ring] = result.regions;
    expectArea(disc?.area, Math.PI * 2.25);
    expectArea(ring?.area, 60 - Math.PI * 2.25);
    expect(holeNames(ring?.holes ?? [])).toEqual(['c']);
    expect(disc?.holes).toEqual([]);
  });

  it('two regions sharing an edge: the shared line bounds both', async () => {
    const result = await regionsOf([
      line('a1', [0, 0], [5, 0]),
      line('a2', [5, 0], [10, 0]),
      line('rt', [10, 0], [10, 5]),
      line('b2', [10, 5], [5, 5]),
      line('b1', [5, 5], [0, 5]),
      line('lf', [0, 5], [0, 0]),
      line('m', [5, 5], [5, 0]),
    ]);
    expect(result.regions.map((r) => r.name)).toEqual(['a1,b1,lf,m', 'a2,b2,m,rt']);
    for (const r of result.regions) expectArea(r.area, 25);
    // The shared line runs in opposite directions in the two loops.
    const [left, right] = result.regions.map((r) => r.outer.find((c) => c.id === 'm'));
    expect(left).toEqual(line('m', [5, 0], [5, 5]));
    expect(right).toEqual(line('m', [5, 5], [5, 0]));
  });

  it('a spline as a side: its exact area and the input spline in the loop', async () => {
    const curves = [
      line('s1', [0, 0], [4, 0]),
      line('s2', [4, 0], [4, 3]),
      WAVE,
      line('s4', [0, 3], [0, 0]),
    ];
    const result = await regionsOf(curves);
    expect(result.regions.map((r) => r.name)).toEqual(['s1,s2,s4,w']);
    expectArea(result.regions[0]?.area, areaWith([0, 0], [4, 0], WAVE, [0, 3]), 1e-8);
    // Counter-clockwise the wave runs as drawn (4, 3) → (0, 3): the same poles and knots.
    expect(result.regions[0]?.outer.find((c) => c.id === 'w')).toEqual(WAVE);
  });

  it('a clockwise arc is the same arc; the loop holds it counter-clockwise', async () => {
    const result = await regionsOf([
      line('d1', [-2, -1], [0, -1]),
      { kind: 'arc', id: 'da', center: [0, 0], from: [0, 1], to: [0, -1], ccw: false },
      line('d3', [0, 1], [-2, 1]),
      line('d4', [-2, 1], [-2, -1]),
    ]);
    expect(result.regions.map((r) => r.name)).toEqual(['d1,d3,d4,da']);
    expectArea(result.regions[0]?.area, 4 + Math.PI / 2);
    expect(result.regions[0]?.outer.find((c) => c.id === 'da')).toEqual({
      kind: 'arc',
      id: 'da',
      center: [0, 0],
      from: [0, -1],
      to: [0, 1],
      ccw: true,
    });
  });

  it.each([
    ['two crossing lines', [...rect('r', 0, 0, 10, 6), line('x', [2, -1], [2, 7])]],
    ['an end on the inside of a line', [...rect('r', 0, 0, 10, 6), line('t', [5, 3], [5, 6])]],
    [
      'a spline crossing itself',
      [
        {
          kind: 'bspline',
          id: 'sp',
          degree: 3,
          poles: [
            [0, 0],
            [10, 6],
            [-4, 6],
            [6, 0],
          ],
          knots: [0, 0, 0, 0, 1, 1, 1, 1],
        },
        line('base', [6, 0], [0, 0]),
      ],
    ],
    [
      'an end on the inside of a spline',
      [
        line('s1', [0, 0], [4, 0]),
        line('s2', [4, 0], [4, 3]),
        {
          kind: 'bspline',
          id: 'w',
          degree: 1,
          poles: [
            [4, 3],
            [2, 5],
            [0, 3],
          ],
          knots: [0, 0, 0.5, 1, 1],
        },
        line('s4', [0, 3], [0, 0]),
        line('t', [1, 1], [1, 4]),
      ],
    ],
    [
      'a circle tangent to a side from inside',
      [...rect('r', 0, 0, 10, 6), { kind: 'circle', id: 'c', center: [5, 3], radius: 3 }],
    ],
  ] satisfies [string, ProfileCurve[]][])('%s: a crossing, no regions', async (_, curves) => {
    expect(await regionsOf(curves)).toEqual({ regions: [], crossing: true });
  });

  it('a triangle touching the rectangle only in a corner: one loop, no hole', async () => {
    const result = await regionsOf([
      ...rect('o', 0, 0, 10, 10),
      line('t1', [0, 0], [3, 1]),
      line('t2', [3, 1], [1, 3]),
      line('t3', [1, 3], [0, 0]),
    ]);
    expect(result.regions.map((r) => r.name)).toEqual(['o1,o2,o3,o4,t1,t2,t3', 't1,t2,t3']);
    const [outer, triangle] = result.regions;
    expect(outer?.holes).toEqual([]);
    expect(outer?.outer).toHaveLength(7);
    expectArea(outer?.area, 96);
    expectArea(triangle?.area, 4);
  });

  it('a line hanging into the rectangle from a corner bounds nothing', async () => {
    const result = await regionsOf([
      ...rect('r', 0, 0, 10, 6),
      line('in', [0, 0], [3, 2]),
      line('out', [10, 6], [13, 8]),
    ]);
    expect(result.regions.map((r) => r.name)).toEqual(['r1,r2,r3,r4']);
    expect(result.regions[0]?.holes).toEqual([]);
    expect(result.regions[0]?.outer).toHaveLength(4);
    expectArea(result.regions[0]?.area, 60);
  });

  it('a hole whose containment ray would pass through a corner of the outer loop', async () => {
    // The sample point of the inner square is its corner (1, 1); the outer diamond's corners lie
    // on many directions from it. Whatever ray is chosen, the square must be a hole.
    const diamond = [
      line('d1', [5, -5], [15, 5]),
      line('d2', [15, 5], [5, 15]),
      line('d3', [5, 15], [-5, 5]),
      line('d4', [-5, 5], [5, -5]),
    ];
    const result = await regionsOf([...diamond, ...rect('s', 1, 1, 3, 3)]);
    expect(result.regions.map((r) => r.name)).toEqual(['d1,d2,d3,d4,s1,s2,s3,s4', 's1,s2,s3,s4']);
    expect(holeNames(result.regions[0]?.holes ?? [])).toEqual(['s1,s2,s3,s4']);
    expectArea(result.regions[0]?.area, 200 - 4);
  });

  it('a grid of 840 lines takes well under a second', async () => {
    const n = 20;
    const curves: ProfileCurve[] = [];
    for (let i = 0; i <= n; i++) {
      for (let j = 0; j < n; j++) {
        curves.push(line(`h${String(i)}_${String(j)}`, [j, i], [j + 1, i]));
        curves.push(line(`v${String(i)}_${String(j)}`, [i, j], [i, j + 1]));
      }
    }
    const kernel = new OcctKernelImpl(oc);
    await kernel.profileRegions({ curves: rect('w', 0, 0, 1, 1) }); // warm-up
    const start = performance.now();
    const result = await kernel.profileRegions({ curves });
    const elapsed = performance.now() - start;
    expect(result.crossing).toBe(false);
    expect(result.regions).toHaveLength(n * n);
    expect(elapsed).toBeLessThan(1000);
  });
});
