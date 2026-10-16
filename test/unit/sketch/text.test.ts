import { describe, expect, it } from 'vitest';
import { bspline } from '@/core';
import type { Vec2 } from '@/core';
import type { Curve2 } from '@/sketch/geometry';
import type { TextContour } from '@/sketch/model';
import { derivedOwner, textCurves } from '@/sketch/text';
import { textData } from '@/sketch/testing';

const close = (a: Vec2, b: Vec2) => {
  expect(a[0]).toBeCloseTo(b[0], 12);
  expect(a[1]).toBeCloseTo(b[1], 12);
};

/** A unit square loop of character 0 ('a') from [0, 0], lines only. */
const SQUARE: TextContour = {
  char: 0,
  code: 97,
  segments: [
    [
      [0, 0],
      [1, 0],
    ],
    [
      [1, 0],
      [1, 1],
    ],
    [
      [1, 1],
      [0, 1],
    ],
    [
      [0, 1],
      [0, 0],
    ],
  ],
};

const QUAD: readonly Vec2[] = [
  [0, 0],
  [1, 2],
  [2, 0],
];
const CUBIC: readonly Vec2[] = [
  [2, 0],
  [2, -1],
  [0.5, -3],
  [0, 0],
];
/** One loop of a quadratic and a cubic Bézier segment. */
const CURVED: TextContour = { char: 0, code: 97, segments: [QUAD, CUBIC] };

function line(c: Curve2 | undefined): { from: Vec2; to: Vec2 } {
  if (c?.kind !== 'line') throw new Error(`not a line: ${JSON.stringify(c)}`);
  return { from: c.from, to: c.to };
}

/** A point of a Bézier curve by de Casteljau. */
function casteljau(poles: readonly Vec2[], t: number): Vec2 {
  let ps = poles;
  while (ps.length > 1) {
    ps = ps.slice(1).map((p, i): Vec2 => {
      const q = ps[i] ?? p;
      return [q[0] + t * (p[0] - q[0]), q[1] + t * (p[1] - q[1])];
    });
  }
  return ps[0] ?? [Number.NaN, Number.NaN];
}

