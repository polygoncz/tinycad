import { describe, expect, it } from 'vitest';
import { DARK_PALETTE, LIGHT_PALETTE, type ScenePalette } from './palette';

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
  });

  it('has a colour for every key and nothing else', () => {
    expect(Object.keys(palette).sort()).toEqual([...KEYS].sort());
    for (const key of KEYS) {
      if (key === 'axes' || key === 'grid') continue;
      expect(isColor(palette[key]), key).toBe(true);
    }
    expect(palette.axes).toHaveLength(3);
    expect(palette.axes.every(isColor)).toBe(true);
    expect(palette.grid).toHaveLength(2);
    expect(palette.grid.every(isColor)).toBe(true);
  });

  it('has the axes of the mockup', () => {
    expect(palette.axes).toEqual([0xff3b30, 0x34c759, 0x0a84ff]);
  });
});

describe('palettes', () => {
  it('light keeps the colours of M8 and M9, axes by the mockup', () => {
    expect(LIGHT_PALETTE).toEqual({
      background: 0xf3f4f6,
      face: 0xb9c3d1,
      edge: 0x1f2328,
      hover: 0xf59e0b,
      selection: 0x2563eb,
      preview: 0x2563eb,
      construction: 0x6b7280,
      sketch: 0x0a84ff,
      sketchDefined: 0x1c1c1e,
      axes: [0xff3b30, 0x34c759, 0x0a84ff],
      grid: [0xb4b9c1, 0xd5d8dd],
    });
  });

  it('dark follows the mockup', () => {
    expect(DARK_PALETTE).toMatchObject({
      background: 0x1f2023,
      face: 0x3b6aa6,
      edge: 0x9cc3f5,
      selection: 0x0a84ff,
      hover: 0x5e9ff5,
      preview: 0x0a84ff,
      construction: 0x6b7280,
      sketch: 0x409cff,
      sketchDefined: 0xf2f2f7,
    });
  });
});
