// The contact shadow of Realistic (spec 09, "Realistic", "Kontaktní stín"; ADR 0027, point 8),
// after the three example webgl_shadow_contact: an orthographic camera at the bottom of the bodies
// looks up and renders their depth into a small target (near the floor = dark), the target is
// blurred twice and laid on a transparent plane just below the bodies. Recomputed only after
// invalidate (the bodies changed), never on a camera move. The GPU result is checked by e2e and by
// hand; the placement and the bookkeeping by unit tests with a fake renderer.

import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { HorizontalBlurShader } from 'three/addons/shaders/HorizontalBlurShader.js';
import { VerticalBlurShader } from 'three/addons/shaders/VerticalBlurShader.js';
import type { Disposable } from '@/core';
import type { BoundingBox } from '@/kernel';
import { aoExcluded, hideDuring, withoutBackground } from './scene-partition';

/** The camera covers the XY box of the bodies grown on every side by this part of its size. */
export const CONTACT_SHADOW_MARGIN = 0.25;
/** How deep the camera sees, as a part of the height of the box. */
export const CONTACT_SHADOW_HEIGHT = 0.5;
/** Side of the square render targets in px. */
export const CONTACT_SHADOW_RESOLUTION = 512;
/** Opacity of the shadow plane. */
export const CONTACT_SHADOW_OPACITY = 0.6;

/** The plane lies this part of the box height below its bottom, so it never fights the bottom faces. */
const PLANE_DROP = 0.001;
/** Blur of the first pair of passes in texels; the second pair blurs by BLUR_SECOND of it. */
const BLUR_TEXELS = 7;
const BLUR_SECOND = 0.4;

export interface ContactShadow extends Disposable {
  /** The shadow plane; a direct child of the scene, so in the AO pipeline it is interaction. */
  readonly group: THREE.Group;
  setVisible(visible: boolean): void;
  /**
   * Box of the shadow plane while it is visible (spec 09, "Obálka scény"): it is wider than the
   * bodies, so near/far must enclose it. Null when the plane or the group is hidden.
   */
  bounds(): BoundingBox | null;
  /** The bodies changed: recompute in the next update. */
  invalidate(): void;
  /**
   * Recomputes only after invalidate (and the first time); bounds null → the plane is hidden.
   * Stays dirty when the drawing throws, so the next update tries again.
   * `bodies` is a direct child of `scene`: every other child is hidden while the depth is drawn.
   * Leaves the render target and the clear colour of the renderer as they were.
   */
  update(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    bodies: THREE.Object3D,
    bounds: BoundingBox | null,
  ): void;
}

