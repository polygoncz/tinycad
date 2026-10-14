import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { describe, expect, it, vi } from 'vitest';
import type { Vec2, Vec3 } from '@/core';
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
    expect(layer.pickRegion(ray, () => true)).toEqual({
      kind: 'sketchRegion',
      sketch: 'f1/sketch',
      region: 'r1',
      point: [1, 1, 5],
    });
    layer.remove('f1/sketch');
    expect(layer.pickRegion(ray, () => true)).toBeNull();
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

describe('SketchLayer bounds', () => {
  it('is null without drawings', () => {
    expect(setup().layer.bounds()).toBeNull();
  });

  it('encloses the curves and points of every drawing in world coordinates', () => {
    const { layer } = setup();
    layer.set('a', drawing);
    layer.set('b', {
      plane: { origin: [0, 0, 0], xDir: [1, 0, 0], normal: [0, 1, 0] },
      curves: [],
      points: [{ id: 'p', at: [-4, 7], style: 'normal' }],
    });
    // 'a': the line (0, 0, 5)–(10, 0, 5); 'b': yDir = normal × xDir = −Z, so (−4, 0, −7).
    const box = layer.bounds();
    expect(box).not.toBeNull();
    expect(box?.min[0]).toBeCloseTo(-4);
    expect(box?.max[0]).toBeCloseTo(10);
    expect(box?.min[1]).toBeCloseTo(0);
    expect(box?.max[1]).toBeCloseTo(0);
    expect(box?.min[2]).toBeCloseTo(-7);
    expect(box?.max[2]).toBeCloseTo(5);
  });

  it('is null again after the last drawing is removed', () => {
    const { layer } = setup();
    layer.set('a', drawing);
    layer.remove('a');
    expect(layer.bounds()).toBeNull();
  });
});

/** Every object of a kind under the group, in scene order. */
function objectsOf<T extends THREE.Object3D>(
  group: THREE.Object3D,
  kind: abstract new (...args: never[]) => T,
): T[] {
  const result: T[] = [];
  group.traverse((object) => {
    if (object instanceof kind) result.push(object);
  });
  return result;
}

/** The single material of an object; the layer never uses material arrays. */
function materialOf(object: LineSegments2 | THREE.Points | THREE.LineSegments): THREE.Material {
  const material = object.material;
  if (Array.isArray(material)) throw new Error('no single material');
  return material;
}

/** The colour of a grid line material. */
function gridColor(lines: THREE.LineSegments): number {
  const material = materialOf(lines);
  if (!(material instanceof THREE.LineBasicMaterial)) throw new Error('not a grid material');
  return material.color.getHex();
}

/** Line, points and a region on the plane z = 0, for depth and picking. */
const flat: SketchDrawing = {
  plane: { origin: [0, 0, 0], xDir: [1, 0, 0], normal: [0, 0, 1] },
  curves: [{ kind: 'line', id: 'l1', from: [0, 0], to: [10, 0], style: 'normal' }],
  // 'p1' right at the origin, 'p2' 0.3 mm (3 px) next to it.
  points: [
    { id: 'p1', at: [0, 0], style: 'normal' },
    { id: 'p2', at: [0.3, 0], style: 'normal' },
  ],
  regions: [{ id: 'r1', outer: square(-5, -5, 10), holes: [] }],
};
const editing: SketchDrawing = { ...flat, editing: true };

/** Looking down −Z at the origin; 1 px = 0.1 mm, px (500, 500) is the origin. */
function topCamera(): THREE.OrthographicCamera {
  const camera = new THREE.OrthographicCamera(-50, 50, 50, -50, 0.1, 1000);
  camera.position.set(0, 0, 100);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  return camera;
}

