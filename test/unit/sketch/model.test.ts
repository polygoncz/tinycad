import { describe, expect, it } from 'vitest';
import {
  MAX_PATTERN_COUNT,
  MAX_TEXT_LENGTH,
  TEXT_FONTS,
  circularStep,
  isLineCarrier,
  isPatternSource,
  patternParamsValid,
  textParamsValid,
} from '@/sketch/model';
import type {
  SketchCircularPattern,
  SketchData,
  SketchEntity,
  SketchEntityId,
  SketchLinearPattern,
  SketchMirror,
} from '@/sketch/model';
import { parseSketchData } from '@/sketch/parse';

function sketch(entities: readonly unknown[]): SketchData {
  const r = parseSketchData(entities, []);
  if (!r.ok) throw new Error(`invalid test sketch: ${JSON.stringify(r.error)}`);
  return r.value;
}

describe('isLineCarrier', () => {
  const DATA = sketch([
    { kind: 'point', id: 'a', x: 0, y: 0 },
    { kind: 'point', id: 'b', x: 10, y: 0 },
    { kind: 'point', id: 'c', x: 0, y: 10 },
    { kind: 'line', id: 'l', p1: 'a', p2: 'b' },
    { kind: 'xline', id: 'x', p1: 'a', p2: 'c', construction: true },
    { kind: 'circle', id: 'k', center: 'a', radius: 3 },
    { kind: 'arc', id: 'q', center: 'a', start: 'b', end: 'c' },
    { kind: 'bspline', id: 's', degree: 1, poles: ['a', 'b'], knots: [0, 0, 1, 1] },
  ]);

  it('is true for a line and an xline (M31), false for every other entity', () => {
    const carriers = DATA.entities.filter(isLineCarrier).map((e) => e.id);
    expect(carriers).toEqual(['l', 'x']);
  });
});

// The shared rules of mirrors and patterns (spec 12, "Zrcadlení a pole (M36)").

// Test ids are trusted.
const eid = (id: string): SketchEntityId => id as SketchEntityId;

const LINEAR: SketchLinearPattern = {
  kind: 'linearPattern',
  id: eid('lp'),
  sources: [eid('ab')],
  direction1: { angle: 0, count: 3, spacing: 5 },
};
const CIRCULAR: SketchCircularPattern = {
  kind: 'circularPattern',
  id: eid('cp'),
  sources: [eid('ab')],
  center: eid('o'),
  count: 4,
  angle: Math.PI,
};
const MIRROR: SketchMirror = {
  kind: 'mirror',
  id: eid('m'),
  sources: [eid('ab')],
  axis: eid('ou'),
};

describe('circularStep', () => {
  it('a full circle steps by angle / count, in both senses', () => {
    expect(circularStep({ count: 4, angle: 2 * Math.PI })).toBeCloseTo(Math.PI / 2, 12);
    expect(circularStep({ count: 4, angle: -2 * Math.PI })).toBeCloseTo(-Math.PI / 2, 12);
    expect(circularStep({ count: 3, angle: 2 * Math.PI + 1e-10 })).toBeCloseTo(
      (2 * Math.PI) / 3,
      9,
    );
  });

  it('a partial angle steps by angle / (count − 1)', () => {
    expect(circularStep({ count: 4, angle: Math.PI })).toBeCloseTo(Math.PI / 3, 12);
    expect(circularStep({ count: 2, angle: -1 })).toBe(-1);
  });
});

