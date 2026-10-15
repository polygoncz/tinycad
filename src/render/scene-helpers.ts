// Static parts of the scene (spec 09, "Scéna"): grid in the XY plane and lights following the
// camera. Owns their GPU resources. The axes are drawn by the view cube since M17.

import * as THREE from 'three';
import type { Disposable } from '@/core';
import type { BoundingBox } from '@/kernel';
import type { ScenePalette } from './palette';

/** Grid size and cell in mm. */
const GRID_SIZE = 200;
const GRID_CELL = 10;
const GRID_DIVISIONS = GRID_SIZE / GRID_CELL;

/** Box of the grid (±100 mm in z = 0); part of what near/far enclose (spec 09, "Near a far"). */
export const GRID_BOUNDS: BoundingBox = {
  min: [-GRID_SIZE / 2, -GRID_SIZE / 2, 0],
  max: [GRID_SIZE / 2, GRID_SIZE / 2, 0],
};

export interface SceneHelpers extends Disposable {
  /** Recolours the grid in place (Q072); the caller requests the render. */
  setPalette(palette: ScenePalette): void;
  /** Shows or hides the grid (hidden in Realistic, M24); the caller requests the render. */
  setGridVisible(visible: boolean): void;
  /** The grid; exposed for tests of its colours. */
  readonly grid: THREE.GridHelper;
}

/**
 * Adds the grid and the lights to the scene. The camera must be in the scene: the directional
 * light is its child ("headlight"), so lighting follows the view as in CAD.
 */
export function createSceneHelpers(
  scene: THREE.Scene,
  camera: THREE.Camera,
  palette: ScenePalette,
): SceneHelpers {
  const [gridCenter, gridLine] = palette.grid;
  const grid = new THREE.GridHelper(GRID_SIZE, GRID_DIVISIONS, gridCenter, gridLine);
  // GridHelper lies in XZ; turned about X into XY (Z up).
  grid.rotation.x = Math.PI / 2;
  // The grid lies in z = 0 like the bottom faces of bodies standing on it, which would z-fight.
  // Drawn first and without writing depth, so a body drawn later always covers it.
  grid.material.depthWrite = false;
  grid.renderOrder = -1;
  scene.add(grid);

  const hemisphere = new THREE.HemisphereLight(0xffffff, 0x8a8f99, 0.8);
  // Hemisphere "sky" is +Z in a Z-up world.
  hemisphere.position.set(0, 0, 1);
  scene.add(hemisphere);

  // Light and target are both children of the camera, so the light shines along the view
  // direction (camera -Z), slightly from the upper left for some shading between faces.
  const headlight = new THREE.DirectionalLight(0xffffff, 2);
  headlight.position.set(-0.3, 0.4, 0);
  headlight.target.position.set(0, 0, -1);
  camera.add(headlight, headlight.target);

  return {
    grid,
    setPalette(next: ScenePalette): void {
      setGridColors(grid, next);
    },
    setGridVisible(visible: boolean): void {
      grid.visible = visible;
    },
    dispose(): void {
      scene.remove(grid, hemisphere);
      camera.remove(headlight, headlight.target);
      grid.geometry.dispose();
      grid.material.dispose();
      hemisphere.dispose();
      headlight.dispose();
    },
  };
}

/**
 * Centre line and the other lines by the palette; rewrites the colour attribute of the same
 * geometry. Mirrors the layout of GridHelper: divisions + 1 line pairs, four vertices each, the
 * pair at index divisions / 2 is the centre.
 */
function setGridColors(grid: THREE.GridHelper, palette: ScenePalette): void {
  const [center, line] = palette.grid;
  const centerColor = new THREE.Color(center);
  const lineColor = new THREE.Color(line);
  const attribute = grid.geometry.getAttribute('color');
  for (let i = 0; i <= GRID_DIVISIONS; i++) {
    const color = i === GRID_DIVISIONS / 2 ? centerColor : lineColor;
    for (let v = 0; v < 4; v++) attribute.setXYZ(i * 4 + v, color.r, color.g, color.b);
  }
  attribute.needsUpdate = true;
}
