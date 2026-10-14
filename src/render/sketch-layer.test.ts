import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { Vec2 } from '@/core';
import type { SketchDrawing } from '@/interaction';
import { DARK_PALETTE, LIGHT_PALETTE } from './palette';
import { createSketchLayer } from './sketch-layer';

// Region fills of the sketch layer (spec 09, "Skici", M13). Three.js runs in Node; nothing is
// rendered, the test reads the scene graph.

const square = (x0: number, y0: number, size: number): Vec2[] => [
  [x0, y0],
  [x0 + size, y0],
  [x0 + size, y0 + size],
  [x0, y0 + size],
];

/** On the plane z = 5: a 10 × 10 region with a hole and a second region next to it. */
const drawing: SketchDrawing = {
  plane: { origin: [0, 0, 5], xDir: [1, 0, 0], normal: [0, 0, 1] },
  curves: [{ kind: 'line', id: 'l1', from: [0, 0], to: [10, 0], style: 'normal' }],
  points: [],
  regions: [
    { id: 'r1', outer: square(0, 0, 10), holes: [square(3, 3, 4)] },
    { id: 'r2', outer: square(20, 0, 10), holes: [] },
  ],
};

function setup() {
  let renders = 0;
  const layer = createSketchLayer({
    requestRender: () => {
      renders++;
    },
    palette: LIGHT_PALETTE,
  });
  return { layer, renders: () => renders };
}

/** A region fill: the mesh with its shape geometry and its current material. */
interface Fill {
  readonly object: THREE.Object3D;
  readonly geometry: THREE.ShapeGeometry;
  readonly material: THREE.MeshBasicMaterial;
}

/** Region fills in the layer, in region order. */
function fills(group: THREE.Group): Fill[] {
  const result: Fill[] = [];
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    // unknown: instanceof Mesh gives Mesh<any>.
    const geometry: unknown = object.geometry;
    const material: unknown = object.material;
    if (geometry instanceof THREE.ShapeGeometry && material instanceof THREE.MeshBasicMaterial) {
      result.push({ object, geometry, material });
    }
  });
  return result;
}

const colorOf = (fill: Fill | undefined): number | undefined => fill?.material.color.getHex();

const target = (sketch: string, region: string) =>
  ({ kind: 'sketchRegion', sketch, region }) as const;

describe('SketchLayer region fills', () => {
  it('builds one hidden fill per region, placed by the plane frame', () => {
    const { layer } = setup();
    layer.set('f1/sketch', drawing);
    const [r1, r2] = fills(layer.group);
    expect(r1?.object.visible).toBe(false);
    expect(r2?.object.visible).toBe(false);
    r1?.geometry.computeBoundingBox();
    const box = r1?.geometry.boundingBox;
    expect(box?.min.toArray()).toEqual([0, 0, 5]);
    expect(box?.max.toArray()).toEqual([10, 10, 5]);
    expect(r1?.object.renderOrder).toBe(2);
  });

  it('shows hover and selection in their colours, the selection winning', () => {
    const { layer } = setup();
    layer.set('f1/sketch', drawing);
    layer.setRegionHighlight(target('f1/sketch', 'r1'), [target('f1/sketch', 'r2')]);
    const [r1, r2] = fills(layer.group);
    expect(r1?.object.visible).toBe(true);
    expect(colorOf(r1)).toBe(LIGHT_PALETTE.hover);
    expect(colorOf(r2)).toBe(LIGHT_PALETTE.selection);
    layer.setRegionHighlight(target('f1/sketch', 'r2'), [target('f1/sketch', 'r2')]);
    expect(r1?.object.visible).toBe(false);
    expect(colorOf(r2)).toBe(LIGHT_PALETTE.selection);
  });

  it('keeps the highlight of a drawing set later and over a palette change', () => {
    const { layer } = setup();
    layer.setRegionHighlight(null, [target('f1/sketch', 'r1')]);
    layer.set('f1/sketch', drawing);
    expect(fills(layer.group)[0]?.object.visible).toBe(true);
    layer.setPalette(DARK_PALETTE);
    const [r1] = fills(layer.group);
    expect(r1?.object.visible).toBe(true);
    expect(colorOf(r1)).toBe(DARK_PALETTE.selection);
  });

  it('ignores targets of another drawing and requests a render', () => {
    const { layer, renders } = setup();
    layer.set('f1/sketch', drawing);
    const before = renders();
    layer.setRegionHighlight(target('f2/sketch', 'r1'), []);
    expect(fills(layer.group).every((fill) => !fill.object.visible)).toBe(true);
    expect(renders()).toBe(before + 1);
  });

  it('picks a region by a ray and forgets it after remove', () => {
    const { layer } = setup();
    layer.set('f1/sketch', drawing);
    const ray = { origin: [1, 1, 50], direction: [0, 0, -1] } as const;
    expect(layer.pickRegion(ray)).toEqual({
      kind: 'sketchRegion',
      sketch: 'f1/sketch',
      region: 'r1',
      point: [1, 1, 5],
    });
    layer.remove('f1/sketch');
    expect(layer.pickRegion(ray)).toBeNull();
    expect(fills(layer.group)).toHaveLength(0);
  });

  it('dispose releases the fill geometries', () => {
    const { layer } = setup();
    layer.set('f1/sketch', drawing);
    const [r1] = fills(layer.group);
    let disposed = false;
    r1?.geometry.addEventListener('dispose', () => {
      disposed = true;
    });
    layer.dispose();
    expect(disposed).toBe(true);
  });
});
