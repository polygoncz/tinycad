import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { DARK_PALETTE, LIGHT_PALETTE } from '@/render/palette';
import { createSceneHelpers, GRID_BOUNDS } from '@/render/scene-helpers';

/** Colours of the grid: [centre line, any other line]. */
function gridColors(helpers: ReturnType<typeof createSceneHelpers>): number[] {
  const attribute = helpers.grid.geometry.getAttribute('color');
  const color = new THREE.Color();
  const colors = new Set<number>();
  for (let vertex = 0; vertex < attribute.count; vertex++) {
    colors.add(color.fromBufferAttribute(attribute, vertex).getHex());
  }
  // The centre line is the middle one of the divisions + 1 lines, four vertices each.
  const center = color.fromBufferAttribute(attribute, (attribute.count / 4 - 1) * 2).getHex();
  colors.delete(center);
  return [center, ...colors];
}

describe('SceneHelpers grid', () => {
  it('colours the grid by the given palette', () => {
    const camera = new THREE.OrthographicCamera();
    const scene = new THREE.Scene();
    scene.add(camera);
    const helpers = createSceneHelpers(scene, camera, LIGHT_PALETTE);
    expect(gridColors(helpers)).toEqual([...LIGHT_PALETTE.grid]);
  });

  it('setPalette recolours the grid in the same geometry', () => {
    const camera = new THREE.OrthographicCamera();
    const scene = new THREE.Scene();
    scene.add(camera);
    const helpers = createSceneHelpers(scene, camera, LIGHT_PALETTE);
    const geometry = helpers.grid.geometry;
    const material = helpers.grid.material;
    const colorVersion = (): number => {
      const attribute = geometry.getAttribute('color');
      if (!(attribute instanceof THREE.BufferAttribute)) throw new Error('colour attribute');
      return attribute.version;
    };
    const version = colorVersion();
    helpers.setPalette(DARK_PALETTE);
    expect(helpers.grid.geometry).toBe(geometry);
    expect(helpers.grid.material).toBe(material);
    expect(colorVersion()).toBeGreaterThan(version);
    expect(gridColors(helpers)).toEqual([...DARK_PALETTE.grid]);
  });

  it('GRID_BOUNDS is the box of the drawn grid', () => {
    const camera = new THREE.OrthographicCamera();
    const scene = new THREE.Scene();
    scene.add(camera);
    const helpers = createSceneHelpers(scene, camera, LIGHT_PALETTE);
    const box = new THREE.Box3().setFromObject(helpers.grid);
    const close = (a: readonly number[], b: readonly number[]): void => {
      a.forEach((v, i) => {
        expect(v).toBeCloseTo(b[i] ?? NaN);
      });
    };
    close(box.min.toArray(), GRID_BOUNDS.min);
    close(box.max.toArray(), GRID_BOUNDS.max);
  });
});

describe('SceneHelpers.setGridVisible (M24)', () => {
  it('hides and shows the grid, the lights stay', () => {
    const camera = new THREE.OrthographicCamera();
    const scene = new THREE.Scene();
    scene.add(camera);
    const helpers = createSceneHelpers(scene, camera, LIGHT_PALETTE);
    const lights = (): boolean[] =>
      scene.children.filter((child) => child instanceof THREE.Light).map((light) => light.visible);
    expect(helpers.grid.visible).toBe(true);

    helpers.setGridVisible(false);
    expect(helpers.grid.visible).toBe(false);
    expect(lights()).toEqual([true]);

    helpers.setGridVisible(true);
    expect(helpers.grid.visible).toBe(true);
  });
});
