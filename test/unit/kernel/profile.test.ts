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
  ])('%s is invalid', (_, p) => {
    expect(validateFaceInput(p)).not.toEqual([]);
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
