import * as THREE from 'three';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { describe, expect, it } from 'vitest';
import type { BodyId } from '@/interaction';
import { createBodyMaterials, createBodyView, type BodyView } from './body-view';
import { createHighlightLayer } from './highlight-layer';
import { DARK_PALETTE, LIGHT_PALETTE } from './palette';
import { aBoxMesh } from './testing';

// Branded ids are created by a cast in tests only.
const A = 'f1/body' as BodyId;

function setup() {
  const mesh = aBoxMesh([0, 0, 0], [10, 10, 10]);
  const views = new Map<BodyId, BodyView>([
    [A, createBodyView(A, mesh, createBodyMaterials(LIGHT_PALETTE))],
  ]);
  const layer = createHighlightLayer({
    views,
    requestRender: () => undefined,
    palette: LIGHT_PALETTE,
  });
  // Selection on a face and an edge, hover on another face: every material is in use.
  layer.setSelection([
    { kind: 'face', body: A, faceIndex: 0 },
    { kind: 'edge', body: A, edgeIndex: 0 },
  ]);
  layer.setHover({ kind: 'face', body: A, faceIndex: 1 });
  return layer;
}

/** Colours of the drawn objects: [face selection, edge selection, face hover]. */
function drawn(group: THREE.Group): { material: THREE.Material; color: number }[] {
  return group.children.map((object) => {
    if (!(object instanceof THREE.Mesh) && !(object instanceof THREE.LineSegments)) {
      throw new Error('unexpected highlight object');
    }
    const material: unknown = object.material;
    if (material instanceof LineMaterial || material instanceof THREE.MeshBasicMaterial) {
      return { material, color: material.color.getHex() };
    }
    throw new Error('unexpected highlight material');
  });
}

describe('HighlightLayer palette', () => {
  it('draws hover and selection in the colours of the given palette', () => {
    const layer = setup();
    expect(drawn(layer.group).map(({ color }) => color)).toEqual([
      LIGHT_PALETTE.selection,
      LIGHT_PALETTE.selection,
      LIGHT_PALETTE.hover,
    ]);
  });

  it('setPalette recolours the existing materials', () => {
    const layer = setup();
    const before = drawn(layer.group).map(({ material }) => material);
    layer.setPalette(DARK_PALETTE);
    const after = drawn(layer.group);
    expect(after).toHaveLength(before.length);
    after.forEach(({ material }, i) => {
      expect(material).toBe(before[i]);
    });
    expect(after.map(({ color }) => color)).toEqual([
      DARK_PALETTE.selection,
      DARK_PALETTE.selection,
      DARK_PALETTE.hover,
    ]);
  });
});
