import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { DARK_PALETTE, LIGHT_PALETTE, type ScenePalette } from './palette';
import { createSceneHelpers } from './scene-helpers';

/** Colours of the axis triad's three lines (each line has two vertices of the same colour). */
function axisColors(helpers: ReturnType<typeof createSceneHelpers>): number[] {
  const attribute = helpers.axes.geometry.getAttribute('color');
  const color = new THREE.Color();
  return [0, 2, 4].map((vertex) => color.fromBufferAttribute(attribute, vertex).getHex());
}

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

const axesOf = (palette: ScenePalette): number[] => [...palette.axes];

describe('SceneHelpers palette', () => {
  it('colours the axes by the given palette', () => {
    const camera = new THREE.OrthographicCamera();
    const scene = new THREE.Scene();
    scene.add(camera);
    const helpers = createSceneHelpers(scene, camera, LIGHT_PALETTE);
    expect(axisColors(helpers)).toEqual(axesOf(LIGHT_PALETTE));
  });

  it('setPalette recolours the axes in the same geometry', () => {
    const camera = new THREE.OrthographicCamera();
    const scene = new THREE.Scene();
    scene.add(camera);
    const helpers = createSceneHelpers(scene, camera, LIGHT_PALETTE);
    const geometry = helpers.axes.geometry;
    const material = helpers.axes.material;
    helpers.setPalette(DARK_PALETTE);
    expect(helpers.axes.geometry).toBe(geometry);
    expect(helpers.axes.material).toBe(material);
    expect(axisColors(helpers)).toEqual(axesOf(DARK_PALETTE));
  });
});

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
});
