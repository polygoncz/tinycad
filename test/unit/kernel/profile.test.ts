import { describe, expect, it } from 'vitest';
import type { Plane, Vec2 } from '@/core';
import {
  parseFaceInput,
  validateFaceInput,
  type ProfileCurve,
  type ProfileLoop,
} from '@/kernel/profile';

const XY: Plane = { origin: [0, 0, 0], xDir: [1, 0, 0], normal: [0, 0, 1] };

const line = (from: Vec2, to: Vec2): ProfileCurve => ({ kind: 'line', from, to });

/** Closed polygon through the points. */
function polygon(...points: Vec2[]): ProfileLoop {
  return points.map((p, i) => line(p, points[(i + 1) % points.length] ?? p));
}

const SQUARE = polygon([0, 0], [4, 0], [4, 4], [0, 4]);
const HOLE: ProfileLoop = [{ kind: 'circle', center: [2, 2], radius: 1 }];
/** Line (0, −1)–(0, 1) and a half circle back through (−1, 0) or (1, 0). */
const D = (ccw: boolean): ProfileLoop => [
  line([0, -1], [0, 1]),
  { kind: 'arc', center: [0, 0], from: [0, 1], to: [0, -1], ccw },
];

/** Quadratic spline from (4, 3) over (2, 5) to (0, 3): the top of SPLINE_LOOP. */
const SPLINE = {
  kind: 'bspline',
  degree: 2,
  poles: [
    [4, 3],
    [2, 5],
    [0, 3],
  ],
  knots: [0, 0, 0, 1, 1, 1],
} as const satisfies ProfileCurve;

/** A rectangle [0, 4]×[0, 3] whose top side is SPLINE, with the spline replaced by `spline`. */
function splineLoop(spline: Record<string, unknown> = SPLINE): unknown[] {
  return [line([0, 0], [4, 0]), line([4, 0], [4, 3]), spline, line([0, 3], [0, 0])];
}

/** A cubic spline side from (4, 3) to (0, 3) with 7 poles (3 interior knots) and the given knots. */
function cubicSide(knots: readonly number[]): Record<string, unknown> {
  const poles: Vec2[] = [
    [4, 3],
    [3.5, 4],
    [3, 2],
    [2, 4],
    [1, 2],
    [0.5, 4],
    [0, 3],
  ];
  return { kind: 'bspline', degree: 3, poles, knots };
}

function face(change: Record<string, unknown> = {}): Record<string, unknown> {
  return { plane: XY, outer: SQUARE, holes: [], ...change };
}

