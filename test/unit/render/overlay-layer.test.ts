import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createOverlayLayer } from '@/render/overlay-layer';
import { DARK_PALETTE, LIGHT_PALETTE } from '@/render/palette';

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

describe('OverlayLayer warning style (M33)', () => {
  const segment = [
    [0, 0, 0],
    [1, 0, 0],
  ] as const;

  it('draws points and lines in palette.warning, recoloured by setPalette', () => {
    const layer = createOverlayLayer({ requestRender: () => undefined, palette: LIGHT_PALETTE });
    layer.set('crossings', [
      { kind: 'points', style: 'warning', points: segment },
      { kind: 'lines', style: 'warning', points: segment },
    ]);
    expect(drawn(layer.group).map(({ color }) => color)).toEqual([
      LIGHT_PALETTE.warning,
      LIGHT_PALETTE.warning,
    ]);

    layer.setPalette(DARK_PALETTE);
    expect(drawn(layer.group).map(({ color }) => color)).toEqual([
      DARK_PALETTE.warning,
      DARK_PALETTE.warning,
    ]);
  });

  // A crossing point lies on the sketch lines (renderOrder 3, spec 09): under them it would hide.
  it('draws warnings over the sketch lines, the other styles under them', () => {
    const layer = createOverlayLayer({ requestRender: () => undefined, palette: LIGHT_PALETTE });
    layer.set('crossings', [
      { kind: 'points', style: 'warning', points: segment },
      { kind: 'lines', style: 'warning', points: segment },
      { kind: 'points', style: 'preview', points: segment },
      { kind: 'lines', style: 'construction', points: segment },
    ]);
    expect(layer.group.children.map((object) => object.renderOrder)).toEqual([3.5, 3.5, 2, 2]);
  });
});

describe('OverlayLayer bounds', () => {
  it('is null without shapes', () => {
    const layer = createOverlayLayer({ requestRender: () => undefined, palette: LIGHT_PALETTE });
    expect(layer.bounds()).toBeNull();
    layer.set('empty', []);
    expect(layer.bounds()).toBeNull();
  });

  it('encloses the points of every shape under every id', () => {
    const layer = createOverlayLayer({ requestRender: () => undefined, palette: LIGHT_PALETTE });
    layer.set('a', [
      {
        kind: 'lines',
        style: 'preview',
        points: [
          [0, 0, 0],
          [10, 2, 0],
        ],
      },
    ]);
    layer.set('b', [{ kind: 'points', style: 'construction', points: [[-3, 5, 8]] }]);
    expect(layer.bounds()).toEqual({ min: [-3, 0, 0], max: [10, 5, 8] });
  });

  it('forgets removed and cleared shapes', () => {
    const layer = setup();
    layer.set('far', [{ kind: 'points', style: 'preview', points: [[100, 100, 100]] }]);
    layer.remove('far');
    expect(layer.bounds()).toEqual({ min: [0, 0, 0], max: [1, 0, 0] });
    layer.clear();
    expect(layer.bounds()).toBeNull();
  });
});
