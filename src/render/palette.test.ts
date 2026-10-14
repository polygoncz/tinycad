import { describe, expect, it } from 'vitest';
import {
  DARK_PALETTE,
  LIGHT_PALETTE,
  parseHexColor,
  toCssColor,
  type ScenePalette,
} from './palette';

const KEYS = [
  'background',
  'face',
  'edge',
  'hover',
  'selection',
  'preview',
  'construction',
  'sketch',
  'sketchDefined',
  'axes',
  'grid',
  'viewCube',
] as const satisfies readonly (keyof ScenePalette)[];

const isColor = (value: unknown): boolean =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 0xffffff;

describe.each([
  ['LIGHT_PALETTE', LIGHT_PALETTE],
  ['DARK_PALETTE', DARK_PALETTE],
])('%s', (_, palette) => {
  it('is frozen, axes included', () => {
    expect(Object.isFrozen(palette)).toBe(true);
    expect(Object.isFrozen(palette.axes)).toBe(true);
    expect(Object.isFrozen(palette.grid)).toBe(true);
    expect(Object.isFrozen(palette.viewCube)).toBe(true);
  });

  it('has a colour for every key and nothing else', () => {
    expect(Object.keys(palette).sort()).toEqual([...KEYS].sort());
    for (const key of KEYS) {
      if (key === 'axes' || key === 'grid' || key === 'viewCube') continue;
      expect(isColor(palette[key]), key).toBe(true);
    }
    expect(palette.axes).toHaveLength(3);
    expect(palette.axes.every(isColor)).toBe(true);
    expect(palette.grid).toHaveLength(2);
    expect(palette.grid.every(isColor)).toBe(true);
    expect(palette.viewCube).toHaveLength(2);
    expect(palette.viewCube.every(isColor)).toBe(true);
  });

  it('has the axes of the mockup', () => {
    expect(palette.axes).toEqual([0xff3b30, 0x34c759, 0x0a84ff]);
  });

  // M19.2 D1 (review U13): a selected or hovered entity must not look like an axis or like
  // a body in its default colour.
  it('keeps selection and hover apart from the axes, the faces and each other', () => {
    for (const key of ['selection', 'hover'] as const) {
      expect(palette.axes, key).not.toContain(palette[key]);
      expect(palette[key], key).not.toBe(palette.face);
      expect(palette[key], key).not.toBe(palette.preview);
      expect(palette[key], key).not.toBe(palette.sketch);
    }
    expect(palette.hover).not.toBe(palette.selection);
  });
});

describe('parseHexColor', () => {
  it('turns #rrggbb into 0xRRGGBB', () => {
    expect(parseHexColor('#000000')).toBe(0x000000);
    expect(parseHexColor('#ffffff')).toBe(0xffffff);
    expect(parseHexColor('#3b6aa6')).toBe(0x3b6aa6);
  });

  it.each(['', '#fff', '#ABCDEF', '3b6aa6', '#3b6aa6ff', 'red', '#gggggg', ' #3b6aa6'])(
    'throws on %j (only the canonical form of the document)',
    (text) => {
      expect(() => parseHexColor(text)).toThrow();
    },
  );
});

describe('toCssColor', () => {
  it('turns 0xRRGGBB into #rrggbb, the inverse of parseHexColor', () => {
    expect(toCssColor(0x000000)).toBe('#000000');
    expect(toCssColor(0x0a84ff)).toBe('#0a84ff');
    expect(toCssColor(0xffffff)).toBe('#ffffff');
    expect(parseHexColor(toCssColor(0x374151))).toBe(0x374151);
  });
});

describe('palettes', () => {
  it('light keeps the colours of M8 and M9 except the orange selection (M19.2)', () => {
    expect(LIGHT_PALETTE).toEqual({
      background: 0xf3f4f6,
      face: 0xb9c3d1,
      edge: 0x1f2328,
      hover: 0xfb923c,
      selection: 0xea580c,
      preview: 0x2563eb,
      construction: 0x6b7280,
      sketch: 0x0a84ff,
      sketchDefined: 0x1c1c1e,
      axes: [0xff3b30, 0x34c759, 0x0a84ff],
      grid: [0xb4b9c1, 0xd5d8dd],
      viewCube: [0xffffff, 0x374151],
    });
  });

  it('dark follows the mockup except the orange selection (M19.2)', () => {
    expect(DARK_PALETTE).toMatchObject({
      background: 0x1f2023,
      face: 0x3b6aa6,
      edge: 0x9cc3f5,
      selection: 0xff9f0a,
      hover: 0xffc266,
      preview: 0x0a84ff,
      construction: 0x6b7280,
      sketch: 0x409cff,
      sketchDefined: 0xf2f2f7,
    });
  });

  it('view cube: face and text colour by theme (M17)', () => {
    expect(LIGHT_PALETTE.viewCube).toEqual([0xffffff, 0x374151]);
    expect(DARK_PALETTE.viewCube).toEqual([0x4b4f57, 0xe5e7eb]);
  });
});
