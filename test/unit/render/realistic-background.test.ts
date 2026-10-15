import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { DARK_PALETTE, LIGHT_PALETTE } from '@/render/palette';
import { createRealisticBackground, setRealisticBackground } from '@/render/realistic-background';

/** [bottom, top] row of the 1 × 2 texture as 0xRRGGBB. */
function rows(texture: THREE.DataTexture): number[] {
  const data: unknown = texture.image.data;
  if (!(data instanceof Uint8Array)) throw new Error('Uint8Array');
  const row = (i: number): number =>
    ((data[i * 4] ?? 0) << 16) | ((data[i * 4 + 1] ?? 0) << 8) | (data[i * 4 + 2] ?? 0);
  return [row(0), row(1)];
}

describe('createRealisticBackground', () => {
  it('is a 1 × 2 sRGB texture with linear filtering, bottom row first', () => {
    const texture = createRealisticBackground(LIGHT_PALETTE);
    expect(texture.image.width).toBe(1);
    expect(texture.image.height).toBe(2);
    expect(texture.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(texture.magFilter).toBe(THREE.LinearFilter);
    expect(texture.minFilter).toBe(THREE.LinearFilter);
    const [top, bottom] = LIGHT_PALETTE.realisticBackground;
    // Row 0 of a DataTexture is the bottom of the screen (no flipY).
    expect(rows(texture)).toEqual([bottom, top]);
    expect(texture.version).toBeGreaterThan(0);
    texture.dispose();
  });

  it('setRealisticBackground rewrites the data of the same texture', () => {
    const texture = createRealisticBackground(LIGHT_PALETTE);
    const data: unknown = texture.image.data;
    const version = texture.version;

    setRealisticBackground(texture, DARK_PALETTE);

    expect(texture.image.data).toBe(data);
    expect(texture.version).toBeGreaterThan(version);
    const [top, bottom] = DARK_PALETTE.realisticBackground;
    expect(rows(texture)).toEqual([bottom, top]);
    texture.dispose();
  });
});
