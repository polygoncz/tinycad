import { describe, expect, it } from 'vitest';
import {
  DARK_PALETTE,
  LIGHT_PALETTE,
  parseHexColor,
  toCssColor,
  type ScenePalette,
} from '@/render/palette';

const KEYS = [
  'background',
  'face',
  'edge',
  'hover',
  'selection',
  'preview',
  'bodyPreview',
  'construction',
  'sketch',
  'sketchDefined',
  'axes',
  'grid',
  'viewCube',
  'hiddenEdge',
  'meshLine',
  'realisticBackground',
] as const satisfies readonly (keyof ScenePalette)[];

/** Relative luminance of 0xRRGGBB (WCAG 2). */
function luminance(color: number): number {
  const channel = (c: number): number => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * channel((color >> 16) & 0xff) +
    0.7152 * channel((color >> 8) & 0xff) +
    0.0722 * channel(color & 0xff)
  );
}

/** WCAG 2 contrast ratio of two colours, 1 to 21. */
function contrast(a: number, b: number): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]; // two values
  return (hi + 0.05) / (lo + 0.05);
}

/** Euclidean distance of two colours in RGB, 0 to 441. */
function distance(a: number, b: number): number {
  const d = (shift: number): number => ((a >> shift) & 0xff) - ((b >> shift) & 0xff);
  return Math.hypot(d(16), d(8), d(0));
}

/** Hue in degrees, 0 to 360. */
function hue(color: number): number {
  const [r, g, b] = [16, 8, 0].map((shift) => ((color >> shift) & 0xff) / 255) as [
    number,
    number,
    number,
  ]; // three channels
  const max = Math.max(r, g, b);
  const c = max - Math.min(r, g, b);
  if (c === 0) return 0;
  const h = max === r ? ((g - b) / c + 6) % 6 : max === g ? (b - r) / c + 2 : (r - g) / c + 4;
  return h * 60;
}

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
    expect(Object.isFrozen(palette.realisticBackground)).toBe(true);
  });

  it('has a colour for every key and nothing else', () => {
    expect(Object.keys(palette).sort()).toEqual([...KEYS].sort());
    for (const key of KEYS) {
      if (key === 'axes' || key === 'grid' || key === 'viewCube' || key === 'realisticBackground') {
        continue;
      }
      expect(isColor(palette[key]), key).toBe(true);
    }
    expect(palette.axes).toHaveLength(3);
    expect(palette.axes.every(isColor)).toBe(true);
    expect(palette.grid).toHaveLength(2);
    expect(palette.grid.every(isColor)).toBe(true);
    expect(palette.viewCube).toHaveLength(2);
    expect(palette.viewCube.every(isColor)).toBe(true);
    expect(palette.realisticBackground).toHaveLength(2);
    expect(palette.realisticBackground.every(isColor)).toBe(true);
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

  // M21 Ú8: the preview of the edited feature is amber, so it reads as "the result, not yet the
  // model" next to the bodies, the selection and the hover; the tool overlay keeps `preview`.
  it('draws the body preview in amber, apart from the bodies, the selection, the hover and the tools', () => {
    const amber = palette.bodyPreview;
    expect(hue(amber)).toBeGreaterThanOrEqual(35);
    expect(hue(amber)).toBeLessThanOrEqual(55);
    for (const key of ['face', 'selection', 'hover', 'preview'] as const) {
      expect(distance(amber, palette[key]), key).toBeGreaterThanOrEqual(50);
    }
  });

  it('gives the body preview a contrast of at least 3:1 to the background (WCAG non-text)', () => {
    expect(contrast(palette.bodyPreview, palette.background)).toBeGreaterThanOrEqual(3);
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
      bodyPreview: 0xb07d0a,
      construction: 0x6b7280,
      sketch: 0x0a84ff,
      sketchDefined: 0x1c1c1e,
      axes: [0xff3b30, 0x34c759, 0x0a84ff],
      grid: [0xb4b9c1, 0xd5d8dd],
      viewCube: [0xffffff, 0x374151],
      hiddenEdge: 0x8b929c,
      meshLine: 0x8e99a8,
      realisticBackground: [0xf4f6f9, 0xd9dee5],
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
      bodyPreview: 0xffd60a,
      construction: 0x6b7280,
      sketch: 0x409cff,
      sketchDefined: 0xf2f2f7,
    });
  });

  it('hidden edges and triangulation lines by theme (M22)', () => {
    expect(LIGHT_PALETTE).toMatchObject({ hiddenEdge: 0x8b929c, meshLine: 0x8e99a8 });
    expect(DARK_PALETTE).toMatchObject({ hiddenEdge: 0x6b7280, meshLine: 0x5a7fb0 });
  });

  it('gradient background of Realistic by theme, top lighter than bottom (M24)', () => {
    expect(LIGHT_PALETTE.realisticBackground).toEqual([0xf4f6f9, 0xd9dee5]);
    expect(DARK_PALETTE.realisticBackground).toEqual([0x3a3f47, 0x1c1f24]);
    for (const palette of [LIGHT_PALETTE, DARK_PALETTE]) {
      const [top, bottom] = palette.realisticBackground;
      expect(luminance(top)).toBeGreaterThan(luminance(bottom));
    }
  });

  it('view cube: face and text colour by theme (M17)', () => {
    expect(LIGHT_PALETTE.viewCube).toEqual([0xffffff, 0x374151]);
    expect(DARK_PALETTE.viewCube).toEqual([0x4b4f57, 0xe5e7eb]);
  });
});
