// Orthographic camera with Onshape-like controls (spec 09, "Kamera"). The camera and its view
// live for the whole viewport; OrbitControls exist only while the viewport is mounted.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { assert, type Disposable, type Vec3 } from '@/core';
import type { BoundingBox } from '@/kernel';
import { fitOrtho, type StandardView } from './camera-math';
import { orbitDirection } from './orbit-direction';

export interface CameraController {
  /** Bounds of all bodies; an empty scene → the default 200 × 200 mm frame around the origin. */
  fitAll(): void;
  /** Sets the view direction and then fitAll(). */
  setView(view: StandardView): void;
}

/** What the viewport needs on top of CameraController; internal to render. */
export interface CameraRig extends CameraController, Disposable {
  readonly camera: THREE.OrthographicCamera;
  /** Creates OrbitControls on the element. Only one at a time. */
  attach(element: HTMLElement): void;
  /** Disposes OrbitControls; the camera keeps its view. Idempotent. */
  detach(): void;
  /** New canvas size in CSS px: recomputes the frustum, keeping the visible height. */
  resize(width: number, height: number): void;
}

export interface CameraRigOptions {
  /** Bounds of the shown bodies, null when there are none. */
  readonly getBounds: () => BoundingBox | null;
  readonly requestRender: () => void;
}

const Z_UP = new THREE.Vector3(0, 0, 1);

export function createCameraRig(options: CameraRigOptions): CameraRig {
  const { getBounds, requestRender } = options;
  const camera = new THREE.OrthographicCamera();
  // Before OrbitControls exist: they read `up` only in their constructor (spec 09).
  camera.up.copy(Z_UP);

  /** Target while detached; while attached, controls.target is the truth. */
  const target = new THREE.Vector3();
  let aspect = 1;
  let halfHeight = 1;
  let controls: OrbitControls | null = null;
  let disposed = false;

  const onChange = (): void => {
    requestRender();
  };

  function currentTarget(): THREE.Vector3 {
    return controls?.target ?? target;
  }

  function updateFrustum(): void {
    camera.left = -halfHeight * aspect;
    camera.right = halfHeight * aspect;
    camera.top = halfHeight;
    camera.bottom = -halfHeight;
    camera.updateProjectionMatrix();
  }

  /** Unit vector from the target towards the camera. */
  function currentDirection(): Vec3 {
    const d = camera.position.clone().sub(currentTarget()).normalize();
    // Camera on the target (never happens after a fit): fall back to iso.
    if (d.lengthSq() === 0) return orbitDirection('iso');
    return [d.x, d.y, d.z];
  }

  function fit(direction: Vec3): void {
    const f = fitOrtho(getBounds(), direction, aspect);
    halfHeight = f.halfHeight;
    camera.zoom = 1;
    camera.near = f.near;
    camera.far = f.far;
    const t = currentTarget().set(...f.target);
    camera.position
      .set(...direction)
      .multiplyScalar(f.distance)
      .add(t);
    camera.lookAt(t);
    updateFrustum();
    controls?.update();
    requestRender();
  }

  function assertAlive(): void {
    assert(!disposed, 'Camera used after dispose');
  }

  function detach(): void {
    if (controls === null) return;
    target.copy(controls.target);
    controls.removeEventListener('change', onChange);
    controls.dispose();
    controls = null;
  }

  return {
    camera,
    fitAll(): void {
      assertAlive();
      fit(currentDirection());
    },
    setView(view: StandardView): void {
      assertAlive();
      fit(orbitDirection(view));
    },
    attach(element: HTMLElement): void {
      assertAlive();
      assert(controls === null, 'Camera controls are already attached');
      const c = new OrbitControls(camera, element);
      // Left button belongs to selection (null = no camera action), right orbits, middle pans.
      c.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
      // Wheel zooms towards the cursor; on an orthographic camera it changes camera.zoom.
      c.zoomToCursor = true;
      // No damping: it needs a render loop, the viewport renders on demand only.
      c.enableDamping = false;
      c.target.copy(target);
      c.update();
      c.addEventListener('change', onChange);
      controls = c;
    },
    detach,
    resize(width: number, height: number): void {
      assertAlive();
      assert(width > 0 && height > 0, 'Canvas size must be positive');
      aspect = width / height;
      updateFrustum();
    },
    dispose(): void {
      if (disposed) return;
      detach();
      disposed = true;
    },
  };
}
