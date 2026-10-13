// Static parts of the scene (spec 09, "Scéna"): grid in the XY plane, lights following the
// camera and the axis triad in the bottom-left corner. Owns their GPU resources.

import * as THREE from 'three';
import type { Disposable } from '@/core';

/** Grid size and cell in mm. */
const GRID_SIZE = 200;
const GRID_CELL = 10;
const GRID_CENTER_COLOR = 0xb4b9c1;
const GRID_COLOR = 0xd5d8dd;

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
}

/**
 * Adds the grid and the lights to the scene. The camera must be in the scene: the directional
 * light is its child ("headlight"), so lighting follows the view as in CAD.
 */
export function createSceneHelpers(scene: THREE.Scene, camera: THREE.Camera): SceneHelpers {
  const grid = new THREE.GridHelper(
    GRID_SIZE,
    GRID_SIZE / GRID_CELL,
    GRID_CENTER_COLOR,
    GRID_COLOR,
  );
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
  // X red, Y green, Z blue.
  axes.setColors(new THREE.Color(0xe53935), new THREE.Color(0x43a047), new THREE.Color(0x1e88e5));
  axesScene.add(axes);
  const axesCamera = new THREE.OrthographicCamera(-1.2, 1.2, 1.2, -1.2, 0.1, 10);
  const viewDirection = new THREE.Vector3();

  return {
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
