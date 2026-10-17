import { describe, expect, it } from 'vitest';
import type { MeshQuality, ShapeHandle } from '@/kernel';
import { aMeshData } from '@/remote/testing';
import { createVersionMeshes } from '@/app/version-meshes';

const QUALITY: MeshQuality = { linearDeflection: 0.1, angularDeflection: 0.5 };

describe('createVersionMeshes', () => {
  it('gives every version a stable handle, counted from 1', () => {
    const meshes = createVersionMeshes();
    const a = meshes.handleOf('v-a');
    const b = meshes.handleOf('v-b');
    expect(a).toBe(1);
    expect(b).toBe(2);
    expect(meshes.handleOf('v-a')).toBe(a);
  });

  it('tessellates a handle into the mesh put under its version', async () => {
    const meshes = createVersionMeshes();
    const mesh = aMeshData();
    meshes.put('v-a', mesh);
    await expect(meshes.tessellate(meshes.handleOf('v-a'), QUALITY)).resolves.toBe(mesh);
  });

  it('keeps the first mesh of a version', async () => {
    const meshes = createVersionMeshes();
    const first = aMeshData();
    meshes.put('v-a', first);
    meshes.put('v-a', aMeshData());
    await expect(meshes.tessellate(meshes.handleOf('v-a'), QUALITY)).resolves.toBe(first);
  });

  it('rejects an unknown handle and a version without a mesh', async () => {
    const meshes = createVersionMeshes();
    const handle = meshes.handleOf('v-a');
    await expect(meshes.tessellate(handle, QUALITY)).rejects.toThrow(/v-a/);
    // A handle the meshes never minted.
    const foreign = 999 as ShapeHandle;
    await expect(meshes.tessellate(foreign, QUALITY)).rejects.toThrow(/Unknown mesh handle/);
  });

  it('drops other versions on retain but keeps their handles', async () => {
    const meshes = createVersionMeshes();
    meshes.put('v-a', aMeshData());
    meshes.put('v-b', aMeshData());
    const a = meshes.handleOf('v-a');
    meshes.retain(['v-b']);
    expect(meshes.versions()).toEqual(['v-b']);
    await expect(meshes.tessellate(a, QUALITY)).rejects.toThrow();
    expect(meshes.handleOf('v-a')).toBe(a);
  });

  it('lists the versions with a mesh', () => {
    const meshes = createVersionMeshes();
    meshes.handleOf('no-mesh');
    meshes.put('v-a', aMeshData());
    meshes.put('v-b', aMeshData());
    expect(meshes.versions()).toEqual(['v-a', 'v-b']);
  });
});