describe('validateFaceInput', () => {
  it.each([
    ['a square', face()],
    ['a square with a circular hole', face({ holes: [HOLE] })],
    [
      'a square with two holes',
      face({ holes: [HOLE, polygon([0.2, 0.2], [0.8, 0.2], [0.8, 0.8])] }),
    ],
    ['a single circle', face({ outer: [{ kind: 'circle', center: [1, 2], radius: 0.5 }] })],
    ['a D, ccw', face({ outer: D(true) })],
    ['a D, clockwise', face({ outer: D(false) })],
    ['a loop in reverse orientation', face({ outer: polygon([0, 0], [0, 4], [4, 4], [4, 0]) })],
    [
      'a gap within 1e-7',
      face({ outer: [line([0, 0], [1, 0]), line([1, 5e-8], [0, 1]), line([0, 1], [0, 0])] }),
    ],
    [
      'a gap within 1e-7 · |coordinate| far from the origin',
      face({
        outer: [
          line([1e5, 0], [1e5 + 1, 0]),
          line([1e5 + 1 + 5e-3, 0], [1e5, 1]),
          line([1e5, 1], [1e5, 0]),
        ],
      }),
    ],
    [
      'a plane off the origin, not axis-aligned',
      face({
        plane: { origin: [1, 2, 3], xDir: [Math.SQRT1_2, Math.SQRT1_2, 0], normal: [0, 0, 1] },
      }),
    ],
    ['a rectangle with a spline side (M29)', face({ outer: splineLoop() })],
    [
      'a cubic spline side with an interior knot (M29)',
      face({
        outer: splineLoop({
          kind: 'bspline',
          degree: 3,
          poles: [
            [4, 3],
            [3, 4],
            [2, 2],
            [1, 4],
            [0, 3],
          ],
          knots: [0, 0, 0, 0, 0.4, 1, 1, 1, 1],
        }),
      }),
    ],
    [
      'a closed spline alone (M29)',
      face({
        outer: [
          {
            kind: 'bspline',
            degree: 2,
            poles: [
              [0, 0],
              [4, 0],
              [4, 4],
              [0, 0],
            ],
            knots: [0, 0, 0, 0.5, 1, 1, 1],
          },
        ],
      }),
    ],
    [
      'a spline hole (M29)',
      face({ outer: polygon([-1, -1], [5, -1], [5, 6], [-1, 6]), holes: [splineLoop()] }),
    ],
    [
      'knots clamped on [2, 7] with a double interior knot (M29)',
      face({ outer: splineLoop(cubicSide([2, 2, 2, 2, 3, 3, 5, 7, 7, 7, 7])) }),
    ],
    [
      'an interior knot repeated degree times (M29)',
      face({ outer: splineLoop(cubicSide([0, 0, 0, 0, 0.5, 0.5, 0.5, 1, 1, 1, 1])) }),
    ],
  ])('%s is valid', (_, p) => {
    expect(validateFaceInput(p)).toEqual([]);
  });

  it.each([
    ['null', null],
    ['a number', 42],
    ['no plane', face({ plane: undefined })],
    ['plane origin of 2 numbers', face({ plane: { ...XY, origin: [0, 0] } })],
    ['plane origin NaN', face({ plane: { ...XY, origin: [0, Number.NaN, 0] } })],
    ['plane origin Infinity', face({ plane: { ...XY, origin: [0, 0, Infinity] } })],
    ['plane xDir not unit', face({ plane: { ...XY, xDir: [2, 0, 0] } })],
    ['plane normal not unit', face({ plane: { ...XY, normal: [0, 0, 0.5] } })],
    [
      'plane axes not perpendicular',
      face({ plane: { ...XY, normal: [Math.SQRT1_2, 0, Math.SQRT1_2] } }),
    ],
    ['outer not an array', face({ outer: 'square' })],
    ['outer empty', face({ outer: [] })],
    ['holes not an array', face({ holes: undefined })],
    ['an empty hole', face({ holes: [[]] })],
    ['a curve that is not an object', face({ outer: [...SQUARE.slice(0, 3), null] })],
    ['an unknown curve kind', face({ outer: [{ kind: 'spline', from: [0, 0], to: [1, 1] }] })],
    [
      'a line point of 3 numbers',
      face({ outer: [{ kind: 'line', from: [0, 0], to: [4, 0, 0] }, ...SQUARE.slice(1)] }),
    ],
    ['a line point NaN', face({ outer: polygon([0, 0], [4, Number.NaN], [4, 4]) })],
    ['a circle of radius 0', face({ outer: [{ kind: 'circle', center: [0, 0], radius: 0 }] })],
    [
      'a circle of negative radius',
      face({ outer: [{ kind: 'circle', center: [0, 0], radius: -1 }] }),
    ],
    [
      'a circle of radius NaN',
      face({ outer: [{ kind: 'circle', center: [0, 0], radius: Number.NaN }] }),
    ],
    [
      'a circle of radius Infinity',
      face({ outer: [{ kind: 'circle', center: [0, 0], radius: Infinity }] }),
    ],
    [
      'a circle with an invalid center',
      face({ outer: [{ kind: 'circle', center: [0], radius: 1 }] }),
    ],
    ['a circle inside a loop of several curves', face({ outer: [...SQUARE, HOLE[0]] })],
    ['two circles in one loop', face({ outer: [HOLE[0], HOLE[0]] })],
    ['an open loop', face({ outer: SQUARE.slice(0, 3) })],
    [
      'a gap between two curves',
      face({ outer: [line([0, 0], [1, 0]), line([1, 1e-6], [0, 1]), line([0, 1], [0, 0])] }),
    ],
    [
      'a gap beyond 1e-7 · |coordinate|',
      face({
        outer: [
          line([1e5, 0], [1e5 + 1, 0]),
          line([1e5 + 1 + 2e-2, 0], [1e5, 1]),
          line([1e5, 1], [1e5, 0]),
        ],
      }),
    ],
    ['a single line', face({ outer: [line([0, 0], [1, 0])] })],
    ['a line of zero length', face({ outer: [...SQUARE, line([0, 0], [0, 0])] })],
    [
      'an arc of zero length',
      face({
        outer: [...SQUARE, { kind: 'arc', center: [1, 1], from: [0, 0], to: [0, 0], ccw: true }],
      }),
    ],
    [
      'an arc with unequal radii',
      face({
        outer: [
          line([0, -1], [0, 1.1]),
          { kind: 'arc', center: [0, 0], from: [0, 1.1], to: [0, -1], ccw: true },
        ],
      }),
    ],
    [
      'an arc with ccw not a boolean',
      face({
        outer: [
          line([0, -1], [0, 1]),
          { kind: 'arc', center: [0, 0], from: [0, 1], to: [0, -1], ccw: 'yes' },
        ],
      }),
    ],
    [
      'an arc of radius 1e-10',
      face({
        outer: [
          line([0, -1e-10], [0, 1e-10]),
          { kind: 'arc', center: [0, 0], from: [0, 1e-10], to: [0, -1e-10], ccw: true },
        ],
      }),
    ],
    ['an invalid hole', face({ holes: [[{ kind: 'circle', center: [2, 2], radius: 0 }]] })],
    ['a spline of degree 0', face({ outer: splineLoop({ ...SPLINE, degree: 0 }) })],
    ['a spline of degree 1.5', face({ outer: splineLoop({ ...SPLINE, degree: 1.5 }) })],
    ['a spline of degree NaN', face({ outer: splineLoop({ ...SPLINE, degree: Number.NaN }) })],
    ['a spline of degree "2"', face({ outer: splineLoop({ ...SPLINE, degree: '2' }) })],
    ['a spline without poles', face({ outer: splineLoop({ ...SPLINE, poles: undefined }) })],
    [
      'a spline with too few poles for its degree',
      face({
        outer: splineLoop({
          ...SPLINE,
          poles: [
            [4, 3],
            [0, 3],
          ],
          knots: [0, 0, 0, 1, 1],
        }),
      }),
    ],
    [
      'a spline pole of 3 numbers',
      face({
        outer: splineLoop({
          ...SPLINE,
          poles: [
            [4, 3],
            [2, 5, 0],
            [0, 3],
          ],
        }),
      }),
    ],
    [
      'a spline pole Infinity',
      face({
        outer: splineLoop({
          ...SPLINE,
          poles: [
            [4, 3],
            [2, Infinity],
            [0, 3],
          ],
        }),
      }),
    ],
    [
      'spline knots of the wrong length',
      face({ outer: splineLoop({ ...SPLINE, knots: [0, 0, 0, 1, 1] }) }),
    ],
    [
      'a spline knot NaN',
      face({ outer: splineLoop({ ...SPLINE, knots: [0, 0, 0, Number.NaN, 1, 1] }) }),
    ],
    ['spline knots not an array', face({ outer: splineLoop({ ...SPLINE, knots: 'clamped' }) })],
    [
      'decreasing spline knots',
      face({ outer: splineLoop({ ...SPLINE, knots: [0, 0, 0, 1, 0.5, 1] }) }),
    ],
    [
      'a spline whose first pole is off the end of the previous curve',
      face({
        outer: splineLoop({
          ...SPLINE,
          poles: [
            [4, 3.1],
            [2, 5],
            [0, 3],
          ],
        }),
      }),
    ],
    [
      'a spline whose last pole is off the start of the next curve',
      face({
        outer: splineLoop({
          ...SPLINE,
          poles: [
            [4, 3],
            [2, 5],
            [0.1, 3],
          ],
        }),
      }),
    ],
    ['an open spline alone', face({ outer: [{ ...SPLINE }] })],
    [
      'a spline of degree 26',
      face({
        outer: splineLoop({
          ...SPLINE,
          degree: 26,
          poles: Array.from({ length: 27 }, (_, i): Vec2 => [
            4 - (4 * i) / 26,
            i === 0 || i === 26 ? 3 : 4,
          ]),
          knots: [...Array<number>(27).fill(0), ...Array<number>(27).fill(1)],
        }),
      }),
    ],
    [
      'knots not clamped at the start',
      face({ outer: splineLoop(cubicSide([0, 0, 0, 0.1, 0.3, 0.5, 0.7, 1, 1, 1, 1])) }),
    ],
    [
      'knots not clamped at the end',
      face({ outer: splineLoop(cubicSide([0, 0, 0, 0, 0.3, 0.5, 0.7, 0.9, 1, 1, 1])) }),
    ],
    ['all knots equal', face({ outer: splineLoop(cubicSide([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1])) })],
    [
      'the first knot larger than the last',
      face({ outer: splineLoop(cubicSide([1, 1, 1, 1, 0.7, 0.5, 0.3, 0, 0, 0, 0])) }),
    ],
    [
      'an interior knot equal to the first',
      face({ outer: splineLoop(cubicSide([0, 0, 0, 0, 0, 0.5, 0.7, 1, 1, 1, 1])) }),
    ],
    [
      'an interior knot equal to the last',
      face({ outer: splineLoop(cubicSide([0, 0, 0, 0, 0.3, 0.5, 1, 1, 1, 1, 1])) }),
    ],
    [
      'an interior knot outside the range',
      face({ outer: splineLoop(cubicSide([0, 0, 0, 0, 0.3, 1.5, 0.7, 1, 1, 1, 1])) }),
    ],
    [
      'decreasing interior knots',
      face({ outer: splineLoop(cubicSide([0, 0, 0, 0, 0.7, 0.5, 0.3, 1, 1, 1, 1])) }),
    ],
    [
      'an interior knot repeated more than degree times',
      face({
        outer: splineLoop({
          ...cubicSide([]),
          poles: [
            [4, 3],
            [3.5, 4],
            [3, 2],
            [2, 4],
            [1.5, 2],
            [1, 2],
            [0.5, 4],
            [0, 3],
          ],
          knots: [0, 0, 0, 0, 0.5, 0.5, 0.5, 0.5, 1, 1, 1, 1],
        }),
      }),
    ],
  ])('%s is invalid', (_, p) => {
    expect(validateFaceInput(p)).not.toEqual([]);
  });

  it('names the knot problem of a spline (M29)', () => {
    const errors = validateFaceInput(
      face({ outer: splineLoop(cubicSide([0, 0, 0, 0, 0.7, 0.5, 0.3, 1, 1, 1, 1])) }),
    );
    expect(errors.join('\n')).toContain('outer[2]: knots must not decrease');
  });

  it('names where the problem is', () => {
    const errors = validateFaceInput(
      face({ holes: [HOLE, [{ kind: 'circle', center: [2, 2], radius: 0 }]] }),
    );
    expect(errors.join('\n')).toContain('holes[1]');
  });

  it('reports every invalid loop, not only the first', () => {
    const bad: ProfileLoop = [{ kind: 'circle', center: [0, 0], radius: 0 }];
    expect(validateFaceInput(face({ outer: bad, holes: [bad] })).length).toBeGreaterThanOrEqual(2);
  });

  it('does not throw on input outside the types', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic['self'] = cyclic;
    for (const p of [undefined, 'x', [], cyclic, { plane: XY, outer: [[]], holes: {} }]) {
      expect(() => validateFaceInput(p)).not.toThrow();
      expect(validateFaceInput(p)).not.toEqual([]);
    }
  });
});

