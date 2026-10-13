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
