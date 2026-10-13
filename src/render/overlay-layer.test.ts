import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createOverlayLayer } from './overlay-layer';
import { DARK_PALETTE, LIGHT_PALETTE } from './palette';

function setup() {
  const layer = createOverlayLayer({ requestRender: () => undefined, palette: LIGHT_PALETTE });
  const segment = [
    [0, 0, 0],
    [1, 0, 0],
  ] as const;
  layer.set('tool', [
    { kind: 'lines', style: 'preview', points: segment },
    { kind: 'lines', style: 'construction', points: segment },
    { kind: 'points', style: 'preview', points: segment },
    { kind: 'points', style: 'construction', points: segment },
  ]);
  return layer;
}

/** Material and colour of every drawn object, in the order of the shapes. */
function drawn(group: THREE.Group): { material: THREE.Material; color: number }[] {
  return group.children.map((object) => {
    if (!(object instanceof THREE.LineSegments) && !(object instanceof THREE.Points)) {
      throw new Error('unexpected overlay object');
    }
    const material: unknown = object.material;
    if (material instanceof THREE.LineBasicMaterial || material instanceof THREE.PointsMaterial) {
      return { material, color: material.color.getHex() };
    }
    throw new Error('unexpected overlay material');
  });
}

describe('OverlayLayer palette', () => {
  it('draws the styles in the colours of the given palette', () => {
    const layer = setup();
    expect(drawn(layer.group).map(({ color }) => color)).toEqual([
      LIGHT_PALETTE.preview,
      LIGHT_PALETTE.construction,
      LIGHT_PALETTE.preview,
      LIGHT_PALETTE.construction,
    ]);
  });

  it('setPalette recolours the existing materials', () => {
    const layer = setup();
    const before = drawn(layer.group).map(({ material }) => material);
    layer.setPalette(DARK_PALETTE);
    const after = drawn(layer.group);
    after.forEach(({ material }, i) => {
      expect(material).toBe(before[i]);
    });
    expect(after.map(({ color }) => color)).toEqual([
      DARK_PALETTE.preview,
      DARK_PALETTE.construction,
      DARK_PALETTE.preview,
      DARK_PALETTE.construction,
    ]);
  });
});
