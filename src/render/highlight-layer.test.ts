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
  return setupWith(new Map<BodyId, BodyView>([[A, viewOf(A)]]));
}

function viewOf(id: BodyId): BodyView {
  return createBodyView(id, aBoxMesh([0, 0, 0], [10, 10, 10]), createBodyMaterials(LIGHT_PALETTE));
}

function setupWith(views: ReadonlyMap<BodyId, BodyView>) {
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

describe('HighlightLayer on a hidden body', () => {
  const B = 'f2/body' as BodyId;

  function hiddenSetup() {
    const views = new Map<BodyId, BodyView>([
      [A, viewOf(A)],
      [B, viewOf(B)],
    ]);
    const layer = createHighlightLayer({
      views,
      requestRender: () => undefined,
      palette: LIGHT_PALETTE,
    });
    const viewA = views.get(A);
    if (viewA === undefined) throw new Error('view A');
    return { layer, viewA };
  }

  it('draws neither hover nor selection of a hidden body', () => {
    const { layer, viewA } = hiddenSetup();
    viewA.object.visible = false;
    layer.setSelection([{ kind: 'edge', body: A, edgeIndex: 0 }]);
    layer.setHover({ kind: 'face', body: A, faceIndex: 0 });
    expect(layer.group.children).toHaveLength(0);
  });

  it('still draws the visible bodies', () => {
    const { layer, viewA } = hiddenSetup();
    viewA.object.visible = false;
    layer.setSelection([
      { kind: 'face', body: A, faceIndex: 0 },
      { kind: 'face', body: B, faceIndex: 0 },
    ]);
    expect(layer.group.children).toHaveLength(1);
  });

  it('rebuild after hiding drops the drawing, after showing brings it back', () => {
    const { layer, viewA } = hiddenSetup();
    layer.setSelection([{ kind: 'face', body: A, faceIndex: 0 }]);
    layer.setHover({ kind: 'edge', body: A, edgeIndex: 0 });
    expect(layer.group.children).toHaveLength(2);
    viewA.object.visible = false;
    layer.rebuild();
    expect(layer.group.children).toHaveLength(0);
    viewA.object.visible = true;
    layer.rebuild();
    expect(layer.group.children).toHaveLength(2);
  });
});

describe('HighlightLayer and sketch entities', () => {
  it('ignores them in hover and selection (the drawing style carries their highlight)', () => {
    const layer = createHighlightLayer({
      views: new Map<BodyId, BodyView>([[A, viewOf(A)]]),
      requestRender: () => undefined,
      palette: LIGHT_PALETTE,
    });
    layer.setHover({ kind: 'sketchEntity', sketch: 's', entity: 'p1' });
    layer.setSelection([
      { kind: 'sketchEntity', sketch: 's', entity: 'l1' },
      { kind: 'face', body: A, faceIndex: 0 },
    ]);
    expect(layer.group.children).toHaveLength(1);
  });
});

describe('HighlightLayer and sketch regions (M13)', () => {
  const r1 = { kind: 'sketchRegion', sketch: 'f1/sketch', region: 'r1' } as const;
  const r2 = { kind: 'sketchRegion', sketch: 'f1/sketch', region: 'r2' } as const;

  function withRegions() {
    const calls: unknown[] = [];
    const layer = createHighlightLayer({
      views: new Map<BodyId, BodyView>([[A, viewOf(A)]]),
      requestRender: () => undefined,
      palette: LIGHT_PALETTE,
      regions: {
        setRegionHighlight: (hover, selection) => {
          calls.push({ hover, selection });
        },
      },
    });
    return { layer, calls };
  }

  it('draws none of them itself', () => {
    const { layer } = withRegions();
    layer.setHover(r1);
    layer.setSelection([r2, { kind: 'face', body: A, faceIndex: 0 }]);
    expect(layer.group.children).toHaveLength(1);
  });

  it('hands hover and selection of regions to the sketch layer', () => {
    const { layer, calls } = withRegions();
    layer.setHover(r1);
    layer.setSelection([r2, { kind: 'face', body: A, faceIndex: 0 }]);
    expect(calls).toEqual([
      { hover: r1, selection: [] },
      { hover: r1, selection: [r2] },
    ]);
  });

  it('does not hand over an unchanged state again', () => {
    const { layer, calls } = withRegions();
    layer.setHover(r1);
    layer.setHover({ ...r1 });
    layer.setSelection([]);
    // A body hover clears the region hover.
    layer.setHover({ kind: 'face', body: A, faceIndex: 1 });
    expect(calls).toEqual([
      { hover: r1, selection: [] },
      { hover: null, selection: [] },
    ]);
  });

  it('drops them without a sketch layer', () => {
    const layer = createHighlightLayer({
      views: new Map<BodyId, BodyView>([[A, viewOf(A)]]),
      requestRender: () => undefined,
      palette: LIGHT_PALETTE,
    });
    layer.setHover(r1);
    layer.setSelection([r2]);
    expect(layer.group.children).toHaveLength(0);
  });
});
