import { describe, expect, it } from 'vitest';
import { vec3, type Vec3 } from '@/core';
import { viewBasis } from './camera-math';
import {
  buildViewCube,
  cubeRegionAt,
  faceLabelBasis,
  regionKey,
  type CubeRegion,
  type ViewCubeMesh,
} from './view-cube-geometry';

function vertex(array: Float32Array, i: number): Vec3 {
  return [array[3 * i] ?? NaN, array[3 * i + 1] ?? NaN, array[3 * i + 2] ?? NaN];
}

function uv(mesh: ViewCubeMesh, i: number): readonly [number, number] {
  return [mesh.uvs[2 * i] ?? NaN, mesh.uvs[2 * i + 1] ?? NaN];
}

/** Vertex indices of every triangle of the group. */
function triangles(mesh: ViewCubeMesh, start: number, count: number): (readonly number[])[] {
  const result: (readonly number[])[] = [];
  for (let i = start; i < start + count; i += 3)
    result.push([mesh.index[i] ?? -1, mesh.index[i + 1] ?? -1, mesh.index[i + 2] ?? -1]);
  return result;
}

function nonZero(region: CubeRegion): number {
  return region.filter((c) => c !== 0).length;
}

const FACES: readonly CubeRegion[] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

describe('buildViewCube', () => {
  const mesh = buildViewCube();
  const vertexCount = mesh.positions.length / 3;

  it('has 26 groups with distinct regions: 6 faces, 12 edges, 8 corners', () => {
    expect(mesh.groups).toHaveLength(26);
    expect(new Set(mesh.groups.map((g) => regionKey(g.region))).size).toBe(26);
    const counts = [1, 2, 3].map((n) => mesh.groups.filter((g) => nonZero(g.region) === n).length);
    expect(counts).toEqual([6, 12, 8]);
  });

  it('has consistent buffer sizes and indices in range', () => {
    expect(mesh.normals.length).toBe(mesh.positions.length);
    expect(mesh.uvs.length / 2).toBe(vertexCount);
    expect(mesh.index.length % 3).toBe(0);
    for (const i of mesh.index) {
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(vertexCount);
    }
  });

  it('groups cover the whole index buffer without overlap', () => {
    let next = 0;
    for (const g of mesh.groups) {
      expect(g.start).toBe(next);
      expect(g.count % 3).toBe(0);
      next += g.count;
    }
    expect(next).toBe(mesh.index.length);
  });

  it('has unit normals pointing outwards and front faces wound counter-clockwise', () => {
    for (const g of mesh.groups) {
      for (const [a, b, c] of triangles(mesh, g.start, g.count)) {
        const pa = vertex(mesh.positions, a ?? -1);
        const pb = vertex(mesh.positions, b ?? -1);
        const pc = vertex(mesh.positions, c ?? -1);
        const centroid = vec3.scale(vec3.add(vec3.add(pa, pb), pc), 1 / 3);
        const winding = vec3.cross(vec3.sub(pb, pa), vec3.sub(pc, pa));
        for (const i of [a, b, c]) {
          const n = vertex(mesh.normals, i ?? -1);
          expect(vec3.length(n)).toBeCloseTo(1, 6);
          expect(vec3.dot(n, centroid)).toBeGreaterThan(0);
          expect(vec3.dot(n, winding)).toBeGreaterThan(0);
        }
      }
    }
  });

  it('normals of a region are the normalised sum of its face normals', () => {
    for (const g of mesh.groups) {
      const expected = vec3.normalize(g.region);
      for (const [a] of triangles(mesh, g.start, g.count)) {
        expect(vec3.equals(vertex(mesh.normals, a ?? -1), expected, 1e-6)).toBe(true);
      }
    }
  });

  it('every triangle of a group lies in the region of the group', () => {
    for (const g of mesh.groups) {
      for (const [a, b, c] of triangles(mesh, g.start, g.count)) {
        const centroid = vec3.scale(
          vec3.add(
            vec3.add(vertex(mesh.positions, a ?? -1), vertex(mesh.positions, b ?? -1)),
            vertex(mesh.positions, c ?? -1),
          ),
          1 / 3,
        );
        expect(regionKey(cubeRegionAt(centroid) ?? [0, 0, 0])).toBe(regionKey(g.region));
      }
    }
  });

  it('lies on the cube with half edge 1', () => {
    for (let i = 0; i < vertexCount; i++) {
      const p = vertex(mesh.positions, i);
      expect(Math.max(...p.map(Math.abs))).toBeCloseTo(1, 6);
    }
  });

  it('face UVs run 0..1 along the label basis (u along right, v along up)', () => {
    for (const face of FACES) {
      const g = mesh.groups.find((group) => regionKey(group.region) === regionKey(face));
      expect(g).toBeDefined();
      if (g === undefined) continue;
      const { right, up } = faceLabelBasis(face);
      const used = new Set(triangles(mesh, g.start, g.count).flat());
      for (const i of used) {
        const p = vertex(mesh.positions, i);
        const [u, v] = uv(mesh, i);
        expect(u).toBeCloseTo((vec3.dot(p, right) / 0.75 + 1) / 2, 6);
        expect(v).toBeCloseTo((vec3.dot(p, up) / 0.75 + 1) / 2, 6);
      }
      const us = [...used].map((i) => uv(mesh, i)[0]);
      expect(Math.min(...us)).toBeCloseTo(0, 6);
      expect(Math.max(...us)).toBeCloseTo(1, 6);
    }
  });

  it('honours a custom bevel', () => {
    const narrow = buildViewCube(0.1);
    const face = narrow.groups.find((g) => regionKey(g.region) === '1,0,0');
    expect(face).toBeDefined();
    if (face === undefined) return;
    const ys = triangles(narrow, face.start, face.count)
      .flat()
      .map((i) => vertex(narrow.positions, i)[1]);
    expect(Math.max(...ys)).toBeCloseTo(0.9, 6);
  });

  it('rejects a bevel outside (0, 1)', () => {
    expect(() => buildViewCube(0)).toThrow();
    expect(() => buildViewCube(1)).toThrow();
  });
});

