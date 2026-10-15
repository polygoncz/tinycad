import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { describe, expect, it } from 'vitest';
import {
  aoExcluded,
  hideDuring,
  partitionScene,
  withoutBackground,
} from '@/render/scene-partition';

describe('partitionScene', () => {
  it('takes the model only from the given groups and the rest of the children as interaction', () => {
    const scene = new THREE.Scene();
    const main = new THREE.Group();
    const preview = new THREE.Group();
    const overlay = new THREE.Group();
    scene.add(main, preview, overlay);

    const partition = partitionScene(scene, [main]);

    expect(partition.model).toEqual([main]);
    expect(partition.interaction).toEqual([preview, overlay]);
  });

  it('leaves the lights and the camera out of the interaction', () => {
    const scene = new THREE.Scene();
    const main = new THREE.Group();
    const light = new THREE.HemisphereLight();
    const camera = new THREE.OrthographicCamera();
    camera.add(new THREE.DirectionalLight());
    const grid = new THREE.Group();
    scene.add(light, main, camera, grid);

    const partition = partitionScene(scene, [main]);

    expect(partition.interaction).toEqual([grid]);
  });
});

describe('aoExcluded', () => {
  it('finds LineSegments2 even deep in the subtree, not Mesh or LineSegments', () => {
    const root = new THREE.Group();
    const top = new LineSegments2();
    const inner = new THREE.Group();
    const deeper = new THREE.Group();
    const deep = new LineSegments2();
    root.add(top, inner, new THREE.Mesh(), new THREE.LineSegments());
    inner.add(deeper);
    deeper.add(deep, new THREE.Mesh());

    expect(aoExcluded([root])).toEqual([top, deep]);
  });

  it('gives nothing without fat lines', () => {
    const root = new THREE.Group();
    root.add(new THREE.Mesh(), new THREE.LineSegments());
    expect(aoExcluded([root])).toEqual([]);
  });

  it('finds meshes with a transmissive material (glass, M24), not opaque physical ones', () => {
    const root = new THREE.Group();
    const glass = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshPhysicalMaterial({ transmission: 1 }),
    );
    const steel = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshPhysicalMaterial({ transmission: 0, metalness: 1 }),
    );
    const inner = new THREE.Group();
    const deepGlass = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshPhysicalMaterial({ transmission: 0.5 }),
    );
    inner.add(deepGlass);
    root.add(glass, steel, new THREE.Mesh(), inner);

    expect(aoExcluded([root])).toEqual([glass, deepGlass]);
  });

  it('finds a mesh with a transmissive material among several', () => {
    const root = new THREE.Group();
    const multi = new THREE.Mesh(new THREE.BufferGeometry(), [
      new THREE.MeshStandardMaterial(),
      new THREE.MeshPhysicalMaterial({ transmission: 1 }),
    ]);
    root.add(multi);

    expect(aoExcluded([root])).toEqual([multi]);
  });

  it('relies on GTAOPass not hiding LineSegments2 by itself (it has no isLine2)', () => {
    // GTAOPass overrides the visibility only of isPoints, isLine and isLine2 (ADR 0026).
    const line: object = new LineSegments2();
    expect('isLine2' in line).toBe(false);
    expect('isLine' in line).toBe(false);
  });
});

describe('hideDuring', () => {
  it('hides the objects during fn and returns its result', () => {
    const a = new THREE.Group();
    const b = new THREE.Mesh();
    const seen: boolean[] = [];

    const result = hideDuring([a, b], () => {
      seen.push(a.visible, b.visible);
      return 42;
    });

    expect(seen).toEqual([false, false]);
    expect(result).toBe(42);
  });

  it('restores the original values, a hidden object stays hidden', () => {
    const shown = new THREE.Group();
    const hidden = new THREE.Group();
    hidden.visible = false;

    hideDuring([shown, hidden], () => undefined);

    expect(shown.visible).toBe(true);
    expect(hidden.visible).toBe(false);
  });

  it('restores the values when fn throws and passes the error on', () => {
    const a = new THREE.Group();
    const error = new Error('boom');

    expect(() =>
      hideDuring([a], () => {
        throw error;
      }),
    ).toThrow(error);
    expect(a.visible).toBe(true);
  });

  it('restores a duplicate object correctly', () => {
    const a = new THREE.Group();
    let during = true;

    hideDuring([a, a], () => {
      during = a.visible;
    });

    expect(during).toBe(false);
    expect(a.visible).toBe(true);
  });
});

describe('withoutBackground', () => {
  it('clears the background during fn, restores it and returns the result', () => {
    const scene = new THREE.Scene();
    const background = new THREE.Texture();
    scene.background = background;
    let during: unknown = undefined;

    const result = withoutBackground(scene, () => {
      during = scene.background;
      return 7;
    });

    expect(during).toBeNull();
    expect(result).toBe(7);
    expect(scene.background).toBe(background);
  });

  it('restores the background when fn throws and passes the error on', () => {
    const scene = new THREE.Scene();
    const background = new THREE.Color(0x123456);
    scene.background = background;
    const error = new Error('boom');

    expect(() =>
      withoutBackground(scene, () => {
        throw error;
      }),
    ).toThrow(error);
    expect(scene.background).toBe(background);
  });

  it('keeps a scene without a background without one', () => {
    const scene = new THREE.Scene();
    withoutBackground(scene, () => undefined);
    expect(scene.background).toBeNull();
  });
});
