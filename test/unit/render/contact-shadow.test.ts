import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BoundingBox } from '@/kernel';
import {
  CONTACT_SHADOW_HEIGHT,
  CONTACT_SHADOW_MARGIN,
  CONTACT_SHADOW_OPACITY,
  CONTACT_SHADOW_RESOLUTION,
  createContactShadow,
  type ContactShadow,
} from '@/render/contact-shadow';

/** What the fake renderer saw at one render call. */
interface RenderCall {
  readonly object: THREE.Object3D;
  readonly camera: THREE.Camera;
  readonly target: THREE.WebGLRenderTarget | null;
  readonly override: THREE.Material | null;
  readonly background: unknown;
  /** visible of the watched objects at the time of the call. */
  readonly visible: readonly boolean[];
}

interface ClearCall {
  readonly target: THREE.WebGLRenderTarget | null;
  readonly color: number;
  readonly alpha: number;
}

/**
 * The part of WebGLRenderer the contact shadow uses, recording what it is asked to do. No WebGL
 * in Node, so the GPU result itself is checked by e2e and by hand.
 */
function fakeRenderer(scene: THREE.Scene, watched: readonly THREE.Object3D[] = []) {
  const renders: RenderCall[] = [];
  const clears: ClearCall[] = [];
  let target: THREE.WebGLRenderTarget | null = null;
  const clearColor = new THREE.Color(0xf3f4f6);
  let clearAlpha = 1;
  const fake = {
    autoClear: false,
    getRenderTarget: () => target,
    setRenderTarget: (next: THREE.WebGLRenderTarget | null) => {
      target = next;
    },
    getClearColor: (out: THREE.Color) => out.copy(clearColor),
    getClearAlpha: () => clearAlpha,
    setClearColor: (color: THREE.ColorRepresentation, alpha?: number) => {
      clearColor.set(color);
      if (alpha !== undefined) clearAlpha = alpha;
    },
    setClearAlpha: (alpha: number) => {
      clearAlpha = alpha;
    },
    clear: () => {
      clears.push({ target, color: clearColor.getHex(), alpha: clearAlpha });
    },
    render: (object: THREE.Object3D, camera: THREE.Camera) => {
      renders.push({
        object,
        camera,
        target,
        override: scene.overrideMaterial,
        background: scene.background,
        visible: watched.map((o) => o.visible),
      });
    },
  };
  return {
    // Only the methods above are called; a full WebGLRenderer needs a WebGL context.
    renderer: fake as unknown as THREE.WebGLRenderer,
    renders,
    clears,
    state: () => ({
      target,
      color: clearColor.getHex(),
      alpha: clearAlpha,
      autoClear: fake.autoClear,
    }),
  };
}

const BOUNDS: BoundingBox = { min: [0, 0, 10], max: [40, 20, 30] };

function setup(): {
  scene: THREE.Scene;
  bodies: THREE.Group;
  shadow: ContactShadow;
  plane: THREE.Mesh;
} {
  const scene = new THREE.Scene();
  const bodies = new THREE.Group();
  scene.add(bodies);
  const shadow = createContactShadow();
  scene.add(shadow.group);
  const plane: unknown = shadow.group.children.find((child) => child instanceof THREE.Mesh);
  if (!(plane instanceof THREE.Mesh)) throw new Error('no shadow plane');
  return { scene, bodies, shadow, plane: plane as THREE.Mesh }; // instanceof gives Mesh<any>
}