export function createContactShadow(): ContactShadow {
  const shadowTarget = new THREE.WebGLRenderTarget(
    CONTACT_SHADOW_RESOLUTION,
    CONTACT_SHADOW_RESOLUTION,
  );
  shadowTarget.texture.generateMipmaps = false;
  // Only colour: the blur passes have no depth test.
  const blurTarget = new THREE.WebGLRenderTarget(
    CONTACT_SHADOW_RESOLUTION,
    CONTACT_SHADOW_RESOLUTION,
    { depthBuffer: false },
  );
  blurTarget.texture.generateMipmaps = false;

  const camera = new THREE.OrthographicCamera();
  // Rotated half a turn about X: looks along +Z (up), its image "up" is world -Y.
  camera.rotation.x = Math.PI;

  const depthMaterial = createDepthMaterial();
  // The uniforms of the blur shaders, typed.
  const horizontalUniforms = {
    tDiffuse: new THREE.Uniform<THREE.Texture | null>(null),
    h: new THREE.Uniform(0),
  };
  const verticalUniforms = {
    tDiffuse: new THREE.Uniform<THREE.Texture | null>(null),
    v: new THREE.Uniform(0),
  };
  const horizontalBlur = new THREE.ShaderMaterial({
    uniforms: horizontalUniforms,
    vertexShader: HorizontalBlurShader.vertexShader,
    fragmentShader: HorizontalBlurShader.fragmentShader,
    depthTest: false,
    depthWrite: false,
  });
  const verticalBlur = new THREE.ShaderMaterial({
    uniforms: verticalUniforms,
    vertexShader: VerticalBlurShader.vertexShader,
    fragmentShader: VerticalBlurShader.fragmentShader,
    depthTest: false,
    depthWrite: false,
  });
  const quad = new FullScreenQuad(horizontalBlur);

  const planeGeometry = new THREE.PlaneGeometry(1, 1);
  const planeMaterial = new THREE.MeshBasicMaterial({
    map: shadowTarget.texture,
    transparent: true,
    opacity: CONTACT_SHADOW_OPACITY,
    depthWrite: false,
  });
  const plane = new THREE.Mesh(planeGeometry, planeMaterial);
  // Drawn after the opaque bodies like any transparent object; first among the transparent ones.
  plane.renderOrder = 1;
  plane.visible = false;
  const group = new THREE.Group();
  group.add(plane);

  let dirty = true;
  /** Box of the plane, kept by place(). */
  let planeBounds: BoundingBox | null = null;
  const savedClearColor = new THREE.Color();

  /**
   * Camera and plane over the box (spec 09: margin, depth, plane just below the bottom); false for
   * a box flat in XY or in Z, which casts no shadow and would give the camera an empty frustum.
   */
  function place(bounds: BoundingBox): boolean {
    const [minX, minY, minZ] = bounds.min;
    const [maxX, maxY, maxZ] = bounds.max;
    const size = Math.max(maxX - minX, maxY - minY);
    const height = maxZ - minZ;
    if (!(size > 0 && height > 0)) return false;
    // A square, like the target: one texel is as wide as high.
    const half = (size * (1 + 2 * CONTACT_SHADOW_MARGIN)) / 2;
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    camera.left = -half;
    camera.right = half;
    camera.top = half;
    camera.bottom = -half;
    camera.near = 0;
    camera.far = CONTACT_SHADOW_HEIGHT * height;
    camera.position.set(centerX, centerY, minZ);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();

    plane.position.set(centerX, centerY, minZ - PLANE_DROP * height);
    // The image of the camera has world -Y up, so the plane mirrors its texture in Y.
    plane.scale.set(2 * half, -2 * half, 1);
    const planeZ = minZ - PLANE_DROP * height;
    planeBounds = {
      min: [centerX - half, centerY - half, planeZ],
      max: [centerX + half, centerY + half, planeZ],
    };
    return true;
  }

  /** Depth → darkness into shadowTarget, then two blurs; the caller restores the renderer. */
  function render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, bodies: THREE.Object3D): void {
    renderer.setRenderTarget(shadowTarget);
    // Transparent black: the blur mixes the empty texels with the shadow and must not lighten it.
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    const hidden = [...scene.children.filter((child) => child !== bodies), ...aoExcluded([bodies])];
    withoutBackground(scene, () => {
      hideDuring(hidden, () => {
        const override = scene.overrideMaterial;
        scene.overrideMaterial = depthMaterial;
        try {
          renderer.render(scene, camera);
        } finally {
          scene.overrideMaterial = override;
        }
      });
    });
    blur(renderer, BLUR_TEXELS / CONTACT_SHADOW_RESOLUTION);
    blur(renderer, (BLUR_SECOND * BLUR_TEXELS) / CONTACT_SHADOW_RESOLUTION);
  }

  /** shadowTarget → blurTarget horizontally, back vertically. */
  function blur(renderer: THREE.WebGLRenderer, amount: number): void {
    horizontalUniforms.tDiffuse.value = shadowTarget.texture;
    horizontalUniforms.h.value = amount;
    quad.material = horizontalBlur;
    renderer.setRenderTarget(blurTarget);
    quad.render(renderer);

    verticalUniforms.tDiffuse.value = blurTarget.texture;
    verticalUniforms.v.value = amount;
    quad.material = verticalBlur;
    renderer.setRenderTarget(shadowTarget);
    quad.render(renderer);
  }

  return {
    group,
    setVisible(visible: boolean): void {
      group.visible = visible;
    },
    bounds(): BoundingBox | null {
      return group.visible && plane.visible ? planeBounds : null;
    },
    invalidate(): void {
      dirty = true;
    },
    update(renderer, scene, bodies, bounds): void {
      if (!dirty) return;
      plane.visible = bounds !== null && place(bounds);
      if (!plane.visible) {
        dirty = false;
        return;
      }

      const target = renderer.getRenderTarget();
      renderer.getClearColor(savedClearColor);
      const clearAlpha = renderer.getClearAlpha();
      try {
        render(renderer, scene, bodies);
        // Only after a successful draw: a throw leaves it dirty for the next update.
        dirty = false;
      } finally {
        // The target first: three converts the clear colour for the current target.
        renderer.setRenderTarget(target);
        renderer.setClearColor(savedClearColor, clearAlpha);
      }
    },
    dispose(): void {
      group.remove(plane);
      shadowTarget.dispose();
      blurTarget.dispose();
      depthMaterial.dispose();
      horizontalBlur.dispose();
      verticalBlur.dispose();
      quad.dispose();
      planeGeometry.dispose();
      planeMaterial.dispose();
    },
  };
}

/**
 * Override material of the depth pass: black with the alpha falling from 1 at the camera (the
 * floor) to 0 at its far plane. The camera is orthographic, so the depth is linear in z.
 * Writes and tests depth, so the lowest surface over a texel decides its darkness.
 */
function createDepthMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `
      varying float vDepth;
      void main() {
        gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
        vDepth = gl_Position.z / gl_Position.w * 0.5 + 0.5;
      }`,
    fragmentShader: /* glsl */ `
      varying float vDepth;
      void main() {
        gl_FragColor = vec4( vec3( 0.0 ), 1.0 - vDepth );
      }`,
  });
}
