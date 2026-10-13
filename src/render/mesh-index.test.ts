import { describe, expect, it } from 'vitest';
import type { MeshData } from '@/kernel';
import { edgeSegments, faceTriangles, polylinesToSegments, triangleToFace } from './mesh-index';

const f32 = (values: readonly number[]): Float32Array<ArrayBuffer> => new Float32Array(values);
const u32 = (values: readonly number[]): Uint32Array<ArrayBuffer> => new Uint32Array(values);

describe('polylinesToSegments', () => {
  it('turns a 2-point edge into one segment', () => {
    const { positions, segmentEdges } = polylinesToSegments(
      f32([0, 0, 0, 1, 2, 3]),
      u32([7, 0, 2]),
    );
    expect([...positions]).toEqual([0, 0, 0, 1, 2, 3]);
    expect([...segmentEdges]).toEqual([7]);
  });

  it('turns an N-point polyline into N−1 segments', () => {
    const points = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0];
    const { positions, segmentEdges } = polylinesToSegments(f32(points), u32([3, 0, 4]));
    expect([...positions]).toEqual([
      ...[0, 0, 0, 1, 0, 0],
      ...[1, 0, 0, 1, 1, 0],
      ...[1, 1, 0, 0, 1, 0],
    ]);
    expect([...segmentEdges]).toEqual([3, 3, 3]);
  });

  it('keeps edges one after another and maps segments to edge keys, not range order', () => {
    const points = [0, 0, 0, 1, 0, 0, 5, 5, 5, 6, 5, 5, 7, 5, 5];
    const { positions, segmentEdges } = polylinesToSegments(f32(points), u32([4, 0, 2, 1, 2, 3]));
    expect([...positions]).toEqual([
      ...[0, 0, 0, 1, 0, 0],
      ...[5, 5, 5, 6, 5, 5],
      ...[6, 5, 5, 7, 5, 5],
    ]);
    expect([...segmentEdges]).toEqual([4, 1, 1]);
  });

  it('returns empty arrays for no edges', () => {
    const { positions, segmentEdges } = polylinesToSegments(f32([]), u32([]));
    expect(positions).toHaveLength(0);
    expect(segmentEdges).toHaveLength(0);
  });
});

describe('triangleToFace', () => {
  // Face keys are not in range order: [face, firstTriangle, count].
  const faceRanges = u32([5, 0, 1, 2, 1, 3, 9, 4, 2]);

  it('maps the first and the last triangle of every face', () => {
    expect(triangleToFace(faceRanges, 0)).toBe(5);
    expect(triangleToFace(faceRanges, 1)).toBe(2);
    expect(triangleToFace(faceRanges, 2)).toBe(2);
    expect(triangleToFace(faceRanges, 3)).toBe(2);
    expect(triangleToFace(faceRanges, 4)).toBe(9);
    expect(triangleToFace(faceRanges, 5)).toBe(9);
  });

  it('returns undefined outside the ranges', () => {
    expect(triangleToFace(faceRanges, 6)).toBeUndefined();
    expect(triangleToFace(faceRanges, -1)).toBeUndefined();
    expect(triangleToFace(u32([]), 0)).toBeUndefined();
  });

  it('returns undefined in a gap before the first range', () => {
    expect(triangleToFace(u32([0, 2, 1]), 1)).toBeUndefined();
  });
});

/**
 * Two faces of a unit cube (keys 4 = +Z top with 2 triangles, 1 = −Z bottom with 2 triangles,
 * stored bottom first) and two edges (key 6 with 2 points, key 3 with 3 points).
 */
function twoFaceMesh(): MeshData {
  return {
    positions: f32([
      ...[0, 0, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0], // bottom, seen from −Z counter-clockwise
      ...[0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1], // top
    ]),
    normals: f32([
      ...[0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1],
      ...[0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
    ]),
    indices: u32([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]),
    faceRanges: u32([1, 0, 2, 4, 2, 2]),
    edgePositions: f32([0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1]),
    edgeRanges: u32([6, 0, 2, 3, 2, 3]),
  };
}

describe('faceTriangles', () => {
  it('copies the triangles of a face, unindexed, with its normals', () => {
    const { positions, normals } = faceTriangles(twoFaceMesh(), 4);
    expect([...positions]).toEqual([
      ...[0, 0, 1, 1, 0, 1, 1, 1, 1],
      ...[0, 0, 1, 1, 1, 1, 0, 1, 1],
    ]);
    expect([...normals]).toEqual(Array.from({ length: 6 }, () => [0, 0, 1]).flat());
  });

  it('finds the face by key, not by range order', () => {
    const { positions, normals } = faceTriangles(twoFaceMesh(), 1);
    expect(positions).toHaveLength(2 * 9);
    expect([...normals]).toEqual(Array.from({ length: 6 }, () => [0, 0, -1]).flat());
  });

  it('returns a copy, not a view of the mesh buffers', () => {
    const mesh = twoFaceMesh();
    const { positions, normals } = faceTriangles(mesh, 4);
    expect(positions.buffer).not.toBe(mesh.positions.buffer);
    expect(normals.buffer).not.toBe(mesh.normals.buffer);
  });

  it('returns empty arrays for an unknown face', () => {
    const { positions, normals } = faceTriangles(twoFaceMesh(), 0);
    expect(positions).toHaveLength(0);
    expect(normals).toHaveLength(0);
  });
});

describe('edgeSegments', () => {
  it('returns one segment of a 2-point edge', () => {
    expect([...edgeSegments(twoFaceMesh(), 6)]).toEqual([0, 0, 0, 1, 0, 0]);
  });

  it('returns N−1 segments of an N-point edge', () => {
    expect([...edgeSegments(twoFaceMesh(), 3)]).toEqual([
      ...[0, 0, 1, 1, 0, 1],
      ...[1, 0, 1, 1, 1, 1],
    ]);
  });

  it('returns an empty array for an unknown edge', () => {
    expect(edgeSegments(twoFaceMesh(), 0)).toHaveLength(0);
  });
});
