// Test helpers of render; only *.test.ts may import this file. render may not use the
// FakeKernel (kernel is a type-only dependency), so its tests build meshes by hand.

import type { Vec3 } from '@/core';
import type { MeshData, MeshOps, ShapeHandle } from '@/kernel';

/**
 * An axis-aligned box as 6 faces of 2 triangles (24 vertices, flat normals, counter-clockwise
 * seen from outside) in order −X, +X, −Y, +Y, −Z, +Z, and 12 edges of 2 points. Same layout as
 * the FakeKernel's box mesh.
 */
export function aBoxMesh(min: Vec3, max: Vec3): MeshData {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const faceRanges: number[] = [];
  const corner = (k: number, high: boolean): number => (high ? max[k] : min[k]) ?? Number.NaN;
  const square = [
    [false, false],
    [true, false],
    [true, true],
    [false, true],
  ] as const;

  for (let axis = 0; axis < 3; axis++) {
    const u = (axis + 1) % 3;
    const v = (axis + 2) % 3;
    for (const sign of [-1, 1] as const) {
      const face = faceRanges.length / 3;
      const first = positions.length / 3;
      // (u, v, axis) is right-handed: this order runs counter-clockwise seen from +axis.
      for (const [uHigh, vHigh] of sign > 0 ? square : [...square].reverse()) {
        const p = [0, 0, 0];
        const n = [0, 0, 0];
        p[axis] = corner(axis, sign > 0);
        p[u] = corner(u, uHigh);
        p[v] = corner(v, vHigh);
        n[axis] = sign;
        positions.push(...p);
        normals.push(...n);
      }
      indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
      faceRanges.push(face, 2 * face, 2);
    }
  }

  const edgePositions: number[] = [];
  const edgeRanges: number[] = [];
  for (let axis = 0; axis < 3; axis++) {
    const u = (axis + 1) % 3;
    const v = (axis + 2) % 3;
    for (const [uHigh, vHigh] of square) {
      const edge = edgeRanges.length / 3;
      for (const high of [false, true]) {
        const p = [0, 0, 0];
        p[axis] = corner(axis, high);
        p[u] = corner(u, uHigh);
        p[v] = corner(v, vHigh);
        edgePositions.push(...p);
      }
      edgeRanges.push(edge, 2 * edge, 2);
    }
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint32Array(indices),
    faceRanges: new Uint32Array(faceRanges),
    edgePositions: new Float32Array(edgePositions),
    edgeRanges: new Uint32Array(edgeRanges),
  };
}

/** MeshOps whose every shape is the box from (0, 0, 0) of size `handle` mm, resolved at once. */
export function boxMeshes(): MeshOps {
  return {
    tessellate: (shape: ShapeHandle) => {
      const size = Number(shape);
      return Promise.resolve(aBoxMesh([0, 0, 0], [size, size, size]));
    },
  };
}