describe('cubeRegionAt', () => {
  it('maps face centres to the face direction', () => {
    for (const face of FACES) expect(cubeRegionAt(face)).toEqual(face);
  });

  it('maps a point on an edge bevel to the edge', () => {
    expect(cubeRegionAt([0.875, -0.875, 0.2])).toEqual([1, -1, 0]);
    expect(cubeRegionAt([0, 0.9, -0.85])).toEqual([0, 1, -1]);
  });

  it('maps a point on a corner to the corner', () => {
    expect(cubeRegionAt([0.85, -0.85, 0.85])).toEqual([1, -1, 1]);
    expect(cubeRegionAt([-0.8, -0.8, -0.9])).toEqual([-1, -1, -1]);
  });

  it('counts the boundary 1 − bevel to the edge (tolerance 1e-6)', () => {
    expect(cubeRegionAt([1, 0.75, 0])).toEqual([1, 1, 0]);
    expect(cubeRegionAt([1, 0.75 - 5e-7, 0])).toEqual([1, 1, 0]);
    expect(cubeRegionAt([1, 0.75 - 1e-5, 0])).toEqual([1, 0, 0]);
    expect(cubeRegionAt([1, 0.9 - 5e-7, 0], 0.1)).toEqual([1, 1, 0]);
  });

  it('returns null at the origin', () => {
    expect(cubeRegionAt([0, 0, 0])).toBeNull();
  });
});

describe('regionKey', () => {
  it('joins the components with commas', () => {
    expect(regionKey([1, -1, 0])).toBe('1,-1,0');
    expect(regionKey([0, 0, -1])).toBe('0,0,-1');
  });
});

describe('faceLabelBasis', () => {
  it('matches viewBasis of the face direction for all six faces', () => {
    for (const face of FACES) {
      const basis = viewBasis(face);
      const label = faceLabelBasis(face);
      expect(vec3.equals(label.right, basis.right, 1e-9)).toBe(true);
      expect(vec3.equals(label.up, basis.up, 1e-9)).toBe(true);
    }
  });

  it('has +Y up on top and +Z up on front', () => {
    expect(vec3.equals(faceLabelBasis([0, 0, 1]).up, [0, 1, 0])).toBe(true);
    expect(vec3.equals(faceLabelBasis([0, 0, 1]).right, [1, 0, 0])).toBe(true);
    expect(vec3.equals(faceLabelBasis([0, -1, 0]).up, [0, 0, 1])).toBe(true);
    expect(vec3.equals(faceLabelBasis([0, -1, 0]).right, [1, 0, 0])).toBe(true);
  });
});
