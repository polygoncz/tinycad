// The background of Realistic (spec 09, "Realistic", "Pozadí"; ADR 0027, point 9): a vertical
// gradient of two palette colours as a 1 × 2 texture, stretched over the screen by three's
// background plane. No DOM, so no canvas gradient.

import * as THREE from 'three';
import type { ScenePalette } from './palette';

/** A new 1 × 2 sRGB texture of `palette.realisticBackground`; the caller disposes it. */
export function createRealisticBackground(palette: ScenePalette): THREE.DataTexture {
  const texture = new THREE.DataTexture(new Uint8Array(2 * 4), 1, 2, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  // Linear between the two texel centres: the gradient runs from a quarter to three quarters of
  // the height, flat beyond.
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  setRealisticBackground(texture, palette);
  return texture;
}

/** Rewrites the colours of a texture from createRealisticBackground in place (setPalette). */
export function setRealisticBackground(texture: THREE.DataTexture, palette: ScenePalette): void {
  const data: unknown = texture.image.data;
  if (!(data instanceof Uint8Array)) throw new Error('Not a texture of createRealisticBackground');
  const [top, bottom] = palette.realisticBackground;
  // Row 0 of a DataTexture is the bottom of the screen (no flipY).
  writeRow(data, 0, bottom);
  writeRow(data, 1, top);
  texture.needsUpdate = true;
}

function writeRow(data: Uint8Array, row: number, color: number): void {
  data.set([(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff, 0xff], row * 4);
}