describe('textCurves', () => {
  it('places the outlines at p1 of the baseline along a horizontal baseline', () => {
    const data = textData({ text: 'a', contours: [SQUARE], p1: [5, 7], p2: [20, 7] });
    const curves = textCurves(data);
    expect(curves.map((c) => c.kind)).toEqual(['line', 'line', 'line', 'line']);
    expect(line(curves[0])).toEqual({ from: [5, 7], to: [6, 7] });
    expect(line(curves[1])).toEqual({ from: [6, 7], to: [6, 8] });
  });

  it('turns the outlines with the baseline: x along p1 → p2, y to the left', () => {
    // Baseline up the y axis: local x → +y, local y → −x.
    const data = textData({ text: 'a', contours: [SQUARE], p1: [1, 1], p2: [1, 4] });
    const [first, second] = textCurves(data);
    close(line(first).from, [1, 1]);
    close(line(first).to, [1, 2]);
    close(line(second).to, [0, 2]);
  });

  it('turns by an oblique baseline; its length does not matter', () => {
    const a = 0.3;
    const at = (x: number, y: number): Vec2 => [
      2 + x * Math.cos(a) - y * Math.sin(a),
      -1 + x * Math.sin(a) + y * Math.cos(a),
    ];
    for (const length of [0.001, 50]) {
      const data = textData({
        text: 'a',
        contours: [SQUARE],
        p1: [2, -1],
        p2: [2 + length * Math.cos(a), -1 + length * Math.sin(a)],
      });
      const curves = textCurves(data);
      close(line(curves[1]).from, at(1, 0));
      close(line(curves[2]).from, at(1, 1));
    }
  });

  it('gives no curves for a zero-length baseline', () => {
    const data = textData({ text: 'a', contours: [SQUARE], p1: [3, 3], p2: [3, 3] });
    expect(textCurves(data)).toEqual([]);
  });

  it('turns quadratic and cubic Bézier segments into exact clamped B-splines', () => {
    const data = textData({ text: 'a', contours: [CURVED], p1: [10, 0], p2: [10, 10] });
    const [quad, cubic] = textCurves(data);
    if (quad?.kind !== 'bspline' || cubic?.kind !== 'bspline') throw new Error('not splines');
    expect(quad.degree).toBe(2);
    expect(quad.knots).toEqual([0, 0, 0, 1, 1, 1]);
    expect(cubic.degree).toBe(3);
    expect(cubic.knots).toEqual([0, 0, 0, 0, 1, 1, 1, 1]);
    // Baseline up: local [x, y] → [10 − y, x].
    const place = ([x, y]: Vec2): Vec2 => [10 - y, x];
    expect(quad.poles).toHaveLength(3);
    for (const [curve, poles] of [
      [quad, QUAD],
      [cubic, CUBIC],
    ] as const) {
      close(bspline.evaluate(curve, 0.5), place(casteljau(poles, 0.5)));
      close(bspline.evaluate(curve, 0.25), place(casteljau(poles, 0.25)));
    }
  });

  it('gives derived ids <text>:<char>-<code>.<loop>.<segment>', () => {
    // Fake outlines: 'a' and 'c' one square each, the space none.
    const data = textData({ id: 'tx', text: 'a c' });
    expect(textCurves(data).map((c) => c.id)).toEqual([
      'tx:0-97.0.0',
      'tx:0-97.0.1',
      'tx:0-97.0.2',
      'tx:0-97.0.3',
      'tx:2-99.0.0',
      'tx:2-99.0.1',
      'tx:2-99.0.2',
      'tx:2-99.0.3',
    ]);
  });

  it('numbers the loops within one character', () => {
    const second = { ...SQUARE, segments: SQUARE.segments.slice(0) };
    const b: TextContour = { ...SQUARE, char: 1, code: 98 };
    const data = textData({ text: 'ab', contours: [SQUARE, b, second] });
    const ids = textCurves(data).map((c) => c.id);
    expect(ids.filter((id) => id?.endsWith('.0'))).toEqual([
      't:0-97.0.0',
      't:1-98.0.0',
      't:0-97.1.0',
    ]);
  });

  it('keeps the ids of other characters when one character changes', () => {
    const ids = (text: string) => new Set(textCurves(textData({ text })).map((c) => c.id));
    const before = ids('abc');
    const after = ids('axc');
    expect([...before].filter((id) => after.has(id))).toEqual([
      't:0-97.0.0',
      't:0-97.0.1',
      't:0-97.0.2',
      't:0-97.0.3',
      't:2-99.0.0',
      't:2-99.0.1',
      't:2-99.0.2',
      't:2-99.0.3',
    ]);
  });

  it('keeps the ids when the baseline moves or turns', () => {
    const ids = (p2: Vec2) => textCurves(textData({ p1: [1, 2], p2 })).map((c) => c.id);
    expect(ids([5, 9])).toEqual(ids([11, 2]));
  });

  it('includes construction texts and all texts in entity order', () => {
    const one = textData({ id: 'u', text: 'a', construction: true });
    const two = textData({ id: 'v', text: 'b' });
    const data = { entities: [...one.entities, ...two.entities], constraints: [] };
    expect(textCurves(data).map((c) => c.id?.split('.')[0])).toEqual([
      'u:0-97',
      'u:0-97',
      'u:0-97',
      'u:0-97',
      'v:0-98',
      'v:0-98',
      'v:0-98',
      'v:0-98',
    ]);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(textCurves(textData()))).toBe(true);
  });
});

describe('derivedOwner', () => {
  it('returns the text of a letter curve', () => {
    expect(derivedOwner('t:0-97.0.0')).toBe('t');
    expect(derivedOwner('Ab3:12-353.2.17')).toBe('Ab3');
  });

  it('accepts the letter grammar, a subset of the copy grammar', () => {
    // '<id>:<i>-<j>.<rest>' is also a copy of a two-direction pattern; the owner is the same prefix.
    expect(derivedOwner('t:0-97.0')).toBe('t');
  });

  it('returns the pattern of a copy', () => {
    expect(derivedOwner('m:1.ab')).toBe('m');
    expect(derivedOwner('lp:1-0.a')).toBe('lp');
  });

  it.each(['ab', ':0-97.0.0', 't:a-97.0.0', 't,u:0-97.0.0', '__poles:ab', 't:0-97.0.0:1'])(
    'returns null for %s',
    (id) => {
      expect(derivedOwner(id)).toBeNull();
    },
  );
});