/** NDC of a world point by an orthographic camera. */
function ndc(camera: THREE.Camera, point: THREE.Vector3): THREE.Vector3 {
  camera.updateMatrixWorld();
  return point.clone().project(camera);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createContactShadow', () => {
  it('has the constants of spec 09', () => {
    expect(CONTACT_SHADOW_MARGIN).toBe(0.25);
    expect(CONTACT_SHADOW_HEIGHT).toBe(0.5);
    expect(CONTACT_SHADOW_RESOLUTION).toBe(512);
    expect(CONTACT_SHADOW_OPACITY).toBe(0.6);
  });

  it('the plane is a transparent textured plane that writes no depth', () => {
    const { plane } = setup();
    const material = plane.material;
    if (!(material instanceof THREE.MeshBasicMaterial)) throw new Error('MeshBasicMaterial');
    expect(material.transparent).toBe(true);
    expect(material.depthWrite).toBe(false);
    expect(material.opacity).toBe(CONTACT_SHADOW_OPACITY);
    expect(material.map).not.toBeNull();
  });

  it('places the plane just below the bottom of the bounds, over the box grown by the margin', () => {
    const { scene, bodies, shadow, plane } = setup();
    shadow.update(fakeRenderer(scene).renderer, scene, bodies, BOUNDS);

    expect(plane.visible).toBe(true);
    const side = 40 * (1 + 2 * CONTACT_SHADOW_MARGIN);
    plane.updateMatrixWorld();
    const box = new THREE.Box3().setFromObject(plane);
    expect(box.min.x).toBeCloseTo(20 - side / 2);
    expect(box.max.x).toBeCloseTo(20 + side / 2);
    expect(box.min.y).toBeCloseTo(10 - side / 2);
    expect(box.max.y).toBeCloseTo(10 + side / 2);
    // 0.1 % of the height of the box below its bottom.
    expect(box.min.z).toBeCloseTo(10 - 0.001 * 20);
    expect(box.max.z).toBeCloseTo(10 - 0.001 * 20);
  });

  it('renders the depth with an orthographic camera at the bottom looking up over the plane', () => {
    const { scene, bodies, shadow } = setup();
    const fake = fakeRenderer(scene);
    shadow.update(fake.renderer, scene, bodies, BOUNDS);

    const depth = fake.renders.find((call) => call.object === scene);
    if (depth === undefined) throw new Error('no depth render');
    const camera = depth.camera;
    if (!(camera instanceof THREE.OrthographicCamera)) throw new Error('orthographic');
    camera.updateMatrixWorld();
    expect(camera.getWorldPosition(new THREE.Vector3()).toArray()).toEqual([20, 10, 10]);
    const direction = camera.getWorldDirection(new THREE.Vector3());
    expect(direction.z).toBeCloseTo(1);
    const side = 40 * (1 + 2 * CONTACT_SHADOW_MARGIN);
    expect(camera.right - camera.left).toBeCloseTo(side);
    expect(camera.top - camera.bottom).toBeCloseTo(side);
    expect(camera.near).toBe(0);
    expect(camera.far).toBeCloseTo(CONTACT_SHADOW_HEIGHT * 20);
  });

  it('maps the texture so the shadow lies right under what cast it', () => {
    const { scene, bodies, shadow, plane } = setup();
    const fake = fakeRenderer(scene);
    shadow.update(fake.renderer, scene, bodies, BOUNDS);
    const camera = fake.renders.find((call) => call.object === scene)?.camera;
    if (camera === undefined) throw new Error('no depth render');
    plane.updateMatrixWorld();
    const inverse = plane.matrixWorld.clone().invert();

    for (const [x, y] of [
      [0, 0],
      [40, 0],
      [5, 18],
      [33, 4],
    ] as const) {
      const world = new THREE.Vector3(x, y, 12);
      const image = ndc(camera, world);
      // PlaneGeometry(1, 1): local -0.5..0.5 maps to uv 0..1.
      const local = new THREE.Vector3(x, y, 10).applyMatrix4(inverse);
      expect(local.x + 0.5).toBeCloseTo((image.x + 1) / 2);
      expect(local.y + 0.5).toBeCloseTo((image.y + 1) / 2);
    }
  });

  it('renders only the bodies, without the background, with an override, then restores everything', () => {
    const scene = new THREE.Scene();
    const background = new THREE.Texture();
    scene.background = background;
    const bodies = new THREE.Group();
    const faces = new THREE.Mesh(new THREE.BoxGeometry());
    const edges = new LineSegments2();
    const hiddenBody = new THREE.Mesh(new THREE.BoxGeometry());
    hiddenBody.visible = false;
    bodies.add(faces, edges, hiddenBody);
    const preview = new THREE.Group();
    const overlay = new THREE.Group();
    const light = new THREE.HemisphereLight();
    scene.add(bodies, preview, overlay, light);
    const shadow = createContactShadow();
    scene.add(shadow.group);
    const watched = [bodies, faces, edges, hiddenBody, preview, overlay, shadow.group];
    const fake = fakeRenderer(scene, watched);

    shadow.update(fake.renderer, scene, bodies, BOUNDS);

    const depth = fake.renders.find((call) => call.object === scene);
    if (depth === undefined) throw new Error('no depth render');
    expect(depth.background).toBeNull();
    expect(depth.override).not.toBeNull();
    // bodies, faces visible; the fat lines, the hidden body, the other groups and the plane not.
    expect(depth.visible).toEqual([true, true, false, false, false, false, false]);
    expect(depth.target).not.toBeNull();

    expect(scene.background).toBe(background);
    expect(scene.overrideMaterial).toBeNull();
    expect(watched.map((o) => o.visible)).toEqual([true, true, true, false, true, true, true]);
  });

  it('clears the shadow target to transparent black and leaves the state of the renderer as it was', () => {
    const { scene, bodies, shadow } = setup();
    const fake = fakeRenderer(scene);
    const before = fake.state();

    shadow.update(fake.renderer, scene, bodies, BOUNDS);

    const depth = fake.renders.find((call) => call.object === scene);
    expect(fake.clears).toEqual([{ target: depth?.target, color: 0x000000, alpha: 0 }]);
    expect(fake.state()).toEqual(before);
  });

  it('blurs twice through a second target and ends in the texture of the plane', () => {
    const { scene, bodies, shadow, plane } = setup();
    const fake = fakeRenderer(scene);
    shadow.update(fake.renderer, scene, bodies, BOUNDS);

    // depth, then two blurs of two passes each (horizontal, vertical).
    expect(fake.renders).toHaveLength(5);
    const [depth, ...blurs] = fake.renders;
    const shadowTarget = depth?.target;
    const blurTarget = blurs[0]?.target;
    expect(blurTarget).not.toBe(shadowTarget);
    expect(blurs.map((call) => call.target)).toEqual([
      blurTarget,
      shadowTarget,
      blurTarget,
      shadowTarget,
    ]);
    const material = plane.material;
    if (!(material instanceof THREE.MeshBasicMaterial)) throw new Error('MeshBasicMaterial');
    expect(material.map).toBe(shadowTarget?.texture);
  });

  it('recomputes only after invalidate, once', () => {
    const { scene, bodies, shadow } = setup();
    const fake = fakeRenderer(scene);

    shadow.update(fake.renderer, scene, bodies, BOUNDS);
    const first = fake.renders.length;
    expect(first).toBeGreaterThan(0);

    shadow.update(fake.renderer, scene, bodies, BOUNDS);
    expect(fake.renders).toHaveLength(first);

    shadow.invalidate();
    shadow.update(fake.renderer, scene, bodies, BOUNDS);
    expect(fake.renders).toHaveLength(2 * first);

    shadow.update(fake.renderer, scene, bodies, BOUNDS);
    expect(fake.renders).toHaveLength(2 * first);
  });

  it('follows new bounds after invalidate', () => {
    const { scene, bodies, shadow, plane } = setup();
    const fake = fakeRenderer(scene);
    shadow.update(fake.renderer, scene, bodies, BOUNDS);

    shadow.invalidate();
    shadow.update(fake.renderer, scene, bodies, { min: [-10, -10, -5], max: [10, 10, 5] });

    plane.updateMatrixWorld();
    const box = new THREE.Box3().setFromObject(plane);
    expect(box.min.z).toBeCloseTo(-5 - 0.001 * 10);
    expect(box.getCenter(new THREE.Vector3()).x).toBeCloseTo(0);
  });

  it('hides the plane without bounds and renders nothing', () => {
    const { scene, bodies, shadow, plane } = setup();
    const fake = fakeRenderer(scene);
    shadow.update(fake.renderer, scene, bodies, BOUNDS);
    const first = fake.renders.length;

    shadow.invalidate();
    shadow.update(fake.renderer, scene, bodies, null);

    expect(plane.visible).toBe(false);
    expect(fake.renders).toHaveLength(first);

    shadow.invalidate();
    shadow.update(fake.renderer, scene, bodies, BOUNDS);
    expect(plane.visible).toBe(true);
  });

  it('hides the plane for a box flat in Z and renders nothing', () => {
    const { scene, bodies, shadow, plane } = setup();
    const fake = fakeRenderer(scene);

    shadow.update(fake.renderer, scene, bodies, { min: [0, 0, 5], max: [10, 10, 5] });

    expect(plane.visible).toBe(false);
    expect(fake.renders).toHaveLength(0);
  });

  it('bounds are the box of the plane while it is visible, else null', () => {
    const { scene, bodies, shadow, plane } = setup();
    expect(shadow.bounds()).toBeNull();

    shadow.update(fakeRenderer(scene).renderer, scene, bodies, BOUNDS);
    plane.updateMatrixWorld();
    const box = new THREE.Box3().setFromObject(plane);
    const bounds = shadow.bounds();
    if (bounds === null) throw new Error('bounds of the visible plane');
    for (const [i, value] of bounds.min.entries()) {
      expect(value).toBeCloseTo(box.min.getComponent(i));
    }
    for (const [i, value] of bounds.max.entries()) {
      expect(value).toBeCloseTo(box.max.getComponent(i));
    }
    // The plane is wider than the bodies: that is why it belongs to the scene bounds.
    expect(bounds.min[0]).toBeLessThan(BOUNDS.min[0]);

    shadow.setVisible(false);
    expect(shadow.bounds()).toBeNull();
    shadow.setVisible(true);
    expect(shadow.bounds()).not.toBeNull();

    shadow.invalidate();
    shadow.update(fakeRenderer(scene).renderer, scene, bodies, null);
    expect(shadow.bounds()).toBeNull();
  });

  it('setVisible shows and hides the group', () => {
    const { shadow } = setup();
    shadow.setVisible(false);
    expect(shadow.group.visible).toBe(false);
    shadow.setVisible(true);
    expect(shadow.group.visible).toBe(true);
  });

  it('restores the renderer and the scene when a render throws', () => {
    const { scene, bodies, shadow } = setup();
    const background = new THREE.Color(0x101010);
    scene.background = background;
    const fake = fakeRenderer(scene);
    const before = fake.state();
    const failing = fake.renderer;
    vi.spyOn(failing, 'render').mockImplementation(() => {
      throw new Error('lost context');
    });

    expect(() => {
      shadow.update(failing, scene, bodies, BOUNDS);
    }).toThrow('lost context');
    expect(fake.state()).toEqual(before);
    expect(scene.background).toBe(background);
    expect(scene.overrideMaterial).toBeNull();
    expect(shadow.group.visible).toBe(true);
  });

  it('stays dirty after a render that throws and retries in the next update', () => {
    const { scene, bodies, shadow } = setup();
    const fake = fakeRenderer(scene);
    const render = vi.spyOn(fake.renderer, 'render').mockImplementationOnce(() => {
      throw new Error('lost context');
    });

    expect(() => {
      shadow.update(fake.renderer, scene, bodies, BOUNDS);
    }).toThrow('lost context');
    const failed = render.mock.calls.length;

    shadow.update(fake.renderer, scene, bodies, BOUNDS);
    expect(render.mock.calls.length).toBeGreaterThan(failed);
    const retried = render.mock.calls.length;

    shadow.update(fake.renderer, scene, bodies, BOUNDS);
    expect(render.mock.calls).toHaveLength(retried);
  });

  it('dispose releases both targets, the materials and the geometry', () => {
    const disposeTarget = vi.spyOn(THREE.WebGLRenderTarget.prototype, 'dispose');
    const { scene, bodies, shadow, plane } = setup();
    shadow.update(fakeRenderer(scene).renderer, scene, bodies, BOUNDS);
    const released: string[] = [];
    const material = plane.material;
    if (!(material instanceof THREE.Material)) throw new Error('one material');
    material.addEventListener('dispose', () => released.push('plane material'));
    plane.geometry.addEventListener('dispose', () => released.push('plane geometry'));

    shadow.dispose();

    expect(disposeTarget).toHaveBeenCalledTimes(2);
    expect(released.sort()).toEqual(['plane geometry', 'plane material']);
  });
});