describe('parseFaceInput: entity ids of the curves (M14)', () => {
  it('keeps the id of every kind of curve in the copy', () => {
    const outer: ProfileLoop = [
      { kind: 'line', from: [0, -1], to: [0, 1], id: 'l1' },
      { kind: 'arc', center: [0, 0], from: [0, 1], to: [0, -1], ccw: true, id: 'a1' },
    ];
    const hole: ProfileLoop = [{ kind: 'circle', center: [0.5, 0], radius: 0.1, id: 'c1' }];
    const parsed = parseFaceInput(face({ outer, holes: [hole] }));
    expect(parsed.ok && parsed.value.outer.map((c) => c.id)).toEqual(['l1', 'a1']);
    expect(parsed.ok && parsed.value.holes[0]?.[0]?.id).toBe('c1');
  });

  it('keeps the id of a spline and copies its arrays (M29)', () => {
    const spline = {
      ...SPLINE,
      poles: SPLINE.poles.map((v): number[] => [...v]),
      knots: [...SPLINE.knots] as number[], // widened from the literal types: the test mutates it
      id: 's1',
    };
    const parsed = parseFaceInput(face({ outer: splineLoop(spline) }));
    const copy = parsed.ok ? parsed.value.outer[2] : undefined;
    expect(copy).toEqual({ ...SPLINE, id: 's1' });
    spline.poles[1] = [9, 9];
    spline.knots[3] = 0.5;
    expect(copy).toEqual({ ...SPLINE, id: 's1' });
  });

  it('a curve without an id has no id property in the copy', () => {
    const parsed = parseFaceInput(face());
    expect(parsed.ok && parsed.value.outer.every((c) => !('id' in c))).toBe(true);
  });

  it.each([
    ['an empty string', ''],
    ['a number', 7],
    ['null', null],
  ])('an id that is %s is invalid', (_, id) => {
    const outer = [{ kind: 'circle', center: [0, 0], radius: 1, id }];
    const parsed = parseFaceInput(face({ outer }));
    expect(parsed.ok).toBe(false);
    expect(validateFaceInput(face({ outer })).join('\n')).toContain('outer[0]: id');
  });
});
