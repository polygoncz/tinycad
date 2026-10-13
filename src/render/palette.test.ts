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
  'axes',
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
  });

  it('has a colour for every key and nothing else', () => {
    expect(Object.keys(palette).sort()).toEqual([...KEYS].sort());
    for (const key of KEYS) {
      if (key === 'axes') continue;
      expect(isColor(palette[key]), key).toBe(true);
    }
    expect(palette.axes).toHaveLength(3);
    expect(palette.axes.every(isColor)).toBe(true);
  });
});

describe('palettes', () => {
  it('light keeps the colours of M8 and M9', () => {
    expect(LIGHT_PALETTE).toEqual({
      background: 0xf3f4f6,
      face: 0xb9c3d1,
      edge: 0x1f2328,
      hover: 0xf59e0b,
      selection: 0x2563eb,
      preview: 0x2563eb,
      construction: 0x6b7280,
      axes: [0xe53935, 0x43a047, 0x1e88e5],
    });
  });

  it('dark follows the mockup', () => {
    expect(DARK_PALETTE).toMatchObject({
      background: 0x1f2023,
      face: 0x3b6aa6,
      edge: 0x9cc3f5,
      selection: 0x0a84ff,
      hover: 0x5e9ff5,
    });
  });
});
