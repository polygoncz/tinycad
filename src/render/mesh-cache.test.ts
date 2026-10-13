import { describe, expect, it } from 'vitest';
import type { MeshData, MeshOps, MeshQuality, ShapeHandle } from '@/kernel';
import { createMeshCache } from './mesh-cache';

// Branded ids are created by a cast in tests only.
const shape = (n: number): ShapeHandle => n as ShapeHandle;

const QUALITY: MeshQuality = { linearDeflection: 0.1, angularDeflection: 0.5 };

function aMesh(): MeshData {
  return {
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
    indices: new Uint32Array([0, 1, 2]),
    faceRanges: new Uint32Array([0, 0, 1]),
    edgePositions: new Float32Array([0, 0, 0, 1, 0, 0]),
    edgeRanges: new Uint32Array([0, 0, 2]),
  };
}

/** MeshOps whose every tessellate call returns a promise the test settles by hand. */
function manualMeshes() {
  const calls: {
    shape: ShapeHandle;
    quality: MeshQuality;
    resolve: (m: MeshData) => void;
    reject: (e: unknown) => void;
  }[] = [];
  const meshes: MeshOps = {
    tessellate: (s, quality) =>
      new Promise<MeshData>((resolve, reject) => {
        calls.push({ shape: s, quality, resolve, reject });
      }),
  };
  return { meshes, calls };
}

describe('createMeshCache', () => {
  it('shares one tessellate call between concurrent requests for the same handle', async () => {
    const { meshes, calls } = manualMeshes();
    const cache = createMeshCache(meshes, QUALITY);
    const first = cache.get(shape(1));
    const second = cache.get(shape(1));
    expect(calls).toHaveLength(1);
    expect(calls[0]?.quality).toBe(QUALITY);
    const mesh = aMesh();
    calls[0]?.resolve(mesh);
    expect(await first).toBe(mesh);
    expect(await second).toBe(mesh);
    await cache.get(shape(1));
    expect(calls).toHaveLength(1);
  });

  it('forgets a rejected promise so the next request tessellates again', async () => {
    const { meshes, calls } = manualMeshes();
    const cache = createMeshCache(meshes, QUALITY);
    const failed = cache.get(shape(1));
    calls[0]?.reject(new Error('boom'));
    await expect(failed).rejects.toThrow('boom');
    void cache.get(shape(1));
    expect(calls).toHaveLength(2);
  });

  it('retain forgets every handle not listed', () => {
    const { meshes, calls } = manualMeshes();
    const cache = createMeshCache(meshes, QUALITY);
    void cache.get(shape(1));
    void cache.get(shape(2));
    for (const call of calls) call.resolve(aMesh());
    cache.retain([shape(2)]);
    void cache.get(shape(2));
    expect(calls).toHaveLength(2);
    void cache.get(shape(1));
    expect(calls).toHaveLength(3);
  });

  it('clear forgets everything', () => {
    const { meshes, calls } = manualMeshes();
    const cache = createMeshCache(meshes, QUALITY);
    void cache.get(shape(1));
    cache.clear();
    void cache.get(shape(1));
    expect(calls).toHaveLength(2);
  });

  it('a late rejection of a forgotten promise does not drop the newer entry', async () => {
    const { meshes, calls } = manualMeshes();
    const cache = createMeshCache(meshes, QUALITY);
    const old = cache.get(shape(1));
    cache.clear();
    void cache.get(shape(1));
    calls[0]?.reject(new Error('stale'));
    await expect(old).rejects.toThrow('stale');
    void cache.get(shape(1));
    expect(calls).toHaveLength(2);
  });
});
