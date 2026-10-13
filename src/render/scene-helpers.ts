// Static parts of the scene (spec 09, "Scéna"): grid in the XY plane, lights following the
// camera and the axis triad in the bottom-left corner. Owns their GPU resources.

import * as THREE from 'three';
import type { Disposable } from '@/core';
import type { ScenePalette } from './palette';

/** Grid size and cell in mm. */
const GRID_SIZE = 200;
const GRID_CELL = 10;
const GRID_DIVISIONS = GRID_SIZE / GRID_CELL;

/** Side of the axis triad viewport in CSS px. */
const AXES_SIZE = 120;
/** Distance of the triad camera from the origin; anything beyond the axis length works. */
const AXES_CAMERA_DISTANCE = 2;

export interface SceneHelpers extends Disposable {
  /**
   * Draws the axis triad over what is already drawn, in the bottom-left corner. Turned like the
   * main camera. Leaves the renderer's viewport and scissor test as it found them (full canvas).
   */
  drawAxes(renderer: THREE.WebGLRenderer, mainCamera: THREE.Camera): void;
  /** Recolours the grid and the axis triad in place (Q072); the caller requests the render. */
  setPalette(palette: ScenePalette): void;
  /** The axis triad; exposed for tests of its colours. */
  readonly axes: THREE.AxesHelper;
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

  const axesScene = new THREE.Scene();
  const axes = new THREE.AxesHelper(1);
  setAxisColors(axes, palette);
  axesScene.add(axes);
  const axesCamera = new THREE.OrthographicCamera(-1.2, 1.2, 1.2, -1.2, 0.1, 10);
  const viewDirection = new THREE.Vector3();

  return {
    axes,
    grid,
    setPalette(next: ScenePalette): void {
      setGridColors(grid, next);
      setAxisColors(axes, next);
    },
    drawAxes(renderer: THREE.WebGLRenderer, mainCamera: THREE.Camera): void {
      // Same rotation as the main camera, looking at the origin of the triad scene.
      mainCamera.getWorldDirection(viewDirection);
      mainCamera.getWorldQuaternion(axesCamera.quaternion);
      axesCamera.position.copy(viewDirection).multiplyScalar(-AXES_CAMERA_DISTANCE);
      axesCamera.updateMatrixWorld();

      const size = renderer.getSize(new THREE.Vector2());
      const side = Math.min(AXES_SIZE, size.x, size.y);
      // The colour of the main scene stays; only depth is cleared so the triad is never hidden.
      renderer.clearDepth();
      renderer.setScissorTest(true);
      renderer.setScissor(0, 0, side, side);
      renderer.setViewport(0, 0, side, side);
      renderer.render(axesScene, axesCamera);
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, size.x, size.y);
    },
    dispose(): void {
      scene.remove(grid, hemisphere);
      camera.remove(headlight, headlight.target);
      grid.geometry.dispose();
      grid.material.dispose();
      hemisphere.dispose();
      headlight.dispose();
      axes.dispose();
    },
  };
}

/** X, Y, Z by the palette; rewrites the colour attribute of the same geometry. */
function setAxisColors(axes: THREE.AxesHelper, palette: ScenePalette): void {
  const [x, y, z] = palette.axes;
  axes.setColors(new THREE.Color(x), new THREE.Color(y), new THREE.Color(z));
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