describe('SketchLayer depth (M19.2)', () => {
  it('tests depth for lines, points and region fills, pulled towards the viewer', () => {
    const { layer } = setup();
    layer.set('a', flat);
    layer.setRegionHighlight(target('a', 'r1'), []);
    const [lines] = objectsOf(layer.group, LineSegments2);
    const [points] = objectsOf(layer.group, THREE.Points);
    const [fill] = fills(layer.group);
    if (lines === undefined || points === undefined || fill === undefined) {
      throw new Error('missing objects');
    }
    const lineMaterial = materialOf(lines);
    expect(lineMaterial).toMatchObject({
      depthTest: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    expect(materialOf(points)).toMatchObject({ depthTest: true, depthWrite: false });
    expect(fill.material).toMatchObject({
      depthTest: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
  });

  it('draws only an edited drawing a second time, faint and dashed behind the bodies', () => {
    const { layer } = setup();
    layer.set('plain', flat);
    expect(objectsOf(layer.group, LineSegments2)).toHaveLength(1);
    expect(objectsOf(layer.group, THREE.Points)).toHaveLength(1);

    layer.set('edit', editing);
    const lines = objectsOf(layer.group, LineSegments2);
    const points = objectsOf(layer.group, THREE.Points);
    expect(lines).toHaveLength(3);
    expect(points).toHaveLength(3);
    const hiddenLines = lines.filter((o) => materialOf(o).depthFunc === THREE.GreaterDepth);
    const hiddenPoints = points.filter((o) => materialOf(o).depthFunc === THREE.GreaterDepth);
    expect(hiddenLines).toHaveLength(1);
    expect(hiddenPoints).toHaveLength(1);
    const [hiddenLine] = hiddenLines;
    if (hiddenLine === undefined) throw new Error('no hidden line');
    expect(materialOf(hiddenLine)).toMatchObject({
      dashed: true,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    expect(hiddenLine.renderOrder).toBe(3);
    // Dashes need the distances along the lines.
    expect(hiddenLine.geometry.getAttribute('instanceDistanceStart')).toBeDefined();
    expect(materialOf(hiddenPoints[0] ?? hiddenLine)).toMatchObject({
      transparent: true,
      opacity: 0.35,
    });
  });

  it('keeps the dashes 6 px long with 4 px gaps', () => {
    const { layer } = setup();
    layer.set('edit', editing);
    layer.setPixelSize(0.5, [0, 0, 0], 1000);
    const hidden = objectsOf(layer.group, LineSegments2).find(
      (o) => materialOf(o).depthFunc === THREE.GreaterDepth,
    );
    expect(hidden && materialOf(hidden)).toMatchObject({ dashSize: 3, gapSize: 2 });
  });

  it('recolours and disposes the materials of the second pass too', () => {
    const { layer } = setup();
    layer.set('edit', editing);
    const before = objectsOf(layer.group, LineSegments2).map(materialOf);
    let disposed = 0;
    for (const material of new Set(before)) {
      material.addEventListener('dispose', () => {
        disposed++;
      });
    }
    layer.setPalette(DARK_PALETTE);
    expect(objectsOf(layer.group, LineSegments2)).toHaveLength(2);
    layer.dispose();
    expect(disposed).toBe(2);
  });
});

describe('SketchLayer picking with occlusion (M19.2)', () => {
  const pickAtOrigin = (layer: ReturnType<typeof setup>['layer'], visible: (p: Vec3) => boolean) =>
    layer.pick(topCamera(), 500, 500, 1000, 1000, visible);

  it('takes the first hit that is visible', () => {
    const { layer } = setup();
    layer.set('a', flat);
    expect(pickAtOrigin(layer, () => true)).toMatchObject({ entity: 'p1' });
    // p1 at x = 0 is hidden, p2 at x = 0.3 is not.
    expect(pickAtOrigin(layer, ([x]) => x > 0.1)).toMatchObject({
      kind: 'sketchEntity',
      sketch: 'a',
      entity: 'p2',
    });
    expect(pickAtOrigin(layer, () => false)).toBeNull();
  });

  it('does not ask about the edited drawing', () => {
    const { layer } = setup();
    layer.set('edit', editing);
    const visible = vi.fn(() => false);
    expect(pickAtOrigin(layer, visible)).toMatchObject({ sketch: 'edit', entity: 'p1' });
    expect(visible).not.toHaveBeenCalled();
  });

  it('picks a region only where it is visible, except in the edited drawing', () => {
    const { layer } = setup();
    layer.set('a', flat);
    const ray = { origin: [1, 1, 50], direction: [0, 0, -1] } as const;
    expect(layer.pickRegion(ray, () => false)).toBeNull();
    expect(layer.pickRegion(ray, () => true)).toMatchObject({ sketch: 'a', region: 'r1' });
    layer.set('a', editing);
    expect(layer.pickRegion(ray, () => false)).toMatchObject({ sketch: 'a', region: 'r1' });
  });
});

/** The grid lines of the layer: plain LineSegments (the sketch lines are LineSegments2). */
function gridOf(group: THREE.Group): THREE.LineSegments[] {
  return objectsOf(group, THREE.LineSegments).filter((o) => !(o instanceof LineSegments2));
}

describe('SketchLayer grid (M19.2)', () => {
  it('draws the grid only in the plane of the edited drawing', () => {
    const { layer } = setup();
    layer.set('plain', flat);
    layer.setPixelSize(0.1, [0, 0, 0], 1000);
    expect(gridOf(layer.group)).toHaveLength(0);

    layer.set('edit', { ...editing, plane: { ...flat.plane, origin: [0, 0, 7] } });
    layer.setPixelSize(0.1, [0, 0, 0], 1000);
    const grid = gridOf(layer.group);
    expect(grid).toHaveLength(2);
    for (const lines of grid) {
      expect(materialOf(lines)).toMatchObject({ depthTest: true, depthWrite: false });
      expect(lines.renderOrder).toBeLessThan(3);
      lines.geometry.computeBoundingBox();
      expect(lines.geometry.boundingBox?.min.z).toBeCloseTo(7);
      expect(lines.geometry.boundingBox?.max.z).toBeCloseTo(7);
    }
    const colors = grid.map(gridColor);
    expect(colors.sort()).toEqual([...LIGHT_PALETTE.grid].sort());

    layer.remove('edit');
    expect(gridOf(layer.group)).toHaveLength(0);
  });

  it('spans half the diagonal of the view around the target, on multiples of the step', () => {
    const { layer } = setup();
    layer.set('edit', editing);
    // 0.1 mm per px → step 1 mm; diagonal 1000 px → half extent 50 mm around (20, 0).
    layer.setPixelSize(0.1, [20, 0, 3], 1000);
    const box = new THREE.Box3();
    for (const lines of gridOf(layer.group)) {
      lines.geometry.computeBoundingBox();
      if (lines.geometry.boundingBox) box.union(lines.geometry.boundingBox);
    }
    expect(box.min.x).toBeCloseTo(-30);
    expect(box.max.x).toBeCloseTo(70);
    expect(box.min.y).toBeCloseTo(-50);
    expect(box.max.y).toBeCloseTo(50);
  });

  it('rebuilds the grid only when the step changes or the centre moves far', () => {
    const { layer } = setup();
    layer.set('edit', editing);
    layer.setPixelSize(0.1, [0, 0, 0], 1000);
    const [first] = gridOf(layer.group);
    layer.setPixelSize(0.1, [10, 0, 0], 1000);
    expect(gridOf(layer.group)[0]).toBe(first);
    layer.setPixelSize(0.1, [20, 0, 0], 1000);
    expect(gridOf(layer.group)[0]).not.toBe(first);
    const [second] = gridOf(layer.group);
    layer.setPixelSize(0.3, [20, 0, 0], 1000);
    expect(gridOf(layer.group)[0]).not.toBe(second);
  });

  it('recolours the grid and releases it on dispose', () => {
    const { layer } = setup();
    layer.set('edit', editing);
    layer.setPixelSize(0.1, [0, 0, 0], 1000);
    layer.setPalette(DARK_PALETTE);
    const colors = gridOf(layer.group).map(gridColor);
    expect(colors.sort()).toEqual([...DARK_PALETTE.grid].sort());
    const [lines] = gridOf(layer.group);
    let disposed = false;
    lines?.geometry.addEventListener('dispose', () => {
      disposed = true;
    });
    layer.dispose();
    expect(disposed).toBe(true);
  });
});