describe('patternParamsValid', () => {
  it('accepts valid parameters; a mirror has none', () => {
    expect(patternParamsValid(MIRROR)).toBe(true);
    expect(patternParamsValid(LINEAR)).toBe(true);
    expect(
      patternParamsValid({ ...LINEAR, direction2: { angle: -7, count: 2, spacing: 0.1 } }),
    ).toBe(true);
    expect(patternParamsValid({ ...CIRCULAR, count: MAX_PATTERN_COUNT })).toBe(true);
    expect(patternParamsValid({ ...CIRCULAR, angle: -2 * Math.PI - 1e-10 })).toBe(true);
  });

  it('rejects a bad count, spacing or angle in either direction', () => {
    const d = LINEAR.direction1;
    const bad = [
      { ...d, count: 1 },
      { ...d, count: 2.5 },
      { ...d, count: MAX_PATTERN_COUNT + 1 },
      { ...d, spacing: 0 },
      { ...d, spacing: -1 },
      { ...d, spacing: Number.POSITIVE_INFINITY },
      { ...d, angle: Number.NaN },
    ];
    for (const direction of bad) {
      expect(patternParamsValid({ ...LINEAR, direction1: direction })).toBe(false);
      expect(patternParamsValid({ ...LINEAR, direction2: direction })).toBe(false);
    }
  });

  it('rejects a circular count or angle out of range', () => {
    for (const count of [1, 3.5, MAX_PATTERN_COUNT + 1]) {
      expect(patternParamsValid({ ...CIRCULAR, count })).toBe(false);
    }
    for (const angle of [0, 2 * Math.PI + 1e-6, Number.NaN, Number.NEGATIVE_INFINITY]) {
      expect(patternParamsValid({ ...CIRCULAR, angle })).toBe(false);
    }
  });
});

describe('isPatternSource', () => {
  it('a point or a curve is a source, a mirror, pattern or text is not', () => {
    const entities: readonly [SketchEntity, boolean][] = [
      [{ kind: 'point', id: eid('a'), x: 0, y: 0 }, true],
      [{ kind: 'line', id: eid('ab'), p1: eid('a'), p2: eid('b') }, true],
      [{ kind: 'circle', id: eid('c'), center: eid('a'), radius: 1 }, true],
      [{ kind: 'arc', id: eid('r'), center: eid('a'), start: eid('b'), end: eid('d') }, true],
      [
        {
          kind: 'bspline',
          id: eid('s'),
          degree: 1,
          poles: [eid('a'), eid('b')],
          knots: [0, 0, 1, 1],
        },
        true,
      ],
      [
        {
          kind: 'fitSpline',
          id: eid('f'),
          degree: 1,
          fit: [eid('a'), eid('b')],
          params: [0, 1],
          poles: [
            [0, 0],
            [1, 0],
          ],
          knots: [0, 0, 1, 1],
        },
        true,
      ],
      [MIRROR, false],
      [LINEAR, false],
      [CIRCULAR, false],
      [
        {
          kind: 'text',
          id: eid('t'),
          text: 'a',
          font: 'sans',
          height: 1,
          baseline: eid('ab'),
          contours: [],
        },
        false,
      ],
    ];
    for (const [entity, source] of entities)
      expect(isPatternSource(entity), entity.kind).toBe(source);
  });
});

describe('TEXT_FONTS', () => {
  it('lists the bundled fonts in panel order and is frozen', () => {
    expect(TEXT_FONTS).toEqual(['sans', 'serif', 'mono']);
    expect(Object.isFrozen(TEXT_FONTS)).toBe(true);
  });
});

describe('MAX_TEXT_LENGTH', () => {
  it('is 200 code points', () => {
    expect(MAX_TEXT_LENGTH).toBe(200);
  });
});

describe('textParamsValid (M37)', () => {
  const OK = { text: 'Text', font: 'sans', height: 10 } as const;

  it('accepts a one-line string, a known font and a positive height', () => {
    expect(textParamsValid(OK)).toBe(true);
    expect(textParamsValid({ ...OK, text: '😀'.repeat(MAX_TEXT_LENGTH), font: 'mono' })).toBe(true);
    expect(textParamsValid({ ...OK, text: '  ', font: 'serif', height: 1e-3 })).toBe(true);
  });

  it.each([
    ['an empty string', { ...OK, text: '' }],
    ['a string too long', { ...OK, text: 'x'.repeat(MAX_TEXT_LENGTH + 1) }],
    ['a line break', { ...OK, text: 'a\nb' }],
    ['a tab', { ...OK, text: 'a\tb' }],
    ['an unknown font', { ...OK, font: 'comic' }],
    ['height zero', { ...OK, height: 0 }],
    ['height negative', { ...OK, height: -1 }],
    ['height infinite', { ...OK, height: Infinity }],
    ['height NaN', { ...OK, height: Number.NaN }],
  ])('refuses %s', (_name, p) => {
    expect(textParamsValid(p)).toBe(false);
  });
});
